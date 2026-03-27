import { getActiveBeliefs } from "../../domain/beliefs/index.js";

export function handleGetProjectTruths(args: Record<string, unknown>) {
  const scopeKey = (args.scopeKey as string) ?? "";

  const beliefs = getActiveBeliefs("project", scopeKey || undefined, 50);
  // Also get repo-scoped beliefs
  const repoBeliefs = getActiveBeliefs("repo", scopeKey || undefined, 50);

  return [...beliefs, ...repoBeliefs].map((b) => ({
    id: b.id,
    proposition: b.proposition,
    scope: `${b.scope_type}:${b.scope_key}`,
    confidence: b.confidence,
    status: b.status,
    lastValidatedAt: b.last_validated_at,
  }));
}
