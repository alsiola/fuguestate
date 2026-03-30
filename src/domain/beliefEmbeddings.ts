/**
 * Belief embedding lifecycle — embed on create, update on rewrite, remove on retire.
 */

import { getDb } from "../db/client.js";
import { embed, embedBatch } from "../app/embeddings.js";
import { logger } from "../app/logger.js";

/**
 * Embed a belief and store it in the vec0 table.
 */
export async function embedBelief(beliefId: string, proposition: string): Promise<void> {
  try {
    const vec = await embed(proposition);
    const db = getDb();
    db.prepare(
      "INSERT OR REPLACE INTO belief_embeddings(belief_id, embedding) VALUES (?, ?)"
    ).run(beliefId, Buffer.from(vec.buffer));
  } catch (err) {
    logger.warn({ err, beliefId }, "Failed to embed belief");
  }
}

/**
 * Remove an embedding when a belief is retired.
 */
export function removeBeliefEmbedding(beliefId: string): void {
  try {
    const db = getDb();
    db.prepare("DELETE FROM belief_embeddings WHERE belief_id = ?").run(beliefId);
  } catch (err) {
    logger.warn({ err, beliefId }, "Failed to remove belief embedding");
  }
}

/**
 * Search for beliefs semantically similar to a query.
 */
export async function searchBeliefsBySimilarity(
  query: string,
  topK = 10
): Promise<Array<{ beliefId: string; distance: number }>> {
  const queryVec = await embed(query);
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT belief_id, distance
       FROM belief_embeddings
       WHERE embedding MATCH ?
       ORDER BY distance
       LIMIT ?`
    )
    .all(Buffer.from(queryVec.buffer), topK) as Array<{ belief_id: string; distance: number }>;

  return rows.map((r) => ({ beliefId: r.belief_id, distance: r.distance }));
}

/**
 * Backfill embeddings for all active beliefs that don't have one yet.
 */
export async function backfillBeliefEmbeddings(): Promise<number> {
  const db = getDb();

  const missing = db
    .prepare(
      `SELECT b.id, b.proposition FROM beliefs b
       WHERE b.status IN ('active', 'disputed')
       AND b.id NOT IN (SELECT belief_id FROM belief_embeddings)`
    )
    .all() as Array<{ id: string; proposition: string }>;

  if (missing.length === 0) return 0;

  logger.info({ count: missing.length }, "Backfilling belief embeddings...");

  const vecs = await embedBatch(missing.map((b) => b.proposition));
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO belief_embeddings(belief_id, embedding) VALUES (?, ?)"
  );

  const insertAll = db.transaction(() => {
    for (let i = 0; i < missing.length; i++) {
      stmt.run(missing[i].id, Buffer.from(vecs[i].buffer));
    }
  });

  insertAll();
  logger.info({ count: missing.length }, "Belief embeddings backfilled");
  return missing.length;
}
