import { getActiveBeliefs } from "../beliefs/index.js";
import { createOpenLoop } from "../openLoops/index.js";
import { assessContradictions } from "../../app/llm.js";
import type { Conflict, ScopeType } from "../types.js";

export interface ConflictCheckParams {
  claims: string[];
  scopeType?: ScopeType;
  scopeKey?: string;
}

export async function checkConflicts(params: ConflictCheckParams): Promise<Conflict[]> {
  const allBeliefs = getActiveBeliefs();
  if (allBeliefs.length === 0) return [];

  const pairs: Array<{ claimIndex: number; claim: string; beliefId: string; beliefProposition: string }> = [];
  const beliefMap = new Map<string, { id: string; proposition: string; confidence: number }>();

  for (let i = 0; i < params.claims.length; i++) {
    for (const belief of allBeliefs) {
      // Don't compare a belief against itself
      if (belief.proposition === params.claims[i]) continue;
      pairs.push({ claimIndex: i, claim: params.claims[i], beliefId: belief.id, beliefProposition: belief.proposition });
      beliefMap.set(belief.id, { id: belief.id, proposition: belief.proposition, confidence: belief.confidence });
    }
  }

  if (pairs.length === 0) return [];

  // Batch into chunks of max 20 pairs to avoid overwhelming the LLM
  const BATCH_SIZE = 20;
  const allAssessments: Array<{ claim_index: number; belief_id: string; is_contradiction: boolean; severity: number; reasoning: string; suggested_resolution: string }> = [];

  for (let i = 0; i < pairs.length; i += BATCH_SIZE) {
    const batch = pairs.slice(i, i + BATCH_SIZE);
    const llmResult = await assessContradictions(batch);
    if (llmResult) {
      allAssessments.push(...llmResult.pairs);
    }
  }

  const llmResult = { pairs: allAssessments };
  if (llmResult.pairs.length === 0) return [];

  const conflicts: Conflict[] = [];
  for (const assessment of llmResult.pairs) {
    if (assessment.is_contradiction && assessment.severity > 0.3) {
      const belief = beliefMap.get(assessment.belief_id);
      conflicts.push({
        claim: params.claims[assessment.claim_index],
        conflictsWith: belief?.proposition ?? assessment.belief_id,
        sourceType: "belief",
        sourceId: assessment.belief_id,
        severity: assessment.severity,
        suggestedResolution: assessment.suggested_resolution as Conflict["suggestedResolution"],
        suggestedCheck: `Verify: "${params.claims[assessment.claim_index]}" vs existing belief: "${belief?.proposition ?? assessment.belief_id}" — ${assessment.reasoning}`,
      });
    }
  }

  return conflicts;
}

export function createConflictLoop(conflict: Conflict, scopeType: ScopeType = "project", scopeKey = ""): void {
  createOpenLoop({
    title: `Conflict: ${truncate(conflict.claim, 60)}`,
    description: `Claim: "${conflict.claim}"\nConflicts with belief: "${conflict.conflictsWith}"\nSeverity: ${conflict.severity}\nSuggested: ${conflict.suggestedResolution}`,
    loopType: "contradiction",
    scopeType,
    scopeKey,
    priority: conflict.severity,
    linkedBeliefIds: [conflict.sourceId],
    suggestedNextCheck: conflict.suggestedCheck,
  });
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "...";
}
