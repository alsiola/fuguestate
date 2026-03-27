import { getUserPreferences } from "../../domain/profiles/index.js";

export function handleUserPreferencesResource(): string {
  const prefs = getUserPreferences();

  if (prefs.length === 0) return "No user preferences recorded.";

  const lines = ["# User Preferences\n"];
  for (const p of prefs) {
    lines.push(`- **${p.key}**: ${p.value_json} (confidence: ${(p.confidence * 100).toFixed(0)}%)`);
  }
  return lines.join("\n");
}
