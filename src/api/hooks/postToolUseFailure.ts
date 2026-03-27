import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { getOpenEpisodeForSession, updateEpisode } from "../../domain/episodes/index.js";
import { createOpenLoop } from "../../domain/openLoops/index.js";
import { logger } from "../../app/logger.js";

interface PostToolUseFailureBody {
  session_id?: string;
  sessionId?: string;
  task_id?: string;
  taskId?: string;
  tool_name?: string;
  toolName?: string;
  tool_input?: unknown;
  input?: unknown;
  error?: unknown;
  is_interrupt?: boolean;
  [key: string]: unknown;
}

export async function handlePostToolUseFailure(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as PostToolUseFailureBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const toolName = body.tool_name ?? body.toolName ?? "unknown";
  const ts = new Date().toISOString();

  try {
    const errorStr = typeof body.error === "string" ? body.error : JSON.stringify(body.error ?? {});
    const errorSummary = errorStr.slice(0, 500);

    const { scores } = ingestEvent(
      {
        type: "tool_failed",
        sessionId,
        taskId: body.task_id ?? body.taskId,
        toolName,
        input: body.tool_input ?? body.input,
        errorSummary,
        ts,
      },
      "claude_hook"
    );

    // Always attach failure to episode
    const episode = getOpenEpisodeForSession(sessionId);
    if (episode) {
      const existing = episode.action_summary ?? "";
      const newAction = `${existing}\n- ❌ ${toolName} FAILED: ${errorSummary.slice(0, 100)}`.trim();
      updateEpisode(episode.id, {
        action_summary: newAction,
        salience_score: Math.max(episode.salience_score, scores.salience),
      });
    }

    // Create open loop for significant failures
    if (scores.salience >= 0.5) {
      createOpenLoop({
        title: `Tool failure: ${toolName}`,
        description: `Error: ${errorSummary}\nInput: ${JSON.stringify(body.input ?? {}).slice(0, 200)}`,
        loopType: "risk",
        scopeType: "project",
        priority: scores.salience,
        suggestedNextCheck: `Verify ${toolName} works correctly with similar inputs`,
      });
    }

    // Suggest next checks
    const additionalContext = scores.salience >= 0.4
      ? `⚠️ Tool failure recorded (${toolName}). Consider verifying approach before retrying.`
      : undefined;

    return reply.send({
      hookSpecificOutput: { hookEventName: "PostToolUseFailure", additionalContext },
    });
  } catch (err) {
    logger.error({ err, sessionId, toolName }, "Error in post-tool-use-failure hook");
    return reply.send({});
  }
}
