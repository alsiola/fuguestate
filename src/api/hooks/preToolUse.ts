import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { checkConflicts } from "../../domain/conflict/index.js";
import { logger } from "../../app/logger.js";

interface PreToolUseBody {
  session_id?: string;
  sessionId?: string;
  task_id?: string;
  taskId?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: unknown;
  input?: unknown;
  [key: string]: unknown;
}

export async function handlePreToolUse(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as PreToolUseBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const toolName = body.tool_name ?? body.toolName ?? "unknown";
  const ts = new Date().toISOString();

  try {
    // Ingest
    ingestEvent(
      {
        type: "tool_started",
        sessionId,
        taskId: body.task_id ?? body.taskId,
        toolName,
        input: body.tool_input ?? body.input,
        ts,
      },
      "claude_hook"
    );

    // Quick conflict/risk check for write operations
    const cautionaryContext: string[] = [];

    if (["Write", "Edit", "Bash"].includes(toolName)) {
      // Check if the input mentions things that conflict with beliefs
      const rawInput = body.tool_input ?? body.input;
      const inputStr = typeof rawInput === "string" ? rawInput : JSON.stringify(rawInput ?? {});
      const inputWords = inputStr.slice(0, 200);

      if (inputWords.length > 10) {
        const conflicts = await checkConflicts({ claims: [inputWords] });
        if (conflicts.length > 0) {
          for (const c of conflicts) {
            cautionaryContext.push(`⚠️ Potential conflict: "${c.conflictsWith}" (${c.suggestedResolution})`);
          }
        }
      }
    }

    if (cautionaryContext.length > 0) {
      return reply.send({
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: cautionaryContext.join("\n") },
      });
    }

    return reply.send({});
  } catch (err) {
    logger.error({ err, sessionId, toolName }, "Error in pre-tool-use hook");
    return reply.send({});
  }
}
