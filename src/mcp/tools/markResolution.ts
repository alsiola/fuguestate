import { resolveOpenLoop } from "../../domain/openLoops/index.js";

export function handleMarkResolution(args: Record<string, unknown>) {
  const openLoopId = args.openLoopId as string;
  const resolution = args.resolution as string;

  const updated = resolveOpenLoop(openLoopId, resolution);
  if (!updated) {
    return { error: "Open loop not found", openLoopId };
  }

  return {
    id: updated.id,
    title: updated.title,
    status: updated.status,
    resolvedAt: updated.resolved_at,
  };
}
