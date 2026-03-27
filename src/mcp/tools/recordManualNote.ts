import { createEpisode } from "../../domain/episodes/index.js";

export function handleRecordManualNote(args: Record<string, unknown>) {
  const content = args.content as string;
  const tags = (args.tags as string[]) ?? [];
  const sessionId = (args.sessionId as string) ?? "manual";

  const episode = createEpisode({
    sessionId,
    title: `Note: ${content.slice(0, 80)}`,
    goal: tags.length > 0 ? `Tags: ${tags.join(", ")}` : undefined,
    contextSummary: content,
    salienceScore: 0.5,
  });

  return { noteId: episode.id };
}
