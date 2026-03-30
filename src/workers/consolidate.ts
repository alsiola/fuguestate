import { getDb } from "../db/client.js";
import { getActiveBeliefs, createBelief, updateBeliefConfidence } from "../domain/beliefs/index.js";
import { createProcedure } from "../domain/procedures/index.js";
import { generateBriefing, cacheBriefing } from "../domain/briefing/index.js";
import { createEpisode, closeEpisode, getOpenEpisodeForSession } from "../domain/episodes/index.js";
import { deduplicateStrings, deduplicateBeliefs, extractLessons } from "../app/llm.js";
import { logger } from "../app/logger.js";
import type { EpisodeRow, EventRow } from "../domain/types.js";

export async function runConsolidation(): Promise<void> {
  try {
    logger.info("Running consolidation...");

    createEpisodesFromEventClusters();
    closeStaleEpisodes();
    summariseRecentEvents();
    await mergeDuplicateNotes();
    await extractEpisodeLessons();
    await createBeliefCandidates();
    createProcedureCandidates();
    updateExistingBeliefs();
    pruneStaleWorkingMemory();
    snapshotBeliefConfidence();
    regenerateBriefingCache();

    logger.info("Consolidation complete");
  } catch (err) {
    logger.error({ err }, "Consolidation worker error");
  }
}

/**
 * Create episodes from event clusters for sessions that don't use task tools.
 * Groups events by session, and if a session has enough activity without an
 * existing open episode, creates one from the event stream.
 */
function createEpisodesFromEventClusters(): void {
  const db = getDb();

  // Find sessions that have events but no episode at all
  const activeSessions = db
    .prepare(
      `SELECT e.session_id, COUNT(*) as cnt,
              MIN(e.ts) as first_ts, MAX(e.ts) as last_ts,
              MAX(e.salience_score) as max_salience,
              AVG(e.salience_score) as avg_salience
       FROM events e
       LEFT JOIN episodes ep ON ep.session_id = e.session_id
       WHERE e.event_type NOT IN ('task_started', 'task_completed')
       AND ep.id IS NULL
       GROUP BY e.session_id
       HAVING cnt >= 3`
    )
    .all() as Array<{
    session_id: string;
    cnt: number;
    first_ts: string;
    last_ts: string;
    max_salience: number;
    avg_salience: number;
  }>;

  for (const session of activeSessions) {
    // Skip if there's already an open episode for this session
    const existing = getOpenEpisodeForSession(session.session_id);
    if (existing) continue;

    // Build title from user prompts (which describe intent) rather than tool names
    const prompts = db
      .prepare(
        `SELECT payload_json FROM events
         WHERE session_id = ? AND event_type = 'prompt_submitted'
         ORDER BY ts ASC
         LIMIT 10`
      )
      .all(session.session_id) as Array<{ payload_json: string }>;

    let title = `Session activity (${session.cnt} events)`;
    let goal = title;

    if (prompts.length > 0) {
      const promptTexts: string[] = [];
      for (const p of prompts) {
        try {
          const payload = JSON.parse(p.payload_json);
          const text = ((payload.prompt as string) ?? "").trim();
          if (text && text.length > 5) promptTexts.push(text);
        } catch {
          // skip
        }
      }

      if (promptTexts.length > 0) {
        // Pick the first prompt that looks like a task description (>20 chars, starts with
        // a verb or question word) rather than a short reply like "yes" or "repin that"
        const taskPrompt = promptTexts.find((t) => t.length > 20) ?? promptTexts[0];
        title = taskPrompt.slice(0, 120);
        // Goal captures the full conversation arc
        goal = promptTexts.length === 1
          ? promptTexts[0]
          : promptTexts.slice(0, 5).join(" → ");
      }
    }

    const ep = createEpisode({
      sessionId: session.session_id,
      title,
      goal,
      salienceScore: session.max_salience,
    });

    logger.info(
      { episodeId: ep.id, sessionId: session.session_id, eventCount: session.cnt },
      "Created episode from event cluster"
    );
  }
}

/**
 * Close episodes that have been open too long (no new events for 15+ minutes)
 * and extract lessons from them. This handles sessions where task hooks
 * never fire (i.e., most conversations).
 */
function closeStaleEpisodes(): void {
  const db = getDb();

  const staleEpisodes = db
    .prepare(
      `SELECT e.* FROM episodes e
       WHERE e.status = 'open'
       AND e.started_at < datetime('now', '-15 minutes')
       AND NOT EXISTS (
         SELECT 1 FROM events ev
         WHERE ev.session_id = e.session_id
         AND ev.ts > datetime('now', '-10 minutes')
       )`
    )
    .all() as EpisodeRow[];

  for (const ep of staleEpisodes) {
    // Build an outcome summary from the event stream
    const events = db
      .prepare(
        `SELECT event_type, payload_json, salience_score FROM events
         WHERE session_id = ? AND ts >= ?
         ORDER BY ts ASC LIMIT 30`
      )
      .all(ep.session_id, ep.started_at) as Array<{
      event_type: string;
      payload_json: string;
      salience_score: number;
    }>;

    const toolSuccesses = events.filter((e) => e.event_type === "tool_succeeded").length;
    const toolFailures = events.filter((e) => e.event_type === "tool_failed").length;
    const outcome = `Session ended with ${toolSuccesses} tool successes and ${toolFailures} failures across ${events.length} events`;

    // Extract heuristic lessons from high-salience events
    const lessons: string[] = [];
    for (const ev of events) {
      if (ev.salience_score >= 0.5) {
        try {
          const payload = JSON.parse(ev.payload_json);
          if (ev.event_type === "tool_failed") {
            const tool = payload.toolName ?? "unknown tool";
            lessons.push(`${tool} failed: ${(payload.errorSummary ?? "").slice(0, 200)}`);
          }
        } catch {
          // skip
        }
      }
    }

    closeEpisode(ep.id, outcome, lessons);
    logger.info(
      { episodeId: ep.id, eventCount: events.length, lessonCount: lessons.length },
      "Auto-closed stale episode"
    );
  }
}

function summariseRecentEvents(): void {
  const db = getDb();
  // Find open episodes that have unsummarised events
  const openEpisodes = db
    .prepare("SELECT * FROM episodes WHERE status = 'open' AND started_at < datetime('now', '-5 minutes')")
    .all() as EpisodeRow[];

  for (const ep of openEpisodes) {
    // Count related events
    const eventCount = db
      .prepare("SELECT COUNT(*) as cnt FROM events WHERE session_id = ? AND ts >= ?")
      .get(ep.session_id, ep.started_at) as { cnt: number };

    if (eventCount.cnt > 0 && !ep.context_summary) {
      // Build a simple context summary from high-salience events
      const events = db
        .prepare(
          "SELECT event_type, payload_json, salience_score FROM events WHERE session_id = ? AND ts >= ? ORDER BY salience_score DESC LIMIT 5"
        )
        .all(ep.session_id, ep.started_at) as Array<{ event_type: string; payload_json: string; salience_score: number }>;

      const summary = events.map((e) => `${e.event_type} (salience: ${e.salience_score.toFixed(2)})`).join("; ");
      db.prepare("UPDATE episodes SET context_summary = ? WHERE id = ?").run(summary, ep.id);
    }
  }
}

async function mergeDuplicateNotes(): Promise<void> {
  const db = getDb();
  const loops = db
    .prepare("SELECT * FROM open_loops WHERE status = 'open' ORDER BY title")
    .all() as Array<{ id: string; title: string }>;

  if (loops.length <= 1) return;

  const titles = loops.map((l) => l.title);
  const result = await deduplicateStrings(titles);

  if (!result) {
    // LLM unavailable — fall back to exact-match dedup
    const seen = new Map<string, string>();
    for (const loop of loops) {
      const normalized = loop.title.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (seen.has(normalized)) {
        db.prepare("UPDATE open_loops SET status = 'dismissed', resolved_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          loop.id
        );
      } else {
        seen.set(normalized, loop.id);
      }
    }
    return;
  }

  // Build title→id lookup
  const titleToId = new Map(loops.map((l) => [l.title, l.id]));

  for (const group of result.groups) {
    for (const dup of group.duplicates) {
      const id = titleToId.get(dup);
      if (id) {
        db.prepare("UPDATE open_loops SET status = 'dismissed', resolved_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          id
        );
        logger.info({ canonical: group.canonical, duplicate: dup }, "Semantically merged duplicate loop");
      }
    }
  }
}

/**
 * For recently closed episodes that lack rich lessons (e.g. closed by
 * the taskCompleted hook with only heuristic lessons), ask Claude to
 * extract meaningful lessons from the event stream.
 */
async function extractEpisodeLessons(): Promise<void> {
  const db = getDb();

  // Find episodes closed in the last consolidation window that have
  // no lessons or only auto-generated ones (they contain "is fragile" or "high salience")
  const recentClosed = db
    .prepare(
      `SELECT * FROM episodes
       WHERE status = 'closed'
       AND ended_at > datetime('now', '-10 minutes')
       AND (lesson_candidates_json = '[]' OR lesson_candidates_json LIKE '%is fragile%' OR lesson_candidates_json LIKE '%high salience%')
       LIMIT 5`
    )
    .all() as EpisodeRow[];

  for (const ep of recentClosed) {
    // Query by task_id if available, otherwise by session_id + time window
    const events = ep.task_id
      ? db
          .prepare(
            "SELECT event_type, payload_json, salience_score FROM events WHERE task_id = ? ORDER BY ts ASC LIMIT 30"
          )
          .all(ep.task_id) as Array<{ event_type: string; payload_json: string; salience_score: number }>
      : db
          .prepare(
            "SELECT event_type, payload_json, salience_score FROM events WHERE session_id = ? AND ts >= ? AND ts <= ? ORDER BY ts ASC LIMIT 30"
          )
          .all(ep.session_id, ep.started_at, ep.ended_at ?? new Date().toISOString()) as Array<{ event_type: string; payload_json: string; salience_score: number }>;

    if (events.length < 3) continue;

    const eventSummaries = events.map((e) => {
      try {
        const p = JSON.parse(e.payload_json);
        const tool = p.toolName ?? "";
        const error = p.errorSummary ?? p.outputSummary ?? "";
        return `[${e.event_type}] ${tool} ${error}`.trim();
      } catch {
        return `[${e.event_type}]`;
      }
    });

    const result = await extractLessons(
      eventSummaries,
      ep.goal ?? ep.title,
      ep.outcome_summary ?? "completed"
    );

    if (result && result.lessons.length > 0) {
      const existingLessons = JSON.parse(ep.lesson_candidates_json) as string[];
      const newLessons = result.lessons.map((l) => l.proposition);
      const merged = [...new Set([...existingLessons, ...newLessons])];

      db.prepare("UPDATE episodes SET lesson_candidates_json = ? WHERE id = ?").run(
        JSON.stringify(merged),
        ep.id
      );
      logger.info({ episodeId: ep.id, lessonCount: newLessons.length }, "Extracted lessons via LLM");
    }
  }
}

async function createBeliefCandidates(): Promise<void> {
  const db = getDb();
  // Collect all lessons from recent closed episodes
  const closedEpisodes = db
    .prepare("SELECT * FROM episodes WHERE status = 'closed' AND lesson_candidates_json != '[]' ORDER BY ended_at DESC LIMIT 50")
    .all() as EpisodeRow[];

  // Count lesson occurrences (still useful as a signal, but dedup is now semantic)
  const allLessons: string[] = [];
  const lessonCounts = new Map<string, number>();
  for (const ep of closedEpisodes) {
    const lessons = JSON.parse(ep.lesson_candidates_json) as string[];
    for (const lesson of lessons) {
      allLessons.push(lesson);
      const normalized = lesson.toLowerCase().trim();
      lessonCounts.set(normalized, (lessonCounts.get(normalized) ?? 0) + 1);
    }
  }

  // Consider lessons that appear in 1+ episodes (lowered from 2 to bootstrap early usage)
  const candidates = [...new Set(
    allLessons.filter((l) => (lessonCounts.get(l.toLowerCase().trim()) ?? 0) >= 1)
  )];

  if (candidates.length === 0) return;

  // Use semantic dedup against existing beliefs
  const existingBeliefs = getActiveBeliefs(undefined, undefined, 500).map((b) => ({
    id: b.id,
    proposition: b.proposition,
  }));

  const dedupResult = await deduplicateBeliefs(candidates, existingBeliefs);

  if (!dedupResult) {
    // LLM unavailable — fall back to exact-match check
    for (const lesson of candidates) {
      const existing = db
        .prepare("SELECT id FROM beliefs WHERE LOWER(proposition) = ?")
        .get(lesson.toLowerCase().trim()) as { id: string } | undefined;
      if (!existing) {
        const count = lessonCounts.get(lesson.toLowerCase().trim()) ?? 2;
        createBelief({
          proposition: lesson,
          scopeType: "project",
          confidence: Math.min(0.3 + count * 0.1, 0.8),
          evidenceFor: [`Observed in ${count} episodes`],
        });
        logger.info({ lesson, count }, "Promoted belief candidate (heuristic fallback)");
      }
    }
    return;
  }

  for (const belief of dedupResult.unique_beliefs) {
    if (belief.is_new) {
      const count = lessonCounts.get(belief.proposition.toLowerCase().trim()) ?? 2;
      createBelief({
        proposition: belief.proposition,
        scopeType: "project",
        confidence: Math.min(0.3 + count * 0.1, 0.8),
        evidenceFor: [`Observed in ${count} episodes`],
      });
      logger.info({ proposition: belief.proposition, count }, "Promoted belief candidate (LLM verified)");
    } else if (belief.existing_match_id) {
      logger.debug({ proposition: belief.proposition, matchId: belief.existing_match_id }, "Skipped duplicate belief");
    }
  }
}

function createProcedureCandidates(): void {
  const db = getDb();
  // Find repeated successful tool sequences
  const recentSuccess = db
    .prepare(
      `SELECT session_id, GROUP_CONCAT(event_type || ':' || SUBSTR(payload_json, 1, 50), ' -> ') as sequence
       FROM events
       WHERE event_type IN ('tool_succeeded')
       GROUP BY session_id
       HAVING COUNT(*) >= 3
       ORDER BY ts DESC
       LIMIT 10`
    )
    .all() as Array<{ session_id: string; sequence: string }>;

  // This is a placeholder for more sophisticated sequence detection
  // In v1, we mainly rely on explicit procedure extraction via MCP tools
}

function updateExistingBeliefs(): void {
  const beliefs = getActiveBeliefs(undefined, undefined, 100);
  const now = Date.now();

  for (const belief of beliefs) {
    if (!belief.last_validated_at) continue;
    const age = now - new Date(belief.last_validated_at).getTime();
    const daysSinceValidation = age / (1000 * 60 * 60 * 24);

    // Slight confidence decay for unvalidated beliefs
    if (daysSinceValidation > 7) {
      const decay = belief.decay_rate * Math.floor(daysSinceValidation / 7);
      const newConf = Math.max(0.1, belief.confidence - decay);
      if (newConf !== belief.confidence) {
        updateBeliefConfidence(belief.id, newConf);
      }
    }
  }
}

function pruneStaleWorkingMemory(): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare("DELETE FROM working_memory WHERE expires_at IS NOT NULL AND expires_at < ?").run(now);
}

function regenerateBriefingCache(): void {
  const db = getDb();
  // Clear old cache
  db.prepare("DELETE FROM retrieval_cache WHERE generated_at < datetime('now', '-1 hour')").run();

  // Regenerate project briefing
  const briefing = generateBriefing({ scope: "project" });
  if (briefing !== "No relevant memory available yet.") {
    cacheBriefing("briefing:project:default", "project_briefing", briefing, 300);
  }
}

function snapshotBeliefConfidence(): void {
  const db = getDb();
  const beliefs = getActiveBeliefs(undefined, undefined, 100);
  const now = new Date().toISOString();

  const stmt = db.prepare("INSERT INTO belief_history (belief_id, confidence, recorded_at) VALUES (?, ?, ?)");
  for (const b of beliefs) {
    // Only snapshot if the last snapshot was >5 min ago or doesn't exist
    const last = db.prepare(
      "SELECT recorded_at FROM belief_history WHERE belief_id = ? ORDER BY recorded_at DESC LIMIT 1"
    ).get(b.id) as { recorded_at: string } | undefined;

    if (!last || (Date.now() - new Date(last.recorded_at).getTime()) > 300_000) {
      stmt.run(b.id, b.confidence, now);
    }
  }
}
