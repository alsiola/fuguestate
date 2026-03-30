import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { search } from "../../domain/retrieval/index.js";
import { searchBeliefsBySimilarity } from "../../domain/beliefEmbeddings.js";
import { getBelief } from "../../domain/beliefs/index.js";
import { setWorkingMemory } from "../../domain/workingMemory/index.js";
import { logger } from "../../app/logger.js";

interface PromptSubmitBody {
  session_id?: string;
  sessionId?: string;
  task_id?: string;
  taskId?: string;
  prompt?: string;
  [key: string]: unknown;
}

export async function handleUserPromptSubmit(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as PromptSubmitBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const prompt = body.prompt ?? "";
  const ts = new Date().toISOString();

  try {
    // Ingest
    const { scores } = ingestEvent(
      {
        type: "prompt_submitted",
        sessionId,
        taskId: body.task_id ?? body.taskId,
        prompt,
        ts,
        payload: body,
      },
      "claude_hook"
    );

    // Update working memory with current goal
    setWorkingMemory(sessionId, "current_prompt", { prompt, ts });

    // Retrieve relevant memories
    if (!prompt.trim()) {
      return reply.send({});
    }

    // Run FTS search (episodes, procedures, open loops) and semantic search (beliefs) in parallel
    const [ftsResults, semanticResults] = await Promise.all([
      search({
        query: prompt,
        memoryTypes: ["episode", "procedure", "open_loop"],
        limit: 6,
      }),
      searchBeliefsBySimilarity(prompt, 6).catch(() => [] as Array<{ beliefId: string; distance: number }>),
    ]);

    // Enrich semantic results with belief data
    const semanticBeliefs = semanticResults
      .map((r) => {
        const belief = getBelief(r.beliefId);
        if (!belief || belief.status === "retired") return null;
        return {
          type: "belief" as const,
          summary: `[${belief.status}] ${belief.proposition}`,
          distance: r.distance,
        };
      })
      .filter(Boolean) as Array<{ type: "belief"; summary: string; distance: number }>;

    // Merge: semantic beliefs first (most relevant), then FTS results
    const allResults = [
      ...semanticBeliefs.map((b) => ({ type: b.type, summary: b.summary })),
      ...ftsResults.map((r) => ({ type: r.type, summary: r.summary })),
    ];

    if (allResults.length === 0) {
      return reply.send({});
    }

    // Deduplicate by summary text
    const seen = new Set<string>();
    const deduped = allResults.filter((r) => {
      const key = r.summary.slice(0, 100);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 8);

    // Build context injection
    const lines: string[] = ["**Relevant Memory:**"];
    for (const r of deduped) {
      lines.push(`- [${r.type}] ${r.summary}`);
    }

    return reply.send({
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: lines.join("\n") },
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Error in user-prompt-submit hook");
    return reply.send({});
  }
}
