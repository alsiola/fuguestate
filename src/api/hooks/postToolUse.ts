import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { getOpenEpisodeForSession, updateEpisode } from "../../domain/episodes/index.js";
import { salienceLevel } from "../../domain/appraisal/index.js";
import { logger } from "../../app/logger.js";

interface PostToolUseBody {
  session_id?: string;
  sessionId?: string;
  task_id?: string;
  taskId?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: unknown;
  input?: unknown;
  tool_response?: unknown;
  output?: unknown;
  [key: string]: unknown;
}

export async function handlePostToolUse(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as PostToolUseBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const toolName = body.tool_name ?? body.toolName ?? "unknown";
  const ts = new Date().toISOString();

  try {
    const rawOutput = body.tool_response ?? body.output;
    const outputStr = typeof rawOutput === "string" ? rawOutput : JSON.stringify(rawOutput ?? {});
    const outputSummary = outputStr.slice(0, 500);

    const { scores } = ingestEvent(
      {
        type: "tool_succeeded",
        sessionId,
        taskId: body.task_id ?? body.taskId,
        toolName,
        input: body.tool_input ?? body.input,
        outputSummary,
        ts,
      },
      "claude_hook"
    );

    // Update current episode if salience warrants it
    if (salienceLevel(scores.salience) !== "low") {
      const episode = getOpenEpisodeForSession(sessionId);
      if (episode) {
        const existing = episode.action_summary ?? "";
        const newAction = `${existing}\n- ${toolName}: ${outputSummary.slice(0, 100)}`.trim();
        updateEpisode(episode.id, { action_summary: newAction });
      }
    }

    return reply.send({});
  } catch (err) {
    logger.error({ err, sessionId, toolName }, "Error in post-tool-use hook");
    return reply.send({});
  }
}
