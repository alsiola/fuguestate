import { retireBelief } from "../../domain/beliefs/index.js";

export function handleRetireFact(args: Record<string, unknown>) {
  const beliefId = args.beliefId as string;
  const reason = args.reason as string;

  const updated = retireBelief(beliefId, reason);
  if (!updated) {
    return { error: "Belief not found", beliefId };
  }

  return {
    beliefId: updated.id,
    status: updated.status,
    proposition: updated.proposition,
  };
}
