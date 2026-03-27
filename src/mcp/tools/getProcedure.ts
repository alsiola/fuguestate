import { getProcedure } from "../../domain/procedures/index.js";
import { searchProcedures } from "../../domain/procedures/index.js";

export function handleGetProcedure(args: Record<string, unknown>) {
  const procedureId = args.procedureId as string | undefined;
  const query = args.query as string | undefined;

  if (procedureId) {
    // Try exact match first, then prefix match (briefing shows first 8 chars)
    let proc = getProcedure(procedureId);
    if (!proc && procedureId.length === 8) {
      const results = searchProcedures(procedureId, 1);
      proc = results[0];
    }
    if (!proc) return { error: `Procedure not found: ${procedureId}` };
    return {
      id: proc.id,
      name: proc.name,
      trigger: proc.trigger_description,
      steps: proc.steps_markdown,
      confidence: proc.confidence,
    };
  }

  if (query) {
    const results = searchProcedures(query, 5);
    return {
      procedures: results.map((p) => ({
        id: p.id,
        name: p.name,
        trigger: p.trigger_description,
        steps: p.steps_markdown,
        confidence: p.confidence,
      })),
    };
  }

  return { error: "Provide either procedureId or query" };
}
