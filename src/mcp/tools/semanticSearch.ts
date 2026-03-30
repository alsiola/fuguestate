import { searchBeliefsBySimilarity } from "../../domain/beliefEmbeddings.js";
import { getBelief } from "../../domain/beliefs/index.js";

export async function handleSemanticSearch(args: Record<string, unknown>) {
  const query = args.query as string;
  const topK = (args.top_k as number) ?? 10;

  if (!query) {
    return { error: "query is required" };
  }

  const results = await searchBeliefsBySimilarity(query, topK);

  const enriched = results
    .map((r) => {
      const belief = getBelief(r.beliefId);
      if (!belief) return null;
      return {
        id: belief.id,
        proposition: belief.proposition,
        confidence: belief.confidence,
        status: belief.status,
        scope_type: belief.scope_type,
        scope_key: belief.scope_key,
        distance: Math.round(r.distance * 1000) / 1000,
        similarity: Math.round((1 - r.distance) * 1000) / 1000,
      };
    })
    .filter(Boolean);

  return { query, results: enriched, count: enriched.length };
}
