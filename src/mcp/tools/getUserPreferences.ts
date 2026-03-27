import { getUserPreferences } from "../../domain/profiles/index.js";

export function handleGetUserPreferences(args: Record<string, unknown>) {
  const userId = args.userId as string | undefined;
  const prefs = getUserPreferences(userId);

  return prefs.map((p) => ({
    key: p.key,
    value: JSON.parse(p.value_json),
    confidence: p.confidence,
    source: p.source,
    lastValidatedAt: p.last_validated_at,
  }));
}
