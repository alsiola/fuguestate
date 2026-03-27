import { generateBriefing, getCachedBriefing, cacheBriefing } from "../../domain/briefing/index.js";
import { loadConfig } from "../../app/config.js";

export function handleGetBriefing(args: Record<string, unknown>): string {
  const scope = (args.scope as string) ?? "project";
  const sessionId = args.sessionId as string | undefined;
  const taskHint = args.taskHint as string | undefined;
  const maxItems = args.maxItems as number | undefined;

  const config = loadConfig();
  const cacheKey = `briefing:${scope}:${sessionId ?? "default"}`;

  const cached = getCachedBriefing(cacheKey, config.briefingTtlSeconds);
  if (cached) return cached;

  const briefing = generateBriefing({
    scope: scope as "session" | "task" | "repo" | "project" | "user",
    sessionId,
    taskHint,
    maxItems,
  });

  if (briefing !== "No relevant memory available yet.") {
    cacheBriefing(cacheKey, "briefing", briefing, config.briefingTtlSeconds);
  }

  return briefing;
}
