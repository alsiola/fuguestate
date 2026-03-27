import { getEpisode } from "../../domain/episodes/index.js";
import { createProcedure } from "../../domain/procedures/index.js";
import { getProjectScope } from "../../app/projectScope.js";

export function handleExtractProcedure(args: Record<string, unknown>) {
  const topic = args.topic as string;
  const episodeIds = (args.episodeIds as string[] | undefined) ?? [];
  const providedSteps = args.steps as string | undefined;
  const triggerDescription = args.triggerDescription as string | undefined;

  // Gather episode data if IDs provided
  const episodes = episodeIds
    .map((id) => getEpisode(id))
    .filter((ep): ep is NonNullable<typeof ep> => ep != null);

  // Build steps from episodes and/or provided steps
  const stepParts: string[] = [];

  if (providedSteps) {
    stepParts.push(providedSteps);
  }

  for (const ep of episodes) {
    if (ep.action_summary) {
      stepParts.push(`### From: ${ep.title}`);
      stepParts.push(ep.action_summary);
    }
  }

  if (stepParts.length === 0) {
    stepParts.push(`Procedure for: ${topic}\n\n(Steps to be filled in)`);
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

  const procedure = createProcedure({
    name: topic,
    triggerDescription: triggerDescription ?? `When working on: ${topic}`,
    stepsMarkdown: stepParts.join("\n\n"),
    successSignals,
    failureSmells,
    scopeType: "project",
    scopeKey: getProjectScope(),
    confidence: episodes.length > 0 ? 0.6 : 0.5,
    sourceEpisodeIds: episodeIds,
  });

  return {
    procedureId: procedure.id,
    name: procedure.name,
    steps: procedure.steps_markdown,
    confidence: procedure.confidence,
  };
}
