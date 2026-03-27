import { getOpenLoops } from "../../domain/openLoops/index.js";

export function handleOpenLoopsResource(): string {
  const loops = getOpenLoops({ limit: 30 });

  if (loops.length === 0) return "No open loops.";

  const lines = ["# Open Loops\n"];
  for (const l of loops) {
    lines.push(`- **[${l.loop_type}]** ${l.title} (priority: ${l.priority.toFixed(2)})`);
    if (l.suggested_next_check) {
      lines.push(`  → ${l.suggested_next_check}`);
    }
  }
  return lines.join("\n");
}
