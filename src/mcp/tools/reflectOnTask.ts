import { getOpenEpisodeForTask, getEpisodeForTask, closeEpisode, updateEpisode } from "../../domain/episodes/index.js";
import { getEventsByTask } from "../../domain/events/index.js";
import { createBelief } from "../../domain/beliefs/index.js";
import { createOpenLoop } from "../../domain/openLoops/index.js";

export function handleReflectOnTask(args: Record<string, unknown>) {
  const taskId = args.taskId as string;
  const goal = args.goal as string;
  const resultSummary = args.resultSummary as string;
  const lessons = (args.lessons as string[]) ?? [];

  // Close the episode if still open, or enrich an already-closed one
  const openEpisode = getOpenEpisodeForTask(taskId);
  if (openEpisode) {
    closeEpisode(openEpisode.id, resultSummary, lessons);
  } else {
    // Episode was already closed by the taskCompleted hook — merge lessons in
    const closedEpisode = getEpisodeForTask(taskId);
    if (closedEpisode && lessons.length > 0) {
      const existingLessons = JSON.parse(closedEpisode.lesson_candidates_json) as string[];
      const merged = [...new Set([...existingLessons, ...lessons])];
      updateEpisode(closedEpisode.id, {
        outcome_summary: resultSummary,
        lesson_candidates_json: JSON.stringify(merged),
      });
    }
  }

  // Analyse task events
  const events = getEventsByTask(taskId);
  const failures = events.filter((e) => e.event_type === "tool_failed");
  const highSalience = events.filter((e) => e.salience_score >= 0.6);

  // Build reflection
  const beliefCandidates: Array<{ proposition: string; confidence: number }> = [];
  const procedureCandidates: string[] = [];
  const unresolvedLoops: string[] = [];

  // Add explicit lessons as belief candidates
  for (const lesson of lessons) {
    beliefCandidates.push({ proposition: lesson, confidence: 0.4 });
  }

  // Flag repeated failures as open loops
  if (failures.length >= 2) {
    const failureTools = [...new Set(failures.map((f) => {
      try { return JSON.parse(f.payload_json).toolName; } catch { return "unknown"; }
    }))];

    for (const tool of failureTools) {
      unresolvedLoops.push(`Repeated failure with ${tool} during: ${goal}`);
      createOpenLoop({
        title: `Task reflection: ${tool} failed ${failures.length}x`,
        description: `During task "${goal}", ${tool} failed multiple times.`,
        loopType: "risk",
        scopeType: "project",
        priority: 0.6,
        suggestedNextCheck: `Investigate why ${tool} keeps failing in this context`,
      });
    }
  }

  // If task had many high-salience events, it's a procedure candidate
  if (highSalience.length >= 3) {
    procedureCandidates.push(`Sequence for: ${goal} (${highSalience.length} significant steps)`);
  }

  return {
    taskId,
    goal,
    summary: resultSummary,
    eventCount: events.length,
    failureCount: failures.length,
    beliefCandidates,
    procedureCandidates,
    unresolvedLoops,
    lessons,
  };
}
