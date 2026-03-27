import { v4 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import type { OpenLoopRow, ScopeType } from "../types.js";

export function createOpenLoop(params: {
  title: string;
  description?: string;
  loopType: "contradiction" | "followup" | "risk" | "todo";
  scopeType: ScopeType;
  scopeKey?: string;
  priority?: number;
  linkedBeliefIds?: string[];
  linkedEpisodeIds?: string[];
  suggestedNextCheck?: string;
}): OpenLoopRow {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO open_loops (id, title, description, loop_type, scope_type, scope_key, priority, status, linked_belief_ids_json, linked_episode_ids_json, suggested_next_check, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`
  ).run(
    id,
    params.title,
    params.description ?? null,
    params.loopType,
    params.scopeType,
    params.scopeKey ?? "",
    params.priority ?? 0.5,
    JSON.stringify(params.linkedBeliefIds ?? []),
    JSON.stringify(params.linkedEpisodeIds ?? []),
    params.suggestedNextCheck ?? null,
    now
  );

  return db.prepare("SELECT * FROM open_loops WHERE id = ?").get(id) as OpenLoopRow;
}

export function resolveOpenLoop(id: string, resolution: string): OpenLoopRow | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE open_loops SET status = 'resolved', description = COALESCE(description, '') || '\n\nResolution: ' || ?, resolved_at = ? WHERE id = ?"
  ).run(resolution, now, id);
  return db.prepare("SELECT * FROM open_loops WHERE id = ?").get(id) as OpenLoopRow | undefined;
}

export function dismissOpenLoop(id: string): void {
  getDb().prepare("UPDATE open_loops SET status = 'dismissed', resolved_at = ? WHERE id = ?").run(
    new Date().toISOString(),
    id
  );
}

export function getOpenLoops(params?: {
  scopeType?: ScopeType;
  scopeKey?: string;
  priorityMin?: number;
  limit?: number;
}): OpenLoopRow[] {
  const db = getDb();
  const conditions: string[] = ["status = 'open'"];
  const vals: unknown[] = [];

  if (params?.scopeType) {
    conditions.push("scope_type = ?");
    vals.push(params.scopeType);
  }
  if (params?.scopeKey !== undefined) {
    conditions.push("scope_key = ?");
    vals.push(params.scopeKey);
  }
  if (params?.priorityMin !== undefined) {
    conditions.push("priority >= ?");
    vals.push(params.priorityMin);
  }

  const limit = params?.limit ?? 20;
  vals.push(limit);

  return db
    .prepare(`SELECT * FROM open_loops WHERE ${conditions.join(" AND ")} ORDER BY priority DESC LIMIT ?`)
    .all(...vals) as OpenLoopRow[];
}

export function getOpenLoop(id: string): OpenLoopRow | undefined {
  return getDb().prepare("SELECT * FROM open_loops WHERE id = ?").get(id) as OpenLoopRow | undefined;
}
