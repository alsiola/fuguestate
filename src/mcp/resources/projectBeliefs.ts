import { getActiveBeliefs } from "../../domain/beliefs/index.js";

export function handleProjectBeliefsResource(): string {
  const beliefs = getActiveBeliefs(undefined, undefined, 50);

  if (beliefs.length === 0) return "No active beliefs.";

  const lines = ["# Active Beliefs\n"];
  for (const b of beliefs) {
    lines.push(`- [${b.scope_type}:${b.scope_key}] [${(b.confidence * 100).toFixed(0)}%] ${b.proposition} *(${b.status})*`);
  }
  return lines.join("\n");
}
