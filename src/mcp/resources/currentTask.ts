import { getDb } from "../../db/client.js";
import type { EpisodeRow } from "../../domain/types.js";

export function handleCurrentTaskResource(): string {
  const db = getDb();

  // Find most recent open episode
  const episode = db
    .prepare("SELECT * FROM episodes WHERE status = 'open' ORDER BY started_at DESC LIMIT 1")
    .get() as EpisodeRow | undefined;

  if (!episode) return "No active task.";

  const lines = [
    "# Current Task\n",
    `**Title:** ${episode.title}`,
    `**Goal:** ${episode.goal ?? "N/A"}`,
    `**Status:** ${episode.status}`,
    `**Started:** ${episode.started_at}`,
  ];

  if (episode.context_summary) {
    lines.push(`\n**Context:** ${episode.context_summary}`);
  }
  if (episode.action_summary) {
    lines.push(`\n**Actions so far:**\n${episode.action_summary}`);
  }

  return lines.join("\n");
}
