import { checkConflicts, createConflictLoop } from "../../domain/conflict/index.js";

export async function handleCheckConflicts(args: Record<string, unknown>) {
  const claims = args.claims as string[];
  const scopeType = (args.scope as any) ?? "project";

  const conflicts = await checkConflicts({ claims, scopeType });

  // Auto-create open loops for high-severity conflicts
  for (const c of conflicts) {
    if (c.severity >= 0.5) {
      createConflictLoop(c, scopeType);
    }
  }

  return {
    conflicts: conflicts.map((c) => ({
      claim: c.claim,
      conflictsWith: c.conflictsWith,
      severity: c.severity,
      suggestedResolution: c.suggestedResolution,
      suggestedCheck: c.suggestedCheck,
    })),
    summary: conflicts.length === 0
      ? "No conflicts detected"
      : `${conflicts.length} potential conflict(s) found`,
  };
}
