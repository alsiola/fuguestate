import { v4 as uuid } from "uuid";
import { getDb } from "../../db/client.js";
import type { ProfileRow } from "../types.js";

export function setProfile(params: {
  profileType: "user" | "project" | "repo";
  scopeKey?: string;
  key: string;
  value: unknown;
  confidence?: number;
  source?: string;
}): ProfileRow {
  const db = getDb();
  const id = uuid();
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO profiles (id, profile_type, scope_key, key, value_json, confidence, source, last_validated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_type, scope_key, key) DO UPDATE SET
       value_json = excluded.value_json,
       confidence = excluded.confidence,
       source = excluded.source,
       last_validated_at = excluded.last_validated_at`
  ).run(
    id,
    params.profileType,
    params.scopeKey ?? "",
    params.key,
    JSON.stringify(params.value),
    params.confidence ?? 0.5,
    params.source ?? null,
    now
  );

  return db
    .prepare("SELECT * FROM profiles WHERE profile_type = ? AND scope_key = ? AND key = ?")
    .get(params.profileType, params.scopeKey ?? "", params.key) as ProfileRow;
}

export function getProfile(profileType: string, scopeKey: string, key: string): ProfileRow | undefined {
  return getDb()
    .prepare("SELECT * FROM profiles WHERE profile_type = ? AND scope_key = ? AND key = ?")
    .get(profileType, scopeKey, key) as ProfileRow | undefined;
}

export function getProfilesByType(profileType: string, scopeKey?: string): ProfileRow[] {
  const db = getDb();
  if (scopeKey !== undefined) {
    return db
      .prepare("SELECT * FROM profiles WHERE profile_type = ? AND scope_key = ?")
      .all(profileType, scopeKey) as ProfileRow[];
  }
  return db
    .prepare("SELECT * FROM profiles WHERE profile_type = ?")
    .all(profileType) as ProfileRow[];
}

export function getUserPreferences(userId?: string): ProfileRow[] {
  const db = getDb();
  if (userId) {
    return db
      .prepare("SELECT * FROM profiles WHERE profile_type = 'user' AND scope_key = ?")
      .all(userId) as ProfileRow[];
  }
  return db
    .prepare("SELECT * FROM profiles WHERE profile_type = 'user'")
    .all() as ProfileRow[];
}
