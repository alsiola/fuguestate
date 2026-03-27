import { getDb } from "../db/client.js";
import { logger } from "../app/logger.js";

export function runDecay(): void {
  try {
    logger.info("Running decay...");

    decayBeliefConfidence();
    retireDeadBeliefs();
    compressOldEvents();
    cleanupExpiredCache();

    logger.info("Decay complete");
  } catch (err) {
    logger.error({ err }, "Decay worker error");
  }
}

function decayBeliefConfidence(): void {
  const db = getDb();

  // Decay beliefs that haven't been validated or used recently
  db.prepare(
    `UPDATE beliefs SET
       confidence = MAX(0.05, confidence - decay_rate),
       status = CASE
         WHEN (confidence - decay_rate) < 0.2 THEN 'stale'
         ELSE status
       END
     WHERE status = 'active'
     AND last_validated_at < datetime('now', '-14 days')
     AND last_used_at IS NULL OR last_used_at < datetime('now', '-14 days')`
  ).run();
}

function retireDeadBeliefs(): void {
  const db = getDb();

  // Retire beliefs with near-zero confidence
  const retireResult = db.prepare(
    "UPDATE beliefs SET status = 'retired' WHERE status IN ('active', 'stale') AND confidence <= 0.05"
  ).run();

  if (retireResult.changes > 0) {
    logger.info({ count: retireResult.changes }, "Retired dead beliefs");
  }
}

function compressOldEvents(): void {
  const db = getDb();

  // Delete low-salience events older than 30 days that are captured in episodes
  const result = db.prepare(
    `DELETE FROM events
     WHERE salience_score < 0.3
     AND ts < datetime('now', '-30 days')
     AND session_id IN (
       SELECT DISTINCT session_id FROM episodes WHERE status = 'closed'
     )`
  ).run();

  if (result.changes > 0) {
    logger.info({ count: result.changes }, "Compressed old events");
  }
}

function cleanupExpiredCache(): void {
  const db = getDb();
  db.prepare(
    "DELETE FROM retrieval_cache WHERE datetime(generated_at, '+' || ttl_seconds || ' seconds') < datetime('now')"
  ).run();
}
