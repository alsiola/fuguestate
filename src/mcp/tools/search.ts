import { search } from "../../domain/retrieval/index.js";
import type { RetrievalResult } from "../../domain/types.js";

export async function handleSearch(args: Record<string, unknown>): Promise<RetrievalResult[]> {
  return search({
    query: args.query as string,
    memoryTypes: args.memoryTypes as Array<"episode" | "belief" | "procedure" | "open_loop" | "profile" | "event"> | undefined,
    scopeType: args.scope as any,
    limit: args.limit as number | undefined,
  });
}
