import { createBelief } from "../../domain/beliefs/index.js";
import { checkConflicts, createConflictLoop } from "../../domain/conflict/index.js";
import { getProjectScope } from "../../app/projectScope.js";
import type { ScopeType } from "../../domain/types.js";

export async function handlePinFact(args: Record<string, unknown>) {
  const proposition = args.proposition as string;
  const scope = (args.scope as ScopeType) ?? "project";
  const confidence = (args.confidence as number) ?? 0.9;
  const reason = args.reason as string;
  const scopeKey = (args.scopeKey as string) ?? getProjectScope();

  const belief = createBelief({
    proposition,
    scopeType: scope,
    scopeKey,
    confidence,
    evidenceFor: [reason],
  });

  const conflicts = await checkConflicts({ claims: [proposition], scopeType: scope });
  for (const c of conflicts) {
    if (c.severity >= 0.5) {
      createConflictLoop(c, scope);
    }
  }

  return {
    beliefId: belief.id,
    proposition: belief.proposition,
    confidence: belief.confidence,
    conflicts: conflicts.map((c) => ({
      conflictsWith: c.conflictsWith,
      severity: c.severity,
      suggestedResolution: c.suggestedResolution,
    })),
  };
}
