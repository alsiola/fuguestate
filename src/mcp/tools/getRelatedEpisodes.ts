import { searchEpisodes } from "../../domain/episodes/index.js";

export function handleGetRelatedEpisodes(args: Record<string, unknown>) {
  const topic = args.topic as string;
  const limit = (args.limit as number) ?? 10;

  const episodes = searchEpisodes(topic.replace(/[^\w\s]/g, " ").trim(), limit);

  return episodes.map((ep) => ({
    id: ep.id,
    title: ep.title,
    goal: ep.goal,
    status: ep.status,
    outcomeSummary: ep.outcome_summary,
    salienceScore: ep.salience_score,
    startedAt: ep.started_at,
    endedAt: ep.ended_at,
  }));
}
