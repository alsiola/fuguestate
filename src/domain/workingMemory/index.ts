import { v4 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import type { WorkingMemoryRow } from "../types.js";

export function setWorkingMemory(
  sessionId: string,
  key: string,
  value: unknown,
  ttlMs?: number
): void {
  const db = getDb();
  const now = new Date();
  const expiresAt = ttlMs ? new Date(now.getTime() + ttlMs).toISOString() : null;

  db.prepare(
    `INSERT INTO working_memory (id, session_id, key, value_json, updated_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(session_id, key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at, expires_at = excluded.expires_at`
  ).run(uuid(), sessionId, key, JSON.stringify(value), now.toISOString(), expiresAt);
}

export function getWorkingMemory(sessionId: string, key: string): unknown | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM working_memory WHERE session_id = ? AND key = ?")
    .get(sessionId, key) as WorkingMemoryRow | undefined;

  if (!row) return null;

  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM working_memory WHERE id = ?").run(row.id);
    return null;
  }

  return JSON.parse(row.value_json);
}

export function getAllWorkingMemory(sessionId: string): Record<string, unknown> {
  const db = getDb();
  const now = new Date().toISOString();

  // Clean expired
  db.prepare("DELETE FROM working_memory WHERE expires_at IS NOT NULL AND expires_at < ?").run(now);

  const rows = db
    .prepare("SELECT * FROM working_memory WHERE session_id = ?")
    .all(sessionId) as WorkingMemoryRow[];

  const result: Record<string, unknown> = {};
  for (const row of rows) {
    result[row.key] = JSON.parse(row.value_json);
  }
  return result;
}

export function clearWorkingMemory(sessionId: string): void {
  getDb().prepare("DELETE FROM working_memory WHERE session_id = ?").run(sessionId);
}
