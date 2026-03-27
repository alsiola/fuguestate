import { v4 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import { appraiseEvent } from "../appraisal/index.js";
import type { AgentEvent, EventRow, AppraisalScores } from "../types.js";

export function ingestEvent(event: AgentEvent, source: EventRow["source"] = "claude_hook"): { row: EventRow; scores: AppraisalScores } {
  const db = getDb();
  const id = uuid();
  const scores = appraiseEvent(event);

  const sessionId = event.sessionId;
  const taskId = "taskId" in event ? (event.taskId ?? null) : null;
  const subagentId = "subagentId" in event ? (event.subagentId ?? null) : null;

  // Build payload (exclude fields already in columns)
  const { type: _type, sessionId: _sid, ts: _ts, ...rest } = event as Record<string, unknown>;
  const payload = rest;

  db.prepare(
    `INSERT INTO events (id, ts, session_id, task_id, subagent_id, event_type, source, payload_json, salience_score, importance_score, novelty_score, risk_score, contradiction_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    event.ts,
    sessionId,
    taskId,
    subagentId,
    event.type,
    source,
    JSON.stringify(payload),
    scores.salience,
    scores.importance,
    scores.novelty,
    scores.risk,
    scores.contradictionPressure
  );

  const row = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow;
  return { row, scores };
}

export function getRecentEvents(sessionId: string, limit = 50): EventRow[] {
  return getDb()
    .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY ts DESC LIMIT ?")
    .all(sessionId, limit) as EventRow[];
}

export function getEventsByTask(taskId: string, limit = 100): EventRow[] {
  return getDb()
    .prepare("SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC LIMIT ?")
    .all(taskId, limit) as EventRow[];
}

export function getHighSalienceEvents(sessionId: string, minSalience = 0.5, limit = 20): EventRow[] {
  return getDb()
    .prepare("SELECT * FROM events WHERE session_id = ? AND salience_score >= ? ORDER BY ts DESC LIMIT ?")
    .all(sessionId, minSalience, limit) as EventRow[];
}
