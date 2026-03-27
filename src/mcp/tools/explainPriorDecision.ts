import { search } from "../../domain/retrieval/index.js";
import { searchEpisodes } from "../../domain/episodes/index.js";
import { searchBeliefs } from "../../domain/beliefs/index.js";
import { searchProcedures } from "../../domain/procedures/index.js";

export function handleExplainPriorDecision(args: Record<string, unknown>) {
  const topic = args.topic as string;
  const sanitized = topic.replace(/[^\w\s]/g, " ").trim();
  if (!sanitized) return { explanation: "No topic provided" };

  const episodes: Array<{ id: string; title: string; outcome: string | null }> = [];
  const beliefs: Array<{ id: string; proposition: string; confidence: number }> = [];
  const procedures: Array<{ id: string; name: string; steps: string }> = [];

  try {
    const eps = searchEpisodes(sanitized, 5);
    for (const ep of eps) {
      episodes.push({ id: ep.id, title: ep.title, outcome: ep.outcome_summary });
    }
  } catch { /* noop */ }

  try {
    const bels = searchBeliefs(sanitized, 5);
    for (const b of bels) {
      beliefs.push({ id: b.id, proposition: b.proposition, confidence: b.confidence });
    }
  } catch { /* noop */ }

  try {
    const procs = searchProcedures(sanitized, 3);
    for (const p of procs) {
      procedures.push({ id: p.id, name: p.name, steps: p.steps_markdown.slice(0, 200) });
    }
  } catch { /* noop */ }

  const sections: string[] = [];
  if (episodes.length) {
    sections.push("**Related Episodes:**");
    for (const ep of episodes) {
      sections.push(`- ${ep.title}${ep.outcome ? `: ${ep.outcome}` : ""}`);
    }
  }
  if (beliefs.length) {
    sections.push("\n**Related Beliefs:**");
    for (const b of beliefs) {
      sections.push(`- [${(b.confidence * 100).toFixed(0)}%] ${b.proposition}`);
    }
  }
  if (procedures.length) {
    sections.push("\n**Related Procedures:**");
    for (const p of procedures) {
      sections.push(`- ${p.name}: ${p.steps}`);
    }
  }

  return {
    topic,
    explanation: sections.length > 0 ? sections.join("\n") : "No prior context found for this topic.",
    episodes,
    beliefs,
    procedures,
  };
}
