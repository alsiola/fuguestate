import { getEpisode } from "../../domain/episodes/index.js";
import { createProcedure } from "../../domain/procedures/index.js";

export function handleExtractProcedure(args: Record<string, unknown>) {
  const topic = args.topic as string;
  const episodeIds = args.episodeIds as string[];

  // Gather episode data
  const episodes = episodeIds
    .map((id) => getEpisode(id))
    .filter((ep): ep is NonNullable<typeof ep> => ep != null);

  if (episodes.length === 0) {
    return { error: "No valid episodes found" };
  }

  // Build steps from episode action summaries
  const steps: string[] = [];
  for (const ep of episodes) {
    if (ep.action_summary) {
      steps.push(`### From: ${ep.title}`);
      steps.push(ep.action_summary);
    }
  }

  // Build success/failure signals from outcomes
  const successSignals: string[] = [];
  const failureSmells: string[] = [];

  for (const ep of episodes) {
    if (ep.status === "closed" && ep.outcome_summary) {
      successSignals.push(ep.outcome_summary);
    }
    const lessons = JSON.parse(ep.lesson_candidates_json) as string[];
    failureSmells.push(...lessons);
  }

  const stepsMarkdown = steps.length > 0 ? steps.join("\n\n") : `Procedure for: ${topic}\n\n(Steps to be filled in)`;

  const procedure = createProcedure({
    name: topic,
    triggerDescription: `When working on: ${topic}`,
    stepsMarkdown,
    successSignals,
    failureSmells,
    scopeType: "project",
    confidence: 0.5,
    sourceEpisodeIds: episodeIds,
  });

  return {
    procedureId: procedure.id,
    name: procedure.name,
    steps: procedure.steps_markdown,
    confidence: procedure.confidence,
  };
}
