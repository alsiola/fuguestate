import { v4 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import type { EpisodeRow } from "../types.js";

export function createEpisode(params: {
  sessionId: string;
  taskId?: string;
  title: string;
  goal?: string;
  contextSummary?: string;
  salienceScore?: number;
}): EpisodeRow {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO episodes (id, session_id, task_id, title, goal, context_summary, status, salience_score, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)`
  ).run(
    id,
    params.sessionId,
    params.taskId ?? null,
    params.title,
    params.goal ?? null,
    params.contextSummary ?? null,
    params.salienceScore ?? 0,
    now
  );

  return db.prepare("SELECT * FROM episodes WHERE id = ?").get(id) as EpisodeRow;
}

export function updateEpisode(
  id: string,
  updates: Partial<Pick<EpisodeRow, "action_summary" | "outcome_summary" | "lesson_candidates_json" | "status" | "salience_score" | "ended_at">>
): EpisodeRow | undefined {
  const db = getDb();
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const [key, val] of Object.entries(updates)) {
    if (val !== undefined) {
      sets.push(`${key} = ?`);
      vals.push(val);
    }
  }

  if (sets.length === 0) return getEpisode(id);

  vals.push(id);
  db.prepare(`UPDATE episodes SET ${sets.join(", ")} WHERE id = ?`).run(...vals);

  return getEpisode(id);
}

export function closeEpisode(
  id: string,
  outcomeSummary: string,
  lessons: string[] = []
): EpisodeRow | undefined {
  return updateEpisode(id, {
    outcome_summary: outcomeSummary,
    lesson_candidates_json: JSON.stringify(lessons),
    status: "closed",
    ended_at: new Date().toISOString(),
  });
}

export function getEpisode(id: string): EpisodeRow | undefined {
  return getDb().prepare("SELECT * FROM episodes WHERE id = ?").get(id) as EpisodeRow | undefined;
}

export function getOpenEpisodeForTask(taskId: string): EpisodeRow | undefined {
  return getDb()
    .prepare("SELECT * FROM episodes WHERE task_id = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1")
    .get(taskId) as EpisodeRow | undefined;
}

export function getEpisodeForTask(taskId: string): EpisodeRow | undefined {
  return getDb()
    .prepare("SELECT * FROM episodes WHERE task_id = ? ORDER BY started_at DESC LIMIT 1")
    .get(taskId) as EpisodeRow | undefined;
}

export function getOpenEpisodeForSession(sessionId: string): EpisodeRow | undefined {
  return getDb()
    .prepare("SELECT * FROM episodes WHERE session_id = ? AND status = 'open' ORDER BY started_at DESC LIMIT 1")
    .get(sessionId) as EpisodeRow | undefined;
}

export function getRecentEpisodes(sessionId: string, limit = 10): EpisodeRow[] {
  return getDb()
    .prepare("SELECT * FROM episodes WHERE session_id = ? ORDER BY started_at DESC LIMIT ?")
    .all(sessionId, limit) as EpisodeRow[];
}

export function searchEpisodes(query: string, limit = 10): EpisodeRow[] {
  const db = getDb();
  const ftsResults = db
    .prepare(
      `SELECT e.* FROM episodes e
       JOIN episodes_fts fts ON e.rowid = fts.rowid
       WHERE episodes_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(query, limit) as EpisodeRow[];
  return ftsResults;
}

export function getEpisodesByScope(scopeKey: string, limit = 20): EpisodeRow[] {
  // Episodes don't have scope directly, but we can filter by session context
  return getDb()
    .prepare("SELECT * FROM episodes ORDER BY started_at DESC LIMIT ?")
    .all(limit) as EpisodeRow[];
}
