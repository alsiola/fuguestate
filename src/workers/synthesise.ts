import { getDb } from "../db/client.js";
import { createOpenLoop, resolveOpenLoop } from "../domain/openLoops/index.js";
import { createBelief } from "../domain/beliefs/index.js";
import { createProcedure } from "../domain/procedures/index.js";
import { clusterEpisodeTitles, askClaude } from "../app/llm.js";
import { scopeFromCwd } from "../app/projectScope.js";
import { logger } from "../app/logger.js";
import type { EpisodeRow, OpenLoopRow } from "../domain/types.js";

export async function runSynthesis(): Promise<void> {
  try {
    logger.info("Running background synthesis...");

    await findRepeatedFailures();
    findUnresolvedContradictions();
    await findRediscoveredPatterns();
    await resolveRecurringPatterns();

    logger.info("Background synthesis complete");
  } catch (err) {
    logger.error({ err }, "Synthesis worker error");
  }
}

async function findRepeatedFailures(): Promise<void> {
  const db = getDb();

  // What keeps failing?
  const failureCounts = db
    .prepare(
      `SELECT
         JSON_EXTRACT(payload_json, '$.toolName') as tool_name,
         COUNT(*) as fail_count
       FROM events
       WHERE event_type = 'tool_failed'
       AND ts > datetime('now', '-7 days')
       GROUP BY tool_name
       HAVING fail_count >= 3
       ORDER BY fail_count DESC
       LIMIT 5`
    )
    .all() as Array<{ tool_name: string; fail_count: number }>;

  for (const { tool_name, fail_count } of failureCounts) {
    if (!tool_name) continue;

    // Check if we already have an open OR recently resolved loop for this
    const existing = db
      .prepare("SELECT id, status FROM open_loops WHERE title LIKE ? AND (status = 'open' OR (status = 'resolved' AND resolved_at > datetime('now', '-7 days'))) LIMIT 1")
      .get(`%Repeated failures%${tool_name}%`) as { id: string; status: string } | undefined;

    if (!existing) {
      createOpenLoop({
        title: `Repeated failures: ${tool_name} (${fail_count}x in 7 days)`,
        description: `${tool_name} has failed ${fail_count} times recently. Consider investigating root cause.`,
        loopType: "risk",
        scopeType: "project",
        priority: Math.min(0.3 + fail_count * 0.1, 0.9),
        suggestedNextCheck: `Review recent ${tool_name} failures for common patterns`,
      });
      logger.info({ tool_name, fail_count }, "Created synthesis loop for repeated failures");
    } else if (existing.status === "open") {
      // Loop is open — try to analyze and auto-resolve
      await analyzeFailurePatterns(tool_name, fail_count, existing.id);
    }
    // If resolved within 7 days, skip — already handled
  }
}

async function analyzeFailurePatterns(toolName: string, failCount: number, loopId: string): Promise<void> {
  const db = getDb();

  // Gather the actual failure details + session cwd for scope
  const failures = db
    .prepare(
      `SELECT e.ts, JSON_EXTRACT(e.payload_json, '$.errorSummary') as error,
              JSON_EXTRACT(e.payload_json, '$.input') as input,
              JSON_EXTRACT(e.payload_json, '$.cwd') as cwd,
              (SELECT JSON_EXTRACT(s.payload_json, '$.cwd')
               FROM events s
               WHERE s.session_id = e.session_id
               AND s.event_type = 'session_started'
               ORDER BY s.ts DESC LIMIT 1) as session_cwd
       FROM events e
       WHERE e.event_type = 'tool_failed'
       AND JSON_EXTRACT(e.payload_json, '$.toolName') = ?
       AND e.ts > datetime('now', '-7 days')
       ORDER BY e.ts DESC
       LIMIT 10`
    )
    .all(toolName) as Array<{ ts: string; error: string; input: string; cwd: string | null; session_cwd: string | null }>;

  if (failures.length < 3) return;

  // Derive project scope from the session that produced these failures
  const derivedCwd = failures.find(f => f.session_cwd || f.cwd);
  let scopeKey = scopeFromCwd(derivedCwd?.session_cwd ?? derivedCwd?.cwd ?? "");
  if (!scopeKey) {
    // Fallback: use the most common scope from existing beliefs
    const fallback = db
      .prepare("SELECT scope_key, COUNT(*) as cnt FROM beliefs WHERE scope_key != '' GROUP BY scope_key ORDER BY cnt DESC LIMIT 1")
      .get() as { scope_key: string } | undefined;
    scopeKey = fallback?.scope_key ?? "";
  }
  if (!scopeKey) {
    logger.warn({ toolName }, "Cannot determine project scope for failure analysis — skipping");
    return;
  }

  const failureSummaries = failures.map((f, i) =>
    `${i + 1}. [${f.ts}] Error: ${(f.error ?? "").slice(0, 200)}\n   Input: ${(f.input ?? "").slice(0, 150)}`
  ).join("\n\n");

  const prompt = `Analyze these repeated ${toolName} failures and identify the root cause pattern.

${failureSummaries}

Produce:
1. A short root cause description (what mistake keeps happening)
2. A set of prevention steps (concrete actions to avoid this in future)
3. Whether this is a procedural issue (agent keeps making the same mistake) or an environmental issue (something is misconfigured)`;

  const result = await askClaude<{
    root_cause: string;
    prevention_steps: string[];
    issue_type: "procedural" | "environmental";
    procedure_name: string;
  }>(prompt, {
    type: "object",
    properties: {
      root_cause: { type: "string" },
      prevention_steps: { type: "array", items: { type: "string" } },
      issue_type: { type: "string", enum: ["procedural", "environmental"] },
      procedure_name: { type: "string" },
    },
    required: ["root_cause", "prevention_steps", "issue_type", "procedure_name"],
  });

  if (!result.ok || !result.data) {
    logger.warn({ toolName }, "LLM analysis of failure patterns unavailable");
    return;
  }

  const { root_cause, prevention_steps, issue_type } = result.data;
  let { procedure_name } = result.data;

  if (!procedure_name) {
    procedure_name = `Recover from ${toolName} failures`;
  }

  // Create a procedure from the analysis
  const stepsMarkdown = [
    `## Root Cause\n${root_cause}`,
    `## Issue Type\n${issue_type}`,
    `## Prevention Steps`,
    ...prevention_steps.map((s, i) => `${i + 1}. ${s}`),
  ].join("\n\n");

  createProcedure({
    name: procedure_name,
    triggerDescription: `When using ${toolName} tool — avoid repeated failure pattern`,
    stepsMarkdown,
    failureSmells: [root_cause],
    scopeType: "project",
    scopeKey,
    confidence: 0.7,
  });

  // Pin a belief about this failure pattern so it shows up in future briefings
  createBelief({
    proposition: `${toolName} failures are typically caused by: ${root_cause}. Prevention: ${prevention_steps[0] ?? "verify before executing"}.`,
    scopeType: "project",
    scopeKey,
    confidence: 0.7 + Math.min(failCount * 0.03, 0.2), // higher confidence with more evidence
    evidenceFor: [`Observed ${failCount} failures in 7 days with common pattern`],
  });

  // Resolve the open loop with the analysis
  resolveOpenLoop(loopId, `Auto-analyzed: ${root_cause}. Created procedure "${procedure_name}" with ${prevention_steps.length} prevention steps. Pinned belief about root cause.`);
  logger.info({ toolName, procedure_name, issue_type }, "Analyzed failure pattern, created procedure, and pinned belief");
}

function findUnresolvedContradictions(): void {
  const db = getDb();

  // Find disputed beliefs that have been disputed for a while
  const disputed = db
    .prepare(
      "SELECT * FROM beliefs WHERE status = 'disputed' AND last_validated_at < datetime('now', '-1 day') LIMIT 5"
    )
    .all() as Array<{ id: string; proposition: string; confidence: number }>;

  for (const belief of disputed) {
    const existing = db
      .prepare("SELECT id FROM open_loops WHERE status = 'open' AND linked_belief_ids_json LIKE ? LIMIT 1")
      .get(`%${belief.id}%`) as { id: string } | undefined;

    if (!existing) {
      createOpenLoop({
        title: `Unresolved disputed belief: ${belief.proposition.slice(0, 80)}`,
        description: `Belief "${belief.proposition}" has been disputed (confidence: ${belief.confidence}). Needs resolution.`,
        loopType: "contradiction",
        scopeType: "project",
        priority: 0.6,
        linkedBeliefIds: [belief.id],
        suggestedNextCheck: "Verify this belief against current project state",
      });
    }
  }
}

async function findRediscoveredPatterns(): Promise<void> {
  const db = getDb();

  // Get all closed episode titles for semantic clustering
  const episodes = db
    .prepare("SELECT title FROM episodes WHERE status = 'closed' ORDER BY started_at DESC LIMIT 100")
    .all() as Array<{ title: string }>;

  if (episodes.length < 3) return;

  const titles = episodes.map((e) => e.title);

  // Try LLM-based semantic clustering
  const clusters = await clusterEpisodeTitles(titles);

  if (clusters) {
    // Don't create more recurring pattern loops if we already have open ones
    const existingPatternLoops = db
      .prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = 'open' AND loop_type = 'todo' AND title LIKE '%Recurring pattern%'")
      .get() as { cnt: number };
    if (existingPatternLoops.cnt >= 3) return;

    for (const cluster of clusters.clusters) {
      if (cluster.count < 3) continue;

      // Check if we already have a loop for a similar pattern
      const existingForCluster = db
        .prepare("SELECT id FROM open_loops WHERE status = 'open' AND loop_type = 'todo' AND title LIKE ? LIMIT 1")
        .get(`%Recurring pattern%${cluster.representative_title.slice(0, 30)}%`) as { id: string } | undefined;

      if (!existingForCluster) {
        createOpenLoop({
          title: `Recurring pattern: ${cluster.representative_title.slice(0, 80)} (${cluster.count}x)`,
          description: `This type of task has appeared ${cluster.count} times: ${cluster.titles.slice(0, 3).join(", ")}. Consider creating a procedure.`,
          loopType: "todo",
          scopeType: "project",
          priority: 0.5,
          suggestedNextCheck: "Consider extracting a reusable procedure",
        });
      }
    }
    return;
  }

  // Fallback to substring grouping if LLM unavailable
  logger.warn("LLM unavailable for pattern detection, falling back to substring grouping");
  const grouped = db
    .prepare(
      "SELECT title, COUNT(*) as cnt FROM episodes WHERE status = 'closed' GROUP BY LOWER(SUBSTR(title, 1, 40)) HAVING cnt >= 3 LIMIT 5"
    )
    .all() as Array<{ title: string; cnt: number }>;

  for (const { title, cnt } of grouped) {
    const existing = db
      .prepare("SELECT id FROM open_loops WHERE status = 'open' AND title LIKE ? LIMIT 1")
      .get(`%Recurring pattern%${title.slice(0, 30)}%`) as { id: string } | undefined;

    if (!existing) {
      createOpenLoop({
        title: `Recurring pattern: ${title.slice(0, 80)} (${cnt}x)`,
        description: `This type of task has appeared ${cnt} times. Consider creating a procedure.`,
        loopType: "todo",
        scopeType: "project",
        priority: 0.5,
        suggestedNextCheck: "Consider extracting a reusable procedure",
      });
    }
  }
}

/**
 * Auto-resolve open "Recurring pattern" todo loops by extracting procedures.
 * Finds loops that have been open for at least 1 hour, gathers related
 * episodes, asks the LLM to synthesize a procedure, then resolves the loop.
 */
export async function resolveRecurringPatterns(): Promise<void> {
  const db = getDb();

  const openPatternLoops = db
    .prepare(
      `SELECT id, title, description FROM open_loops
       WHERE status = 'open' AND loop_type = 'todo' AND title LIKE '%Recurring pattern%'
       AND created_at < datetime('now', '-1 hour')
       ORDER BY created_at ASC LIMIT 3`
    )
    .all() as Array<{ id: string; title: string; description: string }>;

  if (openPatternLoops.length === 0) return;

  for (const loop of openPatternLoops) {
    // Extract episode titles mentioned in the description
    const descriptionTitles = loop.description ?? "";

    // Find related episodes by searching for keywords from the loop title
    const patternName = loop.title.replace(/^Recurring pattern:\s*/, "").replace(/\s*\(\d+x\)\s*$/, "");
    const keywords = patternName.split(/\s+/).filter(w => w.length > 3).slice(0, 3);

    let episodes: Array<{ id: string; title: string; goal: string | null; action_summary: string | null; outcome_summary: string | null }> = [];

    if (keywords.length > 0) {
      // Search episodes FTS for related episodes
      const ftsQuery = keywords.join(" OR ");
      try {
        episodes = db
          .prepare(
            `SELECT e.id, e.title, e.goal, e.action_summary, e.outcome_summary
             FROM episodes e
             JOIN episodes_fts f ON e.rowid = f.rowid
             WHERE episodes_fts MATCH ? AND e.status = 'closed'
             ORDER BY rank LIMIT 10`
          )
          .all(ftsQuery) as typeof episodes;
      } catch {
        // FTS might fail, fall back to LIKE
        episodes = db
          .prepare(
            `SELECT id, title, goal, action_summary, outcome_summary
             FROM episodes WHERE status = 'closed' AND title LIKE ?
             ORDER BY started_at DESC LIMIT 10`
          )
          .all(`%${keywords[0]}%`) as typeof episodes;
      }
    }

    if (episodes.length < 2) {
      // Not enough data — dismiss the loop rather than letting it sit forever
      resolveOpenLoop(loop.id, `Auto-dismissed: insufficient episode data to extract a procedure (found ${episodes.length} related episodes).`);
      logger.info({ loopId: loop.id, patternName }, "Dismissed recurring pattern loop — not enough episodes");
      continue;
    }

    // Ask LLM to synthesize a procedure
    const episodeSummaries = episodes.map((ep, i) =>
      `${i + 1}. "${ep.title}"${ep.goal ? `\n   Goal: ${ep.goal}` : ""}${ep.action_summary ? `\n   Actions: ${ep.action_summary.slice(0, 200)}` : ""}${ep.outcome_summary ? `\n   Outcome: ${ep.outcome_summary.slice(0, 200)}` : ""}`
    ).join("\n\n");

    const prompt = `These episodes represent a recurring pattern in the project: "${patternName}"

${episodeSummaries}

Extract a reusable procedure from these episodes. The procedure should help someone do this type of task efficiently next time.

Produce:
1. A clear procedure name (short, imperative)
2. When this procedure should be triggered (what situation)
3. Step-by-step instructions in markdown
4. Signs that the procedure succeeded
5. Signs that something went wrong`;

    const result = await askClaude<{
      procedure_name: string;
      trigger: string;
      steps_markdown: string;
      success_signals: string[];
      failure_smells: string[];
    }>(prompt, {
      type: "object",
      properties: {
        procedure_name: { type: "string" },
        trigger: { type: "string" },
        steps_markdown: { type: "string" },
        success_signals: { type: "array", items: { type: "string" } },
        failure_smells: { type: "array", items: { type: "string" } },
      },
      required: ["procedure_name", "trigger", "steps_markdown"],
    });

    if (!result.ok || !result.data) {
      logger.warn({ loopId: loop.id, patternName }, "LLM procedure extraction unavailable");
      continue;
    }

    const { procedure_name, trigger, steps_markdown, success_signals, failure_smells } = result.data;

    if (!procedure_name) {
      resolveOpenLoop(loop.id, "Auto-dismissed: LLM could not generate a meaningful procedure.");
      continue;
    }

    // Derive scope from a related episode's session
    const sessionCwd = db
      .prepare(
        `SELECT JSON_EXTRACT(s.payload_json, '$.cwd') as cwd
         FROM events s
         WHERE s.session_id = (SELECT session_id FROM episodes WHERE id = ? LIMIT 1)
         AND s.event_type = 'session_started'
         ORDER BY s.ts DESC LIMIT 1`
      )
      .get(episodes[0].id) as { cwd: string } | undefined;

    const scopeKey = scopeFromCwd(sessionCwd?.cwd ?? "");

    createProcedure({
      name: procedure_name,
      triggerDescription: trigger,
      stepsMarkdown: steps_markdown,
      successSignals: success_signals ?? [],
      failureSmells: failure_smells ?? [],
      scopeType: "project",
      scopeKey: scopeKey || undefined,
      confidence: 0.6,
      sourceEpisodeIds: episodes.map(e => e.id),
    });

    resolveOpenLoop(loop.id, `Auto-resolved: extracted procedure "${procedure_name}" from ${episodes.length} related episodes.`);
    logger.info({ loopId: loop.id, patternName, procedure_name, episodeCount: episodes.length }, "Resolved recurring pattern → procedure");
  }
}
