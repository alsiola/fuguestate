import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { generateBriefing } from "../../domain/briefing/index.js";
import { logger } from "../../app/logger.js";

interface SubagentStartBody {
  session_id?: string;
  sessionId?: string;
  agent_id?: string;
  subagentId?: string;
  agent_type?: string;
  role?: string;
  [key: string]: unknown;
}

export async function handleSubagentStart(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as SubagentStartBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const subagentId = body.agent_id ?? body.subagentId ?? "unknown";
  const ts = new Date().toISOString();

  try {
    ingestEvent(
      {
        type: "subagent_started",
        sessionId,
        subagentId,
        role: body.agent_type ?? body.role,
        ts,
      },
      "claude_hook"
    );

    // Generate scoped briefing for the subagent
    const briefing = generateBriefing({
      scope: "task",
      sessionId,
      taskHint: body.agent_type ?? body.role,
      maxItems: 5,
    });

    const additionalContext = briefing !== "No relevant memory available yet."
      ? `**Subagent Context:**\n${briefing}`
      : undefined;

    return reply.send({
      hookSpecificOutput: { hookEventName: "SubagentStart", additionalContext },
    });
  } catch (err) {
    logger.error({ err, sessionId, subagentId }, "Error in subagent-start hook");
    return reply.send({});
  }
}
