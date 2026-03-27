import { getDb } from "../../db/client.js";
import { searchEpisodes } from "../episodes/index.js";
import { searchBeliefs, getActiveBeliefs } from "../beliefs/index.js";
import { searchProcedures } from "../procedures/index.js";
import { getOpenLoops } from "../openLoops/index.js";
import { scoreLoopRelevance } from "../../app/llm.js";
import { logger } from "../../app/logger.js";
import type { RetrievalResult, ScopeType } from "../types.js";

export interface SearchParams {
  query: string;
  memoryTypes?: Array<"episode" | "belief" | "procedure" | "open_loop" | "profile" | "event">;
  scopeType?: ScopeType;
  scopeKey?: string;
  limit?: number;
}

export async function search(params: SearchParams): Promise<RetrievalResult[]> {
  const results: RetrievalResult[] = [];
  const types = params.memoryTypes ?? ["episode", "belief", "procedure", "open_loop"];
  const limit = params.limit ?? 20;
  const perTypeLimit = Math.ceil(limit / types.length);

  // Sanitize FTS query — remove special chars that break fts5
  const ftsQuery = sanitizeFtsQuery(params.query);
  if (!ftsQuery) return results;

  if (types.includes("episode")) {
    try {
      const episodes = searchEpisodes(ftsQuery, perTypeLimit);
      for (const ep of episodes) {
        results.push({
          type: "episode",
          id: ep.id,
          score: ep.salience_score,
          summary: `[${ep.status}] ${ep.title}: ${ep.outcome_summary ?? ep.goal ?? ""}`,
          confidence: undefined,
          scope: ep.session_id,
        });
      }
    } catch {
      // FTS match failure is non-fatal
    }
  }

  if (types.includes("belief")) {
    try {
      const beliefs = searchBeliefs(ftsQuery, perTypeLimit);
      for (const b of beliefs) {
        results.push({
          type: "belief",
          id: b.id,
          score: b.confidence,
          summary: `[${b.status}] ${b.proposition}`,
          confidence: b.confidence,
          scope: `${b.scope_type}:${b.scope_key}`,
        });
      }
    } catch {
      // FTS match failure
    }
  }

  if (types.includes("procedure")) {
    try {
      const procs = searchProcedures(ftsQuery, perTypeLimit);
      for (const p of procs) {
        results.push({
          type: "procedure",
          id: p.id,
          score: p.confidence,
          summary: `${p.name}: ${p.trigger_description ?? ""}`,
          confidence: p.confidence,
          scope: `${p.scope_type}:${p.scope_key}`,
        });
      }
    } catch {
      // FTS match failure
    }
  }

  if (types.includes("open_loop")) {
    const loops = getOpenLoops({
      scopeType: params.scopeType,
      scopeKey: params.scopeKey,
      limit: perTypeLimit,
    });

    if (loops.length > 0) {
      // Try LLM-based relevance scoring
      const llmScores = await scoreLoopRelevance(
        params.query,
        loops.map((l) => ({ id: l.id, title: l.title, description: l.description ?? undefined }))
      );

      if (llmScores) {
        const scoreMap = new Map(llmScores.scores.map((s) => [s.loop_id, s]));
        for (const l of loops) {
          const score = scoreMap.get(l.id);
          if (score?.relevant || types.length === 1) {
            results.push({
              type: "open_loop",
              id: l.id,
              score: score?.score ?? l.priority * 0.5,
              summary: `[${l.loop_type}] ${l.title}`,
              scope: `${l.scope_type}:${l.scope_key}`,
            });
          }
        }
      } else {
        // Fallback to keyword matching if LLM unavailable
        logger.warn("LLM unavailable for loop relevance, falling back to keyword matching");
        for (const l of loops) {
          const text = `${l.title} ${l.description ?? ""}`.toLowerCase();
          const words = params.query.toLowerCase().split(/\s+/);
          const matchCount = words.filter((w) => text.includes(w)).length;
          if (matchCount > 0 || types.length === 1) {
            results.push({
              type: "open_loop",
              id: l.id,
              score: l.priority * (matchCount / Math.max(words.length, 1)),
              summary: `[${l.loop_type}] ${l.title}`,
              scope: `${l.scope_type}:${l.scope_key}`,
            });
          }
        }
      }
    }
  }

  if (types.includes("event")) {
    try {
      const db = getDb();
      const events = db
        .prepare(
          `SELECT e.* FROM events e
           JOIN events_fts fts ON e.rowid = fts.rowid
           WHERE events_fts MATCH ?
           ORDER BY rank
           LIMIT ?`
        )
        .all(ftsQuery, perTypeLimit) as Array<{ id: string; event_type: string; salience_score: number; payload_json: string }>;

      for (const ev of events) {
        results.push({
          type: "event",
          id: ev.id,
          score: ev.salience_score,
          summary: `[${ev.event_type}] ${truncate(ev.payload_json, 120)}`,
        });
      }
    } catch {
      // FTS failure
    }
  }

  if (types.includes("profile")) {
    const db = getDb();
    const profiles = db
      .prepare("SELECT * FROM profiles WHERE key LIKE ? OR value_json LIKE ? LIMIT ?")
      .all(`%${params.query}%`, `%${params.query}%`, perTypeLimit) as Array<{
      id: string;
      profile_type: string;
      key: string;
      value_json: string;
      confidence: number;
    }>;

    for (const p of profiles) {
      results.push({
        type: "profile",
        id: p.id,
        score: p.confidence,
        summary: `[${p.profile_type}] ${p.key}: ${truncate(p.value_json, 80)}`,
        confidence: p.confidence,
      });
    }
  }

  // Sort by score descending, cap at limit
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special chars, keep words
  const words = query
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  if (words.length === 0) return "";

  // Use prefix matching with OR so partial stems still return results.
  // "parse validate" → "parse* OR validate*" which matches "parsing", "validation", etc.
  return words.map((w) => w + "*").join(" OR ");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "...";
}
