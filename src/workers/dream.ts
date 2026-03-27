import crypto from "node:crypto";
import { getDb } from "../db/client.js";
import { getBelief, retireBelief, createBelief, getActiveBeliefs, updateBeliefConfidence } from "../domain/beliefs/index.js";
import { resolveOpenLoop, getOpenLoop } from "../domain/openLoops/index.js";
import { createConflictLoop } from "../domain/conflict/index.js";
import { findContradictions } from "../app/llm.js";
import { resolveConflictDream, deduplicateBeliefs, spiritQuestVision, sobrietyCheck } from "../app/llm.js";
import { logger } from "../app/logger.js";
import type { DreamRow, SpiritQuestRow, OpenLoopRow } from "../domain/types.js";
import { loadConfig } from "../app/config.js";

let sleepCycleCount = 0;

export async function runDream(): Promise<void> {
  try {
    // Phase 1: Falling asleep — lie awake worrying about our own beliefs
    logger.info("Falling asleep... reviewing beliefs...");
    const newLoops = await fallingAsleep();
    if (newLoops > 0) {
      logger.info({ newLoops }, "Tossing and turning — found new contradictions");
    }

    // Phase 2: REM sleep — dream about contradictions
    logger.info("Entering REM sleep...");
    const resolved = await processConflictLoops();

    if (resolved > 0) {
      logger.info({ dreamsRecorded: resolved }, "REM sleep complete — dreams recorded");
    } else {
      logger.info("REM sleep complete — peaceful dreams, no conflicts");
    }

    // Phase 3: Every Nth cycle, go on a spirit quest
    const questInterval = loadConfig().sleepCyclesPerQuest;
    sleepCycleCount++;
    if (sleepCycleCount >= questInterval) {
      sleepCycleCount = 0;
      logger.info("The medicine takes hold... beginning spirit quest 🍄");
      await runSpiritQuest();
    }
  } catch (err) {
    logger.error({ err }, "Dream worker error");
  }
}

/**
 * Record that two beliefs have been determined to be non-contradictory,
 * preventing them from being re-detected as conflicts in future dream cycles.
 */
function recordNonConflict(beliefIdA: string, beliefIdB: string): void {
  const db = getDb();
  // Store with consistent ordering so lookups work regardless of pair order
  const [a, b] = [beliefIdA, beliefIdB].sort();
  db.prepare(
    "INSERT OR IGNORE INTO belief_non_conflicts (belief_id_a, belief_id_b, resolved_at) VALUES (?, ?, ?)"
  ).run(a, b, new Date().toISOString());
}

/**
 * Check if a pair of beliefs has already been resolved as non-contradictory.
 */
function isKnownNonConflict(beliefIdA: string, beliefIdB: string): boolean {
  const db = getDb();
  const [a, b] = [beliefIdA, beliefIdB].sort();
  const row = db
    .prepare("SELECT 1 FROM belief_non_conflicts WHERE belief_id_a = ? AND belief_id_b = ?")
    .get(a, b);
  return !!row;
}

/**
 * Pre-dream phase: scan all active beliefs against each other for
 * undetected contradictions. Like lying in bed going "wait... do I
 * actually believe both of these?"
 */
async function fallingAsleep(): Promise<number> {
  const beliefs = getActiveBeliefs(undefined, undefined, 100);
  if (beliefs.length < 2) return 0;

  // Check if there are already open contradiction loops — no point
  // worrying about new ones if we haven't processed the existing ones
  const db = getDb();
  const existingLoops = db
    .prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = 'open' AND loop_type = 'contradiction'")
    .get() as { cnt: number };

  if (existingLoops.cnt > 0) {
    logger.info({ existing: existingLoops.cnt }, "Already have unresolved contradictions — skipping pre-dream scan");
    return 0;
  }

  // Single-shot: send all beliefs to LLM and ask for contradictions
  const scan = await findContradictions(beliefs.map((b) => ({ id: b.id, proposition: b.proposition, confidence: b.confidence })));
  if (!scan || scan.contradictions.length === 0) return 0;

  const beliefMap = new Map(beliefs.map((b) => [b.id, b]));
  let created = 0;
  for (const c of scan.contradictions) {
    if (c.severity < 0.7) continue;
    const a = beliefMap.get(c.belief_a_id);
    const b = beliefMap.get(c.belief_b_id);
    if (!a || !b) continue;

    // Skip pairs previously resolved as non-contradictory
    if (isKnownNonConflict(c.belief_a_id, c.belief_b_id)) {
      logger.debug({ a: c.belief_a_id, b: c.belief_b_id }, "Skipping known non-conflict pair");
      continue;
    }

    createConflictLoop({
      claim: a.proposition,
      conflictsWith: b.proposition,
      sourceType: "belief",
      sourceId: c.belief_b_id,
      severity: c.severity,
      suggestedResolution: "escalate",
      suggestedCheck: c.reasoning,
    }, "project");
    created++;
  }

  return created;
}

async function processConflictLoops(): Promise<number> {
  const db = getDb();

  // Find open contradiction loops
  const contradictions = db
    .prepare(
      `SELECT * FROM open_loops
       WHERE status = 'open' AND loop_type = 'contradiction'
       ORDER BY priority DESC
       LIMIT 5`
    )
    .all() as OpenLoopRow[];

  if (contradictions.length === 0) return 0;

  let dreamsRecorded = 0;

  for (const loop of contradictions) {
    // Extract the two belief IDs from the loop
    const linkedIds = JSON.parse(loop.linked_belief_ids_json) as string[];
    if (linkedIds.length === 0) continue;

    // The loop links to the existing belief that was contradicted.
    // We need to find the new claim too — it's in the description.
    const existingBelief = getBelief(linkedIds[0]);
    if (!existingBelief) continue;

    // Find the contradicting belief by parsing the claim from the description
    const claimMatch = loop.description?.match(/^Claim: "(.+?)"\n/);
    if (!claimMatch) continue;

    const claimText = claimMatch[1];
    const contradictingBelief = db
      .prepare("SELECT * FROM beliefs WHERE proposition = ? AND status = 'active' LIMIT 1")
      .get(claimText) as { id: string; proposition: string; confidence: number } | undefined;

    if (!contradictingBelief) {
      // The contradicting belief was already retired/removed — resolve the loop
      resolveOpenLoop(loop.id, "Contradicting belief no longer exists");
      continue;
    }

    // Ask the LLM to dream about this conflict
    const dream = await resolveConflictDream(
      { id: existingBelief.id, proposition: existingBelief.proposition, confidence: existingBelief.confidence },
      { id: contradictingBelief.id, proposition: contradictingBelief.proposition, confidence: contradictingBelief.confidence },
      loop.description ?? ""
    );

    if (!dream) continue;

    const actionsTaken: string[] = [];
    const linkedBeliefIds: string[] = [existingBelief.id, contradictingBelief.id];

    switch (dream.resolution) {
      case "keep_a": {
        retireBelief(contradictingBelief.id, `Dream resolution: ${dream.reasoning}`);
        resolveOpenLoop(loop.id, `Kept belief A: "${existingBelief.proposition}". Retired belief B.`);
        actionsTaken.push(`Retired: "${contradictingBelief.proposition}"`, `Kept: "${existingBelief.proposition}"`);
        break;
      }
      case "keep_b": {
        retireBelief(existingBelief.id, `Dream resolution: ${dream.reasoning}`);
        resolveOpenLoop(loop.id, `Kept belief B: "${contradictingBelief.proposition}". Retired belief A.`);
        actionsTaken.push(`Retired: "${existingBelief.proposition}"`, `Kept: "${contradictingBelief.proposition}"`);
        break;
      }
      case "merge": {
        if (dream.merged_proposition) {
          // Check if the merged proposition is redundant with an existing active belief
          const activeBeliefs = getActiveBeliefs(undefined, undefined, 100)
            .filter((b) => b.id !== existingBelief.id && b.id !== contradictingBelief.id)
            .map((b) => ({ id: b.id, proposition: b.proposition }));

          let redundantWith: string | null = null;
          if (activeBeliefs.length > 0) {
            const dedupResult = await deduplicateBeliefs([dream.merged_proposition], activeBeliefs);
            if (dedupResult) {
              const match = dedupResult.unique_beliefs[0];
              if (match && !match.is_new && match.existing_match_id) {
                redundantWith = match.existing_match_id;
              }
            }
          }

          if (redundantWith) {
            // Merge is redundant — just retire both originals, keep the existing belief
            const kept = activeBeliefs.find((b) => b.id === redundantWith);
            retireBelief(existingBelief.id, `Redundant with existing belief ${redundantWith}: ${dream.reasoning}`);
            retireBelief(contradictingBelief.id, `Redundant with existing belief ${redundantWith}: ${dream.reasoning}`);
            resolveOpenLoop(loop.id, `Merge redundant with existing belief: "${kept?.proposition ?? redundantWith}"`);
            linkedBeliefIds.push(redundantWith);
            actionsTaken.push(
              `Retired: "${existingBelief.proposition}"`,
              `Retired: "${contradictingBelief.proposition}"`,
              `Already covered by: "${kept?.proposition ?? redundantWith}"`
            );
            logger.info({ redundantWith, merged: dream.merged_proposition }, "Dream merge was redundant with existing belief");
          } else {
            const merged = createBelief({
              proposition: dream.merged_proposition,
              scopeType: existingBelief.scope_type,
              scopeKey: existingBelief.scope_key,
              confidence: Math.max(existingBelief.confidence, contradictingBelief.confidence),
              evidenceFor: [`Merged from conflicting beliefs: ${existingBelief.id}, ${contradictingBelief.id}`],
            });
            retireBelief(existingBelief.id, `Merged into ${merged.id}: ${dream.reasoning}`);
            retireBelief(contradictingBelief.id, `Merged into ${merged.id}: ${dream.reasoning}`);
            resolveOpenLoop(loop.id, `Merged into: "${dream.merged_proposition}"`);
            linkedBeliefIds.push(merged.id);
            actionsTaken.push(
              `Retired: "${existingBelief.proposition}"`,
              `Retired: "${contradictingBelief.proposition}"`,
              `Created: "${dream.merged_proposition}"`
            );
          }
        }
        break;
      }
      case "retire_both": {
        retireBelief(existingBelief.id, `Dream resolution: ${dream.reasoning}`);
        retireBelief(contradictingBelief.id, `Dream resolution: ${dream.reasoning}`);
        resolveOpenLoop(loop.id, "Both beliefs retired as unhelpful");
        actionsTaken.push(`Retired: "${existingBelief.proposition}"`, `Retired: "${contradictingBelief.proposition}"`);
        break;
      }
      case "not_contradictory": {
        // The dream process determined these beliefs aren't actually in conflict — keep both, resolve the loop
        resolveOpenLoop(loop.id, `Not contradictory: "${existingBelief.proposition}" and "${contradictingBelief.proposition}" address different topics`);
        actionsTaken.push(`Kept both — not actually contradictory`);
        // Record this pair as non-conflicting so we don't re-dream about them
        recordNonConflict(existingBelief.id, contradictingBelief.id);
        break;
      }
      case "escalate": {
        // Don't resolve the loop — leave it open, but record the dream so the user sees the reasoning
        actionsTaken.push("Escalated to user — too ambiguous to resolve autonomously");
        break;
      }
    }

    // Record the dream
    recordDream({
      dreamType: "conflict_resolution",
      title: dream.title,
      narrativeMarkdown: dream.narrative,
      actionsTaken,
      linkedBeliefIds,
      linkedLoopIds: [loop.id],
    });

    dreamsRecorded++;
  }

  return dreamsRecorded;
}

function recordDream(params: {
  dreamType: DreamRow["dream_type"];
  title: string;
  narrativeMarkdown: string;
  actionsTaken: string[];
  linkedBeliefIds: string[];
  linkedLoopIds: string[];
}): void {
  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO dreams (id, dream_type, title, narrative_markdown, actions_taken_json, linked_belief_ids_json, linked_loop_ids_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.dreamType,
    params.title,
    params.narrativeMarkdown,
    JSON.stringify(params.actionsTaken),
    JSON.stringify(params.linkedBeliefIds),
    JSON.stringify(params.linkedLoopIds),
    new Date().toISOString()
  );
}

export function getUndeliveredDreams(): DreamRow[] {
  return getDb()
    .prepare("SELECT * FROM dreams WHERE delivered_at IS NULL ORDER BY created_at ASC")
    .all() as DreamRow[];
}

export function markDreamsDelivered(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE dreams SET delivered_at = ? WHERE id = ?");
  for (const id of ids) {
    stmt.run(now, id);
  }
}

// ---- Spirit Quest ----

export async function runSpiritQuest(): Promise<void> {
  const beliefs = getActiveBeliefs(undefined, undefined, 100);
  if (beliefs.length < 2) {
    logger.info("Not enough beliefs for a spirit quest — coming down early");
    return;
  }

  const beliefInputs = beliefs.map((b) => ({
    id: b.id,
    proposition: b.proposition,
    confidence: b.confidence,
  }));

  // Phase 1: The trip — extract principles, rewrite beliefs, find consolidations
  logger.info({ beliefCount: beliefs.length }, "Spirit quest: the visions begin...");
  const vision = await spiritQuestVision(beliefInputs);
  if (!vision) {
    logger.warn("Spirit quest: no visions received — bad batch?");
    return;
  }

  logger.info(
    { principles: vision.guiding_principles.length, rewrites: vision.rewrites.length, consolidations: vision.consolidations.length },
    "Spirit quest: visions received, coming down..."
  );

  // Phase 2: Sobriety check — did the rewrites make sense?
  const rewritesToCheck = vision.rewrites
    .filter((r) => r.rewritten_proposition !== r.original_proposition)
    .map((r) => ({ original: r.original_proposition, rewritten: r.rewritten_proposition }));

  const consolidationsToCheck = vision.consolidations.map((c) => ({
    original: c.merged_propositions.join(" + "),
    rewritten: c.consolidated_proposition,
  }));

  const allChecks = [...rewritesToCheck, ...consolidationsToCheck];

  let verdicts: Map<string, "insight" | "hallucination" | "unchanged"> = new Map();

  if (allChecks.length > 0) {
    logger.info({ checkCount: allChecks.length }, "Spirit quest: sobriety check...");
    const check = await sobrietyCheck(allChecks);
    if (check) {
      for (const j of check.judgements) {
        verdicts.set(j.rewritten_proposition, j.verdict);
      }
    }
  }

  // Phase 3: Apply insights, discard hallucinations
  const insights: string[] = [];
  const hallucinations: string[] = [];
  const beliefsBefore: Array<{ id: string; proposition: string }> = beliefInputs.map((b) => ({ id: b.id, proposition: b.proposition }));
  const beliefsAfter: Array<{ id: string; proposition: string; action: string }> = [];

  // Process rewrites
  for (const rewrite of vision.rewrites) {
    if (rewrite.rewritten_proposition === rewrite.original_proposition) continue;

    const verdict = verdicts.get(rewrite.rewritten_proposition) ?? "hallucination";

    if (verdict === "insight") {
      // Apply the rewrite: retire old, create new
      const original = beliefs.find((b) => b.id === rewrite.original_id);
      if (original) {
        const newBelief = createBelief({
          proposition: rewrite.rewritten_proposition,
          scopeType: original.scope_type,
          scopeKey: original.scope_key,
          confidence: original.confidence,
          evidenceFor: [`Spirit quest rewrite: ${rewrite.reasoning}`],
        });
        retireBelief(original.id, `Spirit quest rewrite → ${newBelief.id}: ${rewrite.reasoning}`);
        insights.push(`Rewrote: "${rewrite.original_proposition}" → "${rewrite.rewritten_proposition}"`);
        beliefsAfter.push({ id: newBelief.id, proposition: rewrite.rewritten_proposition, action: "rewritten" });
      }
    } else {
      hallucinations.push(`Rejected rewrite: "${rewrite.original_proposition}" → "${rewrite.rewritten_proposition}" (${verdict})`);
      beliefsAfter.push({ id: rewrite.original_id, proposition: rewrite.original_proposition, action: "kept (rewrite rejected)" });
    }
  }

  // Process consolidations
  for (const consolidation of vision.consolidations) {
    const verdict = verdicts.get(consolidation.consolidated_proposition) ?? "hallucination";

    if (verdict === "insight") {
      // Retire all merged beliefs, create the consolidated one
      const originals = consolidation.merged_ids.map((id) => beliefs.find((b) => b.id === id)).filter(Boolean) as typeof beliefs;
      if (originals.length < 2) continue;

      const maxConf = Math.max(...originals.map((b) => b.confidence));
      const newBelief = createBelief({
        proposition: consolidation.consolidated_proposition,
        scopeType: originals[0].scope_type,
        scopeKey: originals[0].scope_key,
        confidence: maxConf,
        evidenceFor: [`Spirit quest consolidation: ${consolidation.reasoning}`],
      });

      for (const original of originals) {
        retireBelief(original.id, `Spirit quest consolidated into ${newBelief.id}: ${consolidation.reasoning}`);
      }

      insights.push(`Consolidated ${originals.length} beliefs: ${consolidation.merged_propositions.map((p) => `"${p}"`).join(" + ")} → "${consolidation.consolidated_proposition}"`);
      beliefsAfter.push({ id: newBelief.id, proposition: consolidation.consolidated_proposition, action: "consolidated" });
    } else {
      hallucinations.push(`Rejected consolidation: ${consolidation.merged_propositions.map((p) => `"${p}"`).join(" + ")} → "${consolidation.consolidated_proposition}" (${verdict})`);
    }
  }

  // Record the quest
  const db = getDb();
  const id = crypto.randomUUID();

  db.prepare(
    `INSERT INTO spirit_quests (id, guiding_principles_json, beliefs_before_json, beliefs_after_json, rewrites_json, hallucinations_json, insights_json, narrative_markdown, style_used, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    JSON.stringify(vision.guiding_principles),
    JSON.stringify(beliefsBefore),
    JSON.stringify(beliefsAfter),
    JSON.stringify(vision.rewrites),
    JSON.stringify(hallucinations),
    JSON.stringify(insights),
    vision.narrative,
    vision.styleUsed ?? null,
    new Date().toISOString()
  );

  // Also record as a dream so it shows up in the morning briefing
  recordDream({
    dreamType: "consolidation",
    title: "Spirit Quest",
    narrativeMarkdown: `${vision.narrative}\n\n**Guiding Principles Discovered:**\n${vision.guiding_principles.map((p) => `- ${p}`).join("\n")}\n\n**Insights Applied:** ${insights.length}\n**Hallucinations Rejected:** ${hallucinations.length}${insights.length > 0 ? "\n\n**Changes:**\n" + insights.map((i) => `- ${i}`).join("\n") : ""}${hallucinations.length > 0 ? "\n\n**Rejected (bad trip):**\n" + hallucinations.map((h) => `- ${h}`).join("\n") : ""}`,
    actionsTaken: [...insights, ...hallucinations.map((h) => `[REJECTED] ${h}`)],
    linkedBeliefIds: beliefsBefore.map((b) => b.id),
    linkedLoopIds: [],
  });

  logger.info(
    { insights: insights.length, hallucinations: hallucinations.length, principles: vision.guiding_principles.length },
    "Spirit quest complete — returning to consensus reality"
  );
}

export function getUndeliveredQuests(): SpiritQuestRow[] {
  return getDb()
    .prepare("SELECT * FROM spirit_quests WHERE delivered_at IS NULL ORDER BY created_at ASC")
    .all() as SpiritQuestRow[];
}

export function markQuestsDelivered(ids: string[]): void {
  if (ids.length === 0) return;
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare("UPDATE spirit_quests SET delivered_at = ? WHERE id = ?");
  for (const id of ids) {
    stmt.run(now, id);
  }
}
