import { v4 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import type { BeliefRow, ScopeType } from "../types.js";

export function createBelief(params: {
  proposition: string;
  scopeType: ScopeType;
  scopeKey?: string;
  confidence?: number;
  evidenceFor?: string[];
  evidenceAgainst?: string[];
}): BeliefRow {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO beliefs (id, proposition, scope_type, scope_key, confidence, evidence_for_json, evidence_against_json, first_derived_at, last_validated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.proposition,
    params.scopeType,
    params.scopeKey ?? "",
    params.confidence ?? 0.5,
    JSON.stringify(params.evidenceFor ?? []),
    JSON.stringify(params.evidenceAgainst ?? []),
    now,
    now
  );

  return db.prepare("SELECT * FROM beliefs WHERE id = ?").get(id) as BeliefRow;
}

export function getBelief(id: string): BeliefRow | undefined {
  return getDb().prepare("SELECT * FROM beliefs WHERE id = ?").get(id) as BeliefRow | undefined;
}

export function getActiveBeliefs(scopeType?: ScopeType, scopeKey?: string, limit = 50): BeliefRow[] {
  const db = getDb();
  if (scopeType && scopeKey) {
    // Match beliefs scoped to this project OR unscoped (legacy empty scope_key)
    return db
      .prepare(
        "SELECT * FROM beliefs WHERE status = 'active' AND scope_type = ? AND (scope_key = ? OR scope_key = '') ORDER BY confidence DESC LIMIT ?"
      )
      .all(scopeType, scopeKey, limit) as BeliefRow[];
  }
  if (scopeType) {
    return db
      .prepare("SELECT * FROM beliefs WHERE status = 'active' AND scope_type = ? ORDER BY confidence DESC LIMIT ?")
      .all(scopeType, limit) as BeliefRow[];
  }
  return db
    .prepare("SELECT * FROM beliefs WHERE status = 'active' ORDER BY confidence DESC LIMIT ?")
    .all(limit) as BeliefRow[];
}

export function searchBeliefs(query: string, limit = 10): BeliefRow[] {
  return getDb()
    .prepare(
      `SELECT b.* FROM beliefs b
       JOIN beliefs_fts fts ON b.rowid = fts.rowid
       WHERE beliefs_fts MATCH ?
       ORDER BY rank
       LIMIT ?`
    )
    .all(query, limit) as BeliefRow[];
}

export function updateBeliefConfidence(id: string, confidence: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  let status: string = "active";
  if (confidence < 0.2) status = "stale";
  if (confidence <= 0) status = "retired";

  db.prepare("UPDATE beliefs SET confidence = ?, status = ?, last_validated_at = ? WHERE id = ?").run(
    confidence,
    status,
    now,
    id
  );
}

export function retireBelief(id: string, reason: string): BeliefRow | undefined {
  const db = getDb();
  const now = new Date().toISOString();
  const existing = getBelief(id);
  if (!existing) return undefined;

  const againstArr = JSON.parse(existing.evidence_against_json) as string[];
  againstArr.push(reason);

  db.prepare("UPDATE beliefs SET status = 'retired', evidence_against_json = ?, last_validated_at = ? WHERE id = ?").run(
    JSON.stringify(againstArr),
    now,
    id
  );

  return getBelief(id);
}

export function addEvidenceFor(id: string, evidence: string): void {
  const db = getDb();
  const existing = getBelief(id);
  if (!existing) return;
  const arr = JSON.parse(existing.evidence_for_json) as string[];
  arr.push(evidence);
  const newConf = Math.min(1, existing.confidence + 0.05);
  db.prepare("UPDATE beliefs SET evidence_for_json = ?, confidence = ?, last_validated_at = ? WHERE id = ?").run(
    JSON.stringify(arr),
    newConf,
    new Date().toISOString(),
    id
  );
}

export function addEvidenceAgainst(id: string, evidence: string): void {
  const db = getDb();
  const existing = getBelief(id);
  if (!existing) return;
  const arr = JSON.parse(existing.evidence_against_json) as string[];
  arr.push(evidence);
  const newConf = Math.max(0, existing.confidence - 0.1);
  const newStatus = newConf < 0.3 ? "disputed" : existing.status;
  db.prepare("UPDATE beliefs SET evidence_against_json = ?, confidence = ?, status = ?, last_validated_at = ? WHERE id = ?").run(
    JSON.stringify(arr),
    newConf,
    newStatus,
    new Date().toISOString(),
    id
  );
}

export function disputeBelief(id: string): void {
  getDb().prepare("UPDATE beliefs SET status = 'disputed' WHERE id = ?").run(id);
}
