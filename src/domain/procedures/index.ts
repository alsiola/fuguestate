import { v4 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import type { ProcedureRow, ScopeType } from "../types.js";

export function createProcedure(params: {
  name: string;
  triggerDescription?: string;
  stepsMarkdown: string;
  successSignals?: string[];
  failureSmells?: string[];
  scopeType: ScopeType;
  scopeKey?: string;
  confidence?: number;
  sourceEpisodeIds?: string[];
}): ProcedureRow {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO procedures (id, name, trigger_description, steps_markdown, success_signals_json, failure_smells_json, scope_type, scope_key, confidence, source_episode_ids_json, last_validated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.name,
    params.triggerDescription ?? null,
    params.stepsMarkdown,
    JSON.stringify(params.successSignals ?? []),
    JSON.stringify(params.failureSmells ?? []),
    params.scopeType,
    params.scopeKey ?? "",
    params.confidence ?? 0.5,
    JSON.stringify(params.sourceEpisodeIds ?? []),
    now
  );

  return db.prepare("SELECT * FROM procedures WHERE id = ?").get(id) as ProcedureRow;
}

export function getProcedure(id: string): ProcedureRow | undefined {
  return getDb().prepare("SELECT * FROM procedures WHERE id = ?").get(id) as ProcedureRow | undefined;
}

export function searchProcedures(query: string, limit = 10): ProcedureRow[] {
  return getDb()
    .prepare(
      `SELECT p.* FROM procedures p
       JOIN procedures_fts fts ON p.rowid = fts.rowid
       WHERE procedures_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(query, limit) as ProcedureRow[];
}

export function getProceduresByScope(scopeType?: ScopeType, scopeKey?: string, limit = 20): ProcedureRow[] {
  const db = getDb();
  if (scopeType && scopeKey !== undefined) {
    return db
      .prepare("SELECT * FROM procedures WHERE scope_type = ? AND scope_key = ? ORDER BY confidence DESC LIMIT ?")
      .all(scopeType, scopeKey, limit) as ProcedureRow[];
  }
  return db
    .prepare("SELECT * FROM procedures ORDER BY confidence DESC LIMIT ?")
    .all(limit) as ProcedureRow[];
}
