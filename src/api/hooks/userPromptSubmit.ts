import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { search } from "../../domain/retrieval/index.js";
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

    const results = await search({
      query: prompt,
      memoryTypes: ["belief", "episode", "procedure", "open_loop"],
      limit: 8,
    });

    if (results.length === 0) {
      return reply.send({});
    }

    // Build context injection
    const lines: string[] = ["**Relevant Memory:**"];
    for (const r of results) {
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
