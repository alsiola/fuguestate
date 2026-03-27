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

    // Check if we already have an open loop for this
    const existing = db
      .prepare("SELECT id FROM open_loops WHERE status = 'open' AND title LIKE ? LIMIT 1")
      .get(`%Repeated failures%${tool_name}%`) as { id: string } | undefined;

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
    } else {
      // Loop already exists — try to analyze and auto-resolve
      await analyzeFailurePatterns(tool_name, fail_count, existing.id);
    }
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
  const scopeKey = scopeFromCwd(derivedCwd?.session_cwd ?? derivedCwd?.cwd ?? "");
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
    for (const cluster of clusters.clusters) {
      if (cluster.count < 3) continue;

      const existing = db
        .prepare("SELECT id FROM open_loops WHERE status = 'open' AND loop_type = 'todo' AND title LIKE ? LIMIT 1")
        .get(`%Recurring pattern%`) as { id: string } | undefined;

      // Check if we already have a loop for a similar pattern
      const existingForCluster = db
        .prepare("SELECT id FROM open_loops WHERE status = 'open' AND description LIKE ? LIMIT 1")
        .get(`%${cluster.representative_title.slice(0, 40)}%`) as { id: string } | undefined;

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
