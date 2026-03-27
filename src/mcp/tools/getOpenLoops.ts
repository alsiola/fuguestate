import { getOpenLoops } from "../../domain/openLoops/index.js";

export function handleGetOpenLoops(args: Record<string, unknown>) {
  return getOpenLoops({
    scopeType: args.scope as any,
    priorityMin: args.priorityMin as number | undefined,
  }).map((l) => ({
    id: l.id,
    title: l.title,
    description: l.description,
    loopType: l.loop_type,
    priority: l.priority,
    suggestedNextCheck: l.suggested_next_check,
    createdAt: l.created_at,
  }));
}
