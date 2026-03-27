import { getDb } from "../db/client.js";
import { createOpenLoop } from "../domain/openLoops/index.js";
import { createBelief } from "../domain/beliefs/index.js";
import { clusterEpisodeTitles } from "../app/llm.js";
import { logger } from "../app/logger.js";
import type { EpisodeRow, OpenLoopRow } from "../domain/types.js";

export async function runSynthesis(): Promise<void> {
  try {
    logger.info("Running background synthesis...");

    findRepeatedFailures();
    findUnresolvedContradictions();
    await findRediscoveredPatterns();

    logger.info("Background synthesis complete");
  } catch (err) {
    logger.error({ err }, "Synthesis worker error");
  }
}

function findRepeatedFailures(): void {
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
      .get(`%${tool_name}%`) as { id: string } | undefined;

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
    }
  }
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
    .prepare("SELECT title FROM episodes WHERE status = 'closed' ORDER BY created_at DESC LIMIT 100")
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
