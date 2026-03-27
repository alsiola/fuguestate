import type { AgentEvent, AppraisalScores } from "../types.js";

const FAILURE_TYPES = new Set(["tool_failed"]);
const HIGH_IMPORTANCE_TOOLS = new Set(["Write", "Edit", "Bash", "Agent"]);

export function appraiseEvent(event: AgentEvent): AppraisalScores {
  let importance = 0.3;
  let novelty = 0.3;
  let risk = 0.1;
  let reuseP = 0.2;
  let contradictionPressure = 0;
  let userEmphasis = 0;
  let failureIntensity = 0;

  // Importance scoring
  if (event.type === "task_started" || event.type === "task_completed") {
    importance = 0.8;
    reuseP = 0.6;
  } else if (event.type === "prompt_submitted") {
    importance = 0.5;
    userEmphasis = 0.5;
  } else if (event.type === "tool_started" || event.type === "tool_succeeded") {
    const toolName = "toolName" in event ? event.toolName : "";
    importance = HIGH_IMPORTANCE_TOOLS.has(toolName) ? 0.6 : 0.3;
    reuseP = 0.3;
  } else if (event.type === "session_started") {
    importance = 0.4;
  }

  // Failure scoring
  if (FAILURE_TYPES.has(event.type)) {
    failureIntensity = 0.8;
    importance = Math.max(importance, 0.7);
    risk = 0.6;
    reuseP = 0.5;
  }

  // Novelty — approximate; real novelty detection would compare to recent events
  if (event.type === "task_started") {
    novelty = 0.6;
  }

  // Salience composite
  const salience =
    importance * 0.3 +
    novelty * 0.15 +
    risk * 0.15 +
    reuseP * 0.1 +
    contradictionPressure * 0.1 +
    userEmphasis * 0.1 +
    failureIntensity * 0.1;

  return {
    importance,
    novelty,
    risk,
    reuseP,
    contradictionPressure,
    userEmphasis,
    failureIntensity,
    salience,
  };
}

export type SalienceLevel = "low" | "medium" | "high";

export function salienceLevel(score: number): SalienceLevel {
  if (score >= 0.6) return "high";
  if (score >= 0.35) return "medium";
  return "low";
}
