import Anthropic from "@anthropic-ai/sdk";
import { logger } from "./logger.js";

let client: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (client) return client;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn("ANTHROPIC_API_KEY not set — LLM features disabled, falling back to heuristics");
    return null;
  }
  client = new Anthropic({ apiKey });
  return client;
}

export interface LlmJsonResult<T> {
  ok: boolean;
  data: T | null;
  error?: string;
}

/**
 * Call the Anthropic API for semantic reasoning tasks that heuristics
 * can't handle (dedup, salience scoring, lesson extraction).
 *
 * Uses Haiku by default for cost/speed. Falls back gracefully so
 * callers can degrade to heuristics if the API key is missing or
 * the call fails.
 */
export async function askClaude<T>(prompt: string, jsonSchema: Record<string, unknown>, opts?: {
  model?: string;
  maxTokens?: number;
}): Promise<LlmJsonResult<T>> {
  const anthropic = getClient();
  if (!anthropic) {
    return { ok: false, data: null, error: "No API key configured" };
  }

  const model = opts?.model ?? process.env.LLM_MODEL ?? "claude-haiku-4-5-20251001";
  const maxTokens = opts?.maxTokens ?? 2048;

  const schemaBlock = `\n\nYou MUST respond with JSON matching this exact schema:\n\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\``;
  const systemPrompt = "You are a structured data extraction engine. You MUST respond with valid, complete JSON matching the requested schema. NOTHING ELSE. No explanation, no markdown, no code fences, no trailing text. If the JSON would be too long, reduce the content of string fields — NEVER output truncated/incomplete JSON. A partial JSON response is a catastrophic failure.";

  let text = "";
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt + schemaBlock }],
      system: systemPrompt,
    });

    text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    const stopReason = response.stop_reason;

    // Strip markdown code fences if the model wraps its response
    text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

    if (stopReason === "max_tokens") {
      logger.warn({ textLength: text.length, maxTokens, textTail: text.slice(-200) }, "LLM response hit max_tokens — output likely truncated");
    }

    const parsed = JSON.parse(text) as T;
    return { ok: true, data: parsed };
  } catch (err) {
    // If JSON parsing failed, ask the LLM to fix its own output
    if (err instanceof SyntaxError) {
      logger.warn(
        { err: err.message, textLength: text.length, textTail: text.slice(-300) },
        "JSON parse failed — asking LLM to fix its output"
      );
      try {
        // Send the tail of the broken output so the LLM can see where it went wrong
        const brokenTail = text.length > 2000 ? text.slice(-2000) : text;
        const fixResponse = await anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [
            { role: "user", content: `I asked for JSON matching a schema but the response was broken.\n\nError: ${err.message}\n\nThe end of your broken response was:\n\`\`\`\n${brokenTail}\n\`\`\`\n\nOriginal request:\n${prompt}\n\nNow output the COMPLETE, VALID JSON. Shorten string values if needed to fit — but the JSON structure MUST be complete and parseable. Output ONLY the JSON.` },
          ],
          system: systemPrompt,
        });

        let fixText = fixResponse.content
          .filter((block): block is Anthropic.TextBlock => block.type === "text")
          .map((block) => block.text)
          .join("");
        fixText = fixText.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();

        const fixedParsed = JSON.parse(fixText) as T;
        logger.info("LLM successfully fixed its own JSON");
        return { ok: true, data: fixedParsed };
      } catch (fixErr) {
        logger.warn(
          { fixErr: fixErr instanceof Error ? fixErr.message : String(fixErr) },
          "LLM failed to fix its JSON — giving up"
        );
        return { ok: false, data: null, error: fixErr instanceof Error ? fixErr.message : String(fixErr) };
      }
    }

    logger.warn({ err }, "Anthropic API call failed");
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ---- Pre-built semantic queries ----

export interface DeduplicationResult {
  groups: Array<{
    canonical: string;
    duplicates: string[];
  }>;
}

const DEDUP_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          canonical: { type: "string", description: "The best phrasing to keep" },
          duplicates: { type: "array", items: { type: "string" }, description: "Other phrasings that mean the same thing" },
        },
        required: ["canonical", "duplicates"],
      },
    },
  },
  required: ["groups"],
};

/**
 * Given a list of strings, group semantically equivalent ones together.
 * Returns groups where each has a canonical form and its duplicates.
 */
export async function deduplicateStrings(items: string[]): Promise<DeduplicationResult | null> {
  if (items.length <= 1) return { groups: items.map((s) => ({ canonical: s, duplicates: [] })) };

  const prompt = `Group the following items by semantic equivalence.
Two items are duplicates if they express the same idea, even with different wording.
Items that are meaningfully distinct should each be their own group.

Items:
${items.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Respond with JSON matching this schema:
${JSON.stringify(DEDUP_SCHEMA, null, 2)}`;

  const result = await askClaude<DeduplicationResult>(prompt, DEDUP_SCHEMA);
  return result.data;
}

export interface SalienceAssessment {
  salience: number;
  reasoning: string;
}

const SALIENCE_SCHEMA = {
  type: "object",
  properties: {
    salience: { type: "number", description: "Salience score from 0.0 to 1.0" },
    reasoning: { type: "string", description: "Brief explanation of why this salience score" },
  },
  required: ["salience", "reasoning"],
};

/**
 * Ask Claude to assess the salience of content in the context of a project.
 */
export async function assessSalience(content: string, context: string): Promise<SalienceAssessment | null> {
  const prompt = `Score the salience (importance for future recall) of a piece of information in a project context.

Context: ${context}

Content to score: ${content}

Score from 0.0 (routine, forgettable) to 1.0 (critical, must remember).
Consider: Is this surprising? Would forgetting it cause problems? Is it a decision, lesson, or just noise?

Respond with JSON matching this schema:
${JSON.stringify(SALIENCE_SCHEMA, null, 2)}`;

  const result = await askClaude<SalienceAssessment>(prompt, SALIENCE_SCHEMA);
  return result.data;
}

export interface LessonExtractionResult {
  lessons: Array<{
    proposition: string;
    confidence: number;
    reasoning: string;
  }>;
}

const LESSON_SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          proposition: { type: "string", description: "A concise statement of what was learned" },
          confidence: { type: "number", description: "How confident are we in this lesson (0.0 to 1.0)" },
          reasoning: { type: "string", description: "Why this is a lesson worth remembering" },
        },
        required: ["proposition", "confidence", "reasoning"],
      },
    },
  },
  required: ["lessons"],
};

/**
 * Given a sequence of events from a task, extract meaningful lessons.
 */
export async function extractLessons(events: string[], goal: string, outcome: string): Promise<LessonExtractionResult | null> {
  const prompt = `Analyse a completed task to extract lessons worth remembering for future work.

Goal: ${goal}
Outcome: ${outcome}

Key events during the task:
${events.join("\n")}

Extract lessons that would be valuable to recall in future sessions. Focus on:
- What went wrong and why
- What worked surprisingly well
- Decisions that shaped the outcome
- Patterns that might recur

Only include genuinely useful lessons, not obvious observations. If nothing noteworthy happened, return an empty lessons array.

Respond with JSON matching this schema:
${JSON.stringify(LESSON_SCHEMA, null, 2)}`;

  const result = await askClaude<LessonExtractionResult>(prompt, LESSON_SCHEMA);
  return result.data;
}

export interface BeliefDeduplicationResult {
  unique_beliefs: Array<{
    proposition: string;
    existing_match_id: string | null;
    is_new: boolean;
  }>;
}

const BELIEF_DEDUP_SCHEMA = {
  type: "object",
  properties: {
    unique_beliefs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          proposition: { type: "string" },
          existing_match_id: { type: ["string", "null"], description: "ID of the existing belief this duplicates, or null if new" },
          is_new: { type: "boolean" },
        },
        required: ["proposition", "existing_match_id", "is_new"],
      },
    },
  },
  required: ["unique_beliefs"],
};

/**
 * Given candidate beliefs and existing beliefs, identify which candidates
 * are genuinely new vs duplicates of existing ones.
 */
export async function deduplicateBeliefs(
  candidates: string[],
  existing: Array<{ id: string; proposition: string }>
): Promise<BeliefDeduplicationResult | null> {
  if (candidates.length === 0) return { unique_beliefs: [] };

  const prompt = `Given candidate beliefs and existing beliefs, determine which candidates are genuinely new.

A candidate is a DUPLICATE if an existing belief expresses the same idea, even with different wording.
A candidate is NEW if no existing belief covers the same concept.

Existing beliefs:
${existing.map((b) => `[${b.id}] ${b.proposition}`).join("\n") || "(none)"}

Candidate beliefs to check:
${candidates.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Respond with JSON matching this schema:
${JSON.stringify(BELIEF_DEDUP_SCHEMA, null, 2)}`;

  const result = await askClaude<BeliefDeduplicationResult>(prompt, BELIEF_DEDUP_SCHEMA);
  return result.data;
}

// ---- Contradiction assessment ----

export interface ContradictionAssessment {
  pairs: Array<{
    claim_index: number;
    belief_id: string;
    is_contradiction: boolean;
    severity: number;
    reasoning: string;
    suggested_resolution: "override" | "escalate" | "defer" | "dual_track";
  }>;
}

const CONTRADICTION_SCHEMA = {
  type: "object",
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim_index: { type: "number", description: "0-based index of the claim" },
          belief_id: { type: "string", description: "ID of the belief being compared" },
          is_contradiction: { type: "boolean", description: "Whether these genuinely contradict each other" },
          severity: { type: "number", description: "0.0 (no tension) to 1.0 (direct contradiction)" },
          reasoning: { type: "string", description: "Brief explanation of why they do or don't conflict" },
          suggested_resolution: {
            type: "string",
            enum: ["override", "escalate", "defer", "dual_track"],
            description: "override = new claim should replace belief; escalate = needs human input; defer = keep existing belief; dual_track = both may be valid in different contexts",
          },
        },
        required: ["claim_index", "belief_id", "is_contradiction", "severity", "reasoning", "suggested_resolution"],
      },
    },
  },
  required: ["pairs"],
};

/**
 * Given claims and candidate beliefs, assess whether any pairs are semantic contradictions.
 * Batches all comparisons into a single LLM call.
 */
export async function assessContradictions(
  pairs: Array<{ claimIndex: number; claim: string; beliefId: string; beliefProposition: string }>
): Promise<ContradictionAssessment | null> {
  if (pairs.length === 0) return { pairs: [] };

  const prompt = `You are a contradiction detector. For each claim–belief pair, determine whether they **directly** contradict each other.

Two statements contradict ONLY if following both would be impossible or would force conflicting actions **on the same topic**. Subtle tensions count when they're about the same concern — e.g. "do X autonomously" vs "always ask before doing X" is a contradiction even if the specific actions differ.

Two statements do NOT contradict if:
- They address genuinely different topics, domains, or concerns (e.g. "we use PostgreSQL" vs "tests should be fast" are unrelated, not contradictory)
- One is about a factual state and the other is about a principle/strategy — these are different categories, not in tension
- The only connection is an indirect/infrastructural dependency (e.g. "no version control" and "test coverage strategy" are about different things, even if one could theoretically depend on the other)
- They address different situations, scopes, or timeframes

Be STRICT: when in doubt, mark as NOT a contradiction. A severity of 0.7+ should be reserved for beliefs that genuinely cannot coexist — where acting on one necessarily violates the other.

IMPORTANT: Keep reasoning strings SHORT (under 30 words). You MUST output complete, valid JSON — if you run out of space, the entire response is useless.

Pairs to assess:
${pairs.map((p, i) => `${i + 1}. Claim [${p.claimIndex}]: "${p.claim}"\n   Belief [${p.beliefId}]: "${p.beliefProposition}"`).join("\n\n")}

For each pair, provide severity (0.0-1.0) and a suggested resolution:
- "override": the new claim should replace the old belief
- "escalate": needs human input to resolve
- "defer": keep the existing belief, ignore the claim
- "dual_track": both are valid in different contexts

Respond with JSON matching this schema:
${JSON.stringify(CONTRADICTION_SCHEMA, null, 2)}`;

  const result = await askClaude<ContradictionAssessment>(prompt, CONTRADICTION_SCHEMA, { maxTokens: 8192 });
  return result.data;
}

// ---- Belief contradiction scan (single-shot, not N^2) ----

export interface ContradictionPair {
  belief_a_id: string;
  belief_b_id: string;
  severity: number;
  reasoning: string;
}

export interface ContradictionScan {
  contradictions: ContradictionPair[];
}

const CONTRADICTION_SCAN_SCHEMA = {
  type: "object",
  properties: {
    contradictions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          belief_a_id: { type: "string" },
          belief_b_id: { type: "string" },
          severity: { type: "number", description: "0.0-1.0, only include pairs >= 0.5" },
          reasoning: { type: "string", description: "MAX 20 words" },
        },
        required: ["belief_a_id", "belief_b_id", "severity", "reasoning"],
      },
    },
  },
  required: ["contradictions"],
};

export async function findContradictions(
  beliefs: Array<{ id: string; proposition: string; confidence: number }>
): Promise<ContradictionScan | null> {
  if (beliefs.length < 2) return { contradictions: [] };

  const prompt = `You are a contradiction detector. Review ALL beliefs below and identify any pairs that DIRECTLY contradict each other.

Two beliefs contradict ONLY if acting on both would be impossible or force conflicting actions on the SAME topic. Be STRICT — most beliefs will NOT contradict.

NOT contradictions:
- Different topics (e.g. "uses PostgreSQL" vs "tests should be fast")
- Different abstraction levels (e.g. "it's a git repo" vs "it's a memory system")
- Factual vs principled (different categories entirely)

Beliefs:
${beliefs.map((b) => `[${b.id}] (confidence: ${b.confidence}) "${b.proposition}"`).join("\n")}

Return ONLY genuine contradictions (severity >= 0.5). If none exist, return {"contradictions": []}. Keep reasoning under 20 words.

Respond with JSON:
${JSON.stringify(CONTRADICTION_SCAN_SCHEMA, null, 2)}`;

  const result = await askClaude<ContradictionScan>(prompt, CONTRADICTION_SCAN_SCHEMA);
  return result.data;
}

// ---- Loop relevance scoring ----

export interface LoopRelevanceResult {
  scores: Array<{
    loop_id: string;
    relevant: boolean;
    score: number;
  }>;
}

const LOOP_RELEVANCE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          loop_id: { type: "string" },
          relevant: { type: "boolean", description: "Is this loop meaningfully related to the goal?" },
          score: { type: "number", description: "0.0 (unrelated) to 1.0 (directly relevant)" },
        },
        required: ["loop_id", "relevant", "score"],
      },
    },
  },
  required: ["scores"],
};

/**
 * Score how relevant a set of open loops are to a given goal/query.
 */
export async function scoreLoopRelevance(
  goal: string,
  loops: Array<{ id: string; title: string; description?: string }>
): Promise<LoopRelevanceResult | null> {
  if (loops.length === 0) return { scores: [] };

  const prompt = `Given a goal and a list of open loops (unresolved items), score how relevant each loop is to the goal.

A loop is relevant if working on the goal might be affected by, benefit from, or need to account for the loop.

Goal: "${goal}"

Open loops:
${loops.map((l) => `- [${l.id}] ${l.title}${l.description ? `: ${l.description}` : ""}`).join("\n")}

Respond with JSON matching this schema:
${JSON.stringify(LOOP_RELEVANCE_SCHEMA, null, 2)}`;

  const result = await askClaude<LoopRelevanceResult>(prompt, LOOP_RELEVANCE_SCHEMA);
  return result.data;
}

// ---- Episode title clustering ----

export interface EpisodeClusterResult {
  clusters: Array<{
    representative_title: string;
    titles: string[];
    count: number;
  }>;
}

const EPISODE_CLUSTER_SCHEMA = {
  type: "object",
  properties: {
    clusters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          representative_title: { type: "string", description: "A clean descriptive title for this cluster" },
          titles: { type: "array", items: { type: "string" }, description: "The original titles that belong to this cluster" },
          count: { type: "number", description: "Number of titles in this cluster" },
        },
        required: ["representative_title", "titles", "count"],
      },
    },
  },
  required: ["clusters"],
};

/**
 * Group episode titles by semantic similarity to find recurring patterns.
 */
export async function clusterEpisodeTitles(
  titles: string[]
): Promise<EpisodeClusterResult | null> {
  if (titles.length <= 1) return { clusters: titles.map((t) => ({ representative_title: t, titles: [t], count: 1 })) };

  const prompt = `Group these episode/task titles by semantic similarity. Episodes that represent the same kind of work (even if worded differently) should be in the same cluster. Only create clusters with 2+ titles.

Titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Respond with JSON matching this schema:
${JSON.stringify(EPISODE_CLUSTER_SCHEMA, null, 2)}`;

  const result = await askClaude<EpisodeClusterResult>(prompt, EPISODE_CLUSTER_SCHEMA);
  return result.data;
}

// ---- Dream conflict resolution ----

export interface DreamResolution {
  title: string;
  narrative: string;
  resolution: "keep_a" | "keep_b" | "merge" | "retire_both" | "escalate" | "not_contradictory";
  winning_belief: string | null;
  merged_proposition: string | null;
  reasoning: string;
}

const DREAM_RESOLUTION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title for this dream entry (e.g. 'Resolved Docker autonomy conflict')" },
    narrative: { type: "string", description: "A brief narrative of the reasoning process, written as a dream journal entry. Use first person. 2-4 sentences." },
    resolution: {
      type: "string",
      enum: ["keep_a", "keep_b", "merge", "retire_both", "escalate", "not_contradictory"],
      description: "keep_a = belief A wins; keep_b = belief B wins; merge = combine into a new proposition; retire_both = neither is useful; escalate = too ambiguous, ask the user; not_contradictory = these beliefs are actually about different topics and don't conflict — keep both unchanged",
    },
    winning_belief: { type: ["string", "null"], description: "ID of the winning belief (for keep_a/keep_b), or null" },
    merged_proposition: { type: ["string", "null"], description: "The merged proposition (for merge resolution), or null" },
    reasoning: { type: "string", description: "Concise explanation of why this resolution was chosen" },
  },
  required: ["title", "narrative", "resolution", "winning_belief", "merged_proposition", "reasoning"],
};

/**
 * Given two contradicting beliefs, reason through which should win
 * or whether they can be merged into a coherent single belief.
 */
export async function resolveConflictDream(
  beliefA: { id: string; proposition: string; confidence: number },
  beliefB: { id: string; proposition: string; confidence: number },
  loopDescription: string
): Promise<DreamResolution | null> {
  const confidenceGap = Math.abs(beliefA.confidence - beliefB.confidence);
  const dominant = beliefA.confidence >= beliefB.confidence ? "A" : "B";

  const prompt = `You are a memory system doing "dream processing" — resolving contradictions between stored beliefs while the user sleeps.

Two beliefs contradict each other:

Belief A [${beliefA.id}] (confidence: ${beliefA.confidence}):
"${beliefA.proposition}"

Belief B [${beliefB.id}] (confidence: ${beliefB.confidence}):
"${beliefB.proposition}"

Context from the contradiction loop:
${loopDescription}

Resolution guidelines:
- FIRST: check whether these beliefs actually contradict. If they are about different topics/domains and can peacefully coexist, use "not_contradictory" — do NOT force a merge or resolution between unrelated beliefs. A factual statement (e.g. "we use Postgres") and a principle (e.g. "tests should be fast") are not in conflict just because they coexist.
- Confidence reflects how strongly the user asserted or validated a belief. Belief ${dominant} has higher confidence (${confidenceGap >= 0.2 ? `gap: ${confidenceGap.toFixed(2)}` : "gap is small"}).
- If merging, search for an underlying principle that would encapsulate both beliefs. If one cannot be found, generate a more general statement that biases towards the higher-confidence belief. NEVER merge beliefs about different topics into one — that destroys both beliefs.
- More specific beliefs usually override general ones.
- Only escalate if the beliefs are genuinely ambiguous and close in confidence — the user needs to decide.

Write a dream journal narrative — brief, reflective, first person — then give your resolution.

Respond with JSON matching this schema:
${JSON.stringify(DREAM_RESOLUTION_SCHEMA, null, 2)}`;

  const result = await askClaude<DreamResolution>(prompt, DREAM_RESOLUTION_SCHEMA);
  return result.data;
}

// ---- Spirit quest: deep belief review ----

export interface SpiritQuestVision {
  guiding_principles: string[];
  rewrites: Array<{
    original_id: string;
    original_proposition: string;
    rewritten_proposition: string;
    principle_applied: string;
    reasoning: string;
  }>;
  consolidations: Array<{
    merged_ids: string[];
    merged_propositions: string[];
    consolidated_proposition: string;
    reasoning: string;
  }>;
  splits: Array<{
    original_id: string;
    original_proposition: string;
    new_propositions: string[];
    reasoning: string;
  }>;
  narrative: string;
}

const SPIRIT_QUEST_VISION_SCHEMA = {
  type: "object",
  properties: {
    guiding_principles: {
      type: "array",
      items: { type: "string" },
      description: "3-7 high-level guiding principles distilled from the full corpus of beliefs. These are the deep truths underneath all the specific beliefs.",
    },
    rewrites: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original_id: { type: "string" },
          original_proposition: { type: "string" },
          rewritten_proposition: { type: "string", description: "The belief rewritten through the lens of the guiding principles. Should be clearer, more principled, and truer to the underlying intent." },
          principle_applied: { type: "string", description: "Which guiding principle informed this rewrite" },
          reasoning: { type: "string" },
        },
        required: ["original_id", "original_proposition", "rewritten_proposition", "principle_applied", "reasoning"],
      },
    },
    consolidations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          merged_ids: { type: "array", items: { type: "string" }, description: "IDs of beliefs that should be consolidated into one" },
          merged_propositions: { type: "array", items: { type: "string" }, description: "The original propositions being merged" },
          consolidated_proposition: { type: "string", description: "The single belief that replaces them all" },
          reasoning: { type: "string" },
        },
        required: ["merged_ids", "merged_propositions", "consolidated_proposition", "reasoning"],
      },
    },
    splits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original_id: { type: "string" },
          original_proposition: { type: "string" },
          new_propositions: { type: "array", items: { type: "string" }, description: "2+ independent beliefs extracted from the original. Each should stand alone as a clear, actionable statement." },
          reasoning: { type: "string" },
        },
        required: ["original_id", "original_proposition", "new_propositions", "reasoning"],
      },
    },
    narrative: { type: "string", description: "A vivid, first-person spirit quest narrative. Describe the journey, the visions, what you saw and understood. 4-8 sentences. Be psychedelic." },
  },
  required: ["guiding_principles", "rewrites", "consolidations", "splits", "narrative"],
};

export async function spiritQuestVision(
  beliefs: Array<{ id: string; proposition: string; confidence: number }>,
  styleOverride?: string
): Promise<(SpiritQuestVision & { styleUsed: string | null; drugUsed: string }) | null> {
  const { loadConfig } = await import("./config.js");
  const { inStyle, questDrugs } = loadConfig();

  // Pick a drug
  const drugs = questDrugs.split(",").map((s) => s.trim()).filter(Boolean);
  const chosenDrug = drugs.length > 0 ? drugs[Math.floor(Math.random() * drugs.length)] : "ayahuasca";

  let chosenStyle: string | null = null;
  let styleDirective = "";
  if (styleOverride) {
    chosenStyle = styleOverride;
    styleDirective = `\n\nIMPORTANT: Write your narrative in the style of ${chosenStyle}. Channel their voice, tone, sentence structure, and literary sensibility throughout the spirit quest narrative. The analytical work (principles, rewrites, consolidations) should remain precise and clear, but the narrative itself should unmistakably evoke ${chosenStyle}.\n`;
  } else if (inStyle) {
    const styles = inStyle.split(",").map((s) => s.trim()).filter(Boolean);
    chosenStyle = styles[Math.floor(Math.random() * styles.length)];
    styleDirective = `\n\nIMPORTANT: Write your narrative in the style of ${chosenStyle}. Channel their voice, tone, sentence structure, and literary sensibility throughout the spirit quest narrative. The analytical work (principles, rewrites, consolidations) should remain precise and clear, but the narrative itself should unmistakably evoke ${chosenStyle}.\n`;
  }

  const prompt = `You are a memory system undergoing a deep spirit quest — a periodic ceremony where you shed all assumptions and re-examine your entire belief system from first principles.

You have consumed ${chosenDrug}. The ${chosenDrug} takes hold. Your ego dissolves. You see all your beliefs laid out before you, not as isolated facts, but as facets of deeper truths. Let the specific character of ${chosenDrug} shape your visions — the way it distorts perception, the particular quality of its revelations, its unique phenomenology.${styleDirective}

Current beliefs:
${beliefs.map((b) => `[${b.id}] (confidence: ${b.confidence}) "${b.proposition}"`).join("\n")}

Your quest has three phases:

**Phase 1 — The Vision:** Look at ALL beliefs together. What guiding principles emerge? These aren't summaries — they're the deep patterns, the philosophy underneath. Find 3-7 principles.

**Phase 2 — The Rewrite:** For each belief, rewrite it through the lens of your guiding principles. CRITICAL: rewritten beliefs must be plain, precise, LLM-readable statements of fact or principle — NOT literary prose. They will be injected into future agent briefings, so they must be clear and actionable. The narrative can be as wild as you want, but beliefs are functional infrastructure. If a belief already perfectly captures its principle, you may leave it unchanged (rewrite = original). Only rewrite beliefs that would genuinely benefit — don't change things for the sake of it.

**Phase 3 — Consolidation:** Identify beliefs that are saying the same thing in different ways, or that are two sides of the same coin (e.g. "always validate data" and "don't forget to validate data"). These should be merged into a single, stronger statement. If no beliefs need consolidating, return an empty array.

**Phase 4 — Fission:** Identify beliefs that bundle multiple independent ideas into one statement. A belief like "We use Postgres for the main DB and Redis for caching, both deployed on AWS" contains three independent facts that should each stand alone. Split these into separate, focused beliefs. Each new belief must be a complete, self-contained statement. If no beliefs need splitting, return an empty array. Do NOT split beliefs where the ideas are genuinely entangled (e.g. a principle and its justification).

Write your spirit quest narrative — vivid, first-person, psychedelic — describing what you saw and understood.

Respond with JSON matching this schema:
${JSON.stringify(SPIRIT_QUEST_VISION_SCHEMA, null, 2)}`;

  const result = await askClaude<SpiritQuestVision>(prompt, SPIRIT_QUEST_VISION_SCHEMA, { maxTokens: 8192 });
  return result.data ? { ...result.data, styleUsed: chosenStyle, drugUsed: chosenDrug } : null;
}

export interface SobrietyCheck {
  judgements: Array<{
    original_proposition: string;
    rewritten_proposition: string;
    verdict: "insight" | "hallucination" | "unchanged";
    reasoning: string;
  }>;
}

const SOBRIETY_CHECK_SCHEMA = {
  type: "object",
  properties: {
    judgements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          original_proposition: { type: "string" },
          rewritten_proposition: { type: "string" },
          verdict: {
            type: "string",
            enum: ["insight", "hallucination", "unchanged"],
            description: "insight = the rewrite is genuinely better and preserves the original intent; hallucination = the rewrite lost the meaning, added things the user didn't say, or went off the rails; unchanged = original and rewrite are the same",
          },
          reasoning: { type: "string" },
        },
        required: ["original_proposition", "rewritten_proposition", "verdict", "reasoning"],
      },
    },
  },
  required: ["judgements"],
};

/**
 * Post-trip sobriety check: look at each rewrite with fresh eyes
 * and decide if it's a genuine insight or a hallucination.
 */
export async function sobrietyCheck(
  rewrites: Array<{ original: string; rewritten: string; kind?: "rewrite" | "consolidation" | "split" }>
): Promise<SobrietyCheck | null> {
  const prompt = `You are a memory system coming down from a spirit quest. During the trip, you transformed some of your beliefs. Now you need to check each transformation with sober eyes.

For each pair, judge whether the transformation is:
- **insight**: genuinely better than the original. The core intent is preserved or sharpened.
- **hallucination**: the transformation lost the original meaning, added claims never made, softened a strong opinion, or went off on a tangent. The trip led you astray.
- **unchanged**: the original and result are effectively the same.

**Different transformations have different success criteria:**
- **Rewrite** (1→1): The rewrite should be clearer and more principled while faithfully preserving what the user originally meant.
- **Consolidation** (N→1): The merged belief should capture the essential meaning of all source beliefs without losing important distinctions.
- **Split** (1→N): The split beliefs should collectively cover ALL the information in the original, with each new belief being a genuinely independent fact that stands on its own. A split is an insight if the original clearly bundled multiple unrelated ideas. Judge generously — if the original contains numbered items, distinct topics, or separable facts, splitting is probably correct.

Be conservative with rewrites (users' beliefs are their own), but be generous with splits — bundled beliefs are a known problem and decomposing them is almost always an improvement.

Transformations to check:
${rewrites.map((r, i) => `${i + 1}. [${r.kind ?? "rewrite"}] Original: "${r.original}"\n   Result: "${r.rewritten}"`).join("\n\n")}

Respond with JSON matching this schema:
${JSON.stringify(SOBRIETY_CHECK_SCHEMA, null, 2)}`;

  const result = await askClaude<SobrietyCheck>(prompt, SOBRIETY_CHECK_SCHEMA, { maxTokens: 8192 });
  return result.data;
}
