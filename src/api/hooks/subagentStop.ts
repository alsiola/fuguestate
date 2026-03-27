import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { getOpenEpisodeForSession, updateEpisode } from "../../domain/episodes/index.js";
import { logger } from "../../app/logger.js";

interface SubagentStopBody {
  session_id?: string;
  sessionId?: string;
  agent_id?: string;
  subagentId?: string;
  agent_type?: string;
  last_assistant_message?: string;
  summary?: string;
  [key: string]: unknown;
}

export async function handleSubagentStop(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as SubagentStopBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const subagentId = body.agent_id ?? body.subagentId ?? "unknown";
  const ts = new Date().toISOString();

  try {
    ingestEvent(
      {
        type: "subagent_stopped",
        sessionId,
        subagentId,
        summary: body.last_assistant_message ?? body.summary,
        ts,
      },
      "claude_hook"
    );

    // Merge subagent findings into current episode
    const summaryText = body.last_assistant_message ?? body.summary;
    if (summaryText) {
      const episode = getOpenEpisodeForSession(sessionId);
      if (episode) {
        const existing = episode.action_summary ?? "";
        const newAction = `${existing}\n- Subagent ${subagentId}: ${(summaryText as string).slice(0, 200)}`.trim();
        updateEpisode(episode.id, { action_summary: newAction });
      }
    }

    return reply.send({});
  } catch (err) {
    logger.error({ err, sessionId, subagentId }, "Error in subagent-stop hook");
    return reply.send({});
  }
}
