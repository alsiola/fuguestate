import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent, getEventsByTask } from "../../domain/events/index.js";
import { getOpenEpisodeForTask, closeEpisode, updateEpisode } from "../../domain/episodes/index.js";
import { setWorkingMemory } from "../../domain/workingMemory/index.js";
import { extractLessons } from "../../app/llm.js";
import { logger } from "../../app/logger.js";

interface TaskCompletedBody {
  session_id?: string;
  sessionId?: string;
  task_id?: string;
  taskId?: string;
  task_subject?: string;
  task_description?: string;
  outcomeSummary?: string;
  [key: string]: unknown;
}

export async function handleTaskCompleted(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as TaskCompletedBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const taskId = body.task_id ?? body.taskId ?? "unknown";
  const outcomeSummary = body.task_subject ?? body.outcomeSummary ?? "Task completed";
  const ts = new Date().toISOString();

  try {
    ingestEvent(
      {
        type: "task_completed",
        sessionId,
        taskId,
        outcomeSummary,
        ts,
      },
      "claude_hook"
    );

    // Close episode immediately (don't block on LLM)
    const episode = getOpenEpisodeForTask(taskId);
    if (episode) {
      closeEpisode(episode.id, outcomeSummary);
    }

    // Update working memory
    setWorkingMemory(sessionId, `task:${taskId}:completed_at`, ts);
    setWorkingMemory(sessionId, `task:${taskId}:outcome`, outcomeSummary);

    // Reply immediately — lesson extraction happens in the background
    reply.send({});

    // Background: extract lessons via LLM and attach to the closed episode
    if (episode) {
      extractLessonsInBackground(taskId, episode.id, episode.goal ?? episode.title, outcomeSummary);
    }
  } catch (err) {
    logger.error({ err, sessionId, taskId }, "Error in task-completed hook");
    return reply.send({});
  }
}

async function extractLessonsInBackground(taskId: string, episodeId: string, goal: string, outcome: string): Promise<void> {
  try {
    const events = getEventsByTask(taskId);
    if (events.length < 3) return;

    const eventSummaries = events.slice(0, 30).map((e) => {
      try {
        const p = JSON.parse(e.payload_json);
        const tool = p.toolName ?? "";
        const detail = p.errorSummary ?? p.outputSummary ?? "";
        return `[${e.event_type}] ${tool} ${detail}`.trim();
      } catch {
        return `[${e.event_type}]`;
      }
    });

    const result = await extractLessons(eventSummaries, goal, outcome);
    if (result && result.lessons.length > 0) {
      const lessons = result.lessons.map((l) => l.proposition);
      updateEpisode(episodeId, {
        lesson_candidates_json: JSON.stringify(lessons),
      });
      logger.info({ episodeId, lessonCount: lessons.length }, "Background lesson extraction complete");
    }
  } catch (err) {
    logger.warn({ err, taskId }, "Background lesson extraction failed (non-fatal)");
  }
}
