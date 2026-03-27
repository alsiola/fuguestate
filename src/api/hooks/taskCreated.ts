import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { createEpisode } from "../../domain/episodes/index.js";
import { setWorkingMemory } from "../../domain/workingMemory/index.js";
import { logger } from "../../app/logger.js";

interface TaskCreatedBody {
  session_id?: string;
  sessionId?: string;
  task_id?: string;
  taskId?: string;
  task_subject?: string;
  task_description?: string;
  goal?: string;
  [key: string]: unknown;
}

export async function handleTaskCreated(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as TaskCreatedBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const taskId = body.task_id ?? body.taskId ?? "unknown";
  const goal = body.task_subject ?? body.task_description ?? body.goal ?? "Task started";
  const ts = new Date().toISOString();

  try {
    const { scores } = ingestEvent(
      {
        type: "task_started",
        sessionId,
        taskId,
        goal,
        ts,
      },
      "claude_hook"
    );

    // Create episode shell
    createEpisode({
      sessionId,
      taskId,
      title: goal.slice(0, 120),
      goal,
      salienceScore: scores.salience,
    });

    // Init task-local working memory
    setWorkingMemory(sessionId, `task:${taskId}:goal`, goal);
    setWorkingMemory(sessionId, `task:${taskId}:started_at`, ts);

    return reply.send({});
  } catch (err) {
    logger.error({ err, sessionId, taskId }, "Error in task-created hook");
    return reply.send({});
  }
}
