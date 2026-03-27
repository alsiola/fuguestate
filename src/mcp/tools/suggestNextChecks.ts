import { search } from "../../domain/retrieval/index.js";
import { getOpenLoops } from "../../domain/openLoops/index.js";
import { checkConflicts } from "../../domain/conflict/index.js";
import { scoreLoopRelevance } from "../../app/llm.js";
import { logger } from "../../app/logger.js";

export async function handleSuggestNextChecks(args: Record<string, unknown>) {
  const goal = args.goal as string;
  const currentPlan = args.currentPlan as string | undefined;
  const checks: Array<{ check: string; reason: string; priority: number }> = [];

  // Check for conflicts with the goal/plan
  const claims = [goal];
  if (currentPlan) claims.push(currentPlan);

  const conflicts = await checkConflicts({ claims });
  for (const c of conflicts) {
    checks.push({
      check: c.suggestedCheck ?? `Verify: ${c.claim}`,
      reason: `Potential conflict with: ${c.conflictsWith}`,
      priority: c.severity,
    });
  }

  // Check open loops that are relevant using LLM
  const loops = getOpenLoops({ limit: 10 });
  if (loops.length > 0) {
    const llmScores = await scoreLoopRelevance(
      goal,
      loops.map((l) => ({ id: l.id, title: l.title, description: l.description ?? undefined }))
    );

    if (llmScores) {
      const scoreMap = new Map(llmScores.scores.map((s) => [s.loop_id, s]));
      for (const loop of loops) {
        const score = scoreMap.get(loop.id);
        if (score?.relevant && loop.suggested_next_check) {
          checks.push({
            check: loop.suggested_next_check,
            reason: `Open loop: ${loop.title}`,
            priority: score.score,
          });
        }
      }
    } else {
      // Fallback to keyword matching
      logger.warn("LLM unavailable for loop relevance in suggestNextChecks, falling back to keywords");
      const goalWords = goal.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      for (const loop of loops) {
        const loopText = `${loop.title} ${loop.description ?? ""}`.toLowerCase();
        const relevant = goalWords.some((w) => loopText.includes(w));
        if (relevant && loop.suggested_next_check) {
          checks.push({
            check: loop.suggested_next_check,
            reason: `Open loop: ${loop.title}`,
            priority: loop.priority,
          });
        }
      }
    }
  }

  // Check for relevant past failures
  const failureResults = await search({
    query: goal,
    memoryTypes: ["episode"],
    limit: 5,
  });

  for (const r of failureResults) {
    if (r.summary.includes("FAILED") || r.summary.includes("\u274c")) {
      checks.push({
        check: `Review past failure: ${r.summary.slice(0, 100)}`,
        reason: "Related past failure",
        priority: 0.6,
      });
    }
  }

  checks.sort((a, b) => b.priority - a.priority);
  return checks.slice(0, 10);
}
