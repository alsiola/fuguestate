import crypto from "node:crypto";
import { getDb } from "../../db/client.js";
import { getActiveBeliefs } from "../beliefs/index.js";
import { getOpenLoops } from "../openLoops/index.js";
import { getRecentEpisodes } from "../episodes/index.js";
import { getProceduresByScope } from "../procedures/index.js";
import type { CacheRow, ScopeType } from "../types.js";

export interface BriefingParams {
  scope: "session" | "task" | "repo" | "project" | "user";
  sessionId?: string;
  taskHint?: string;
  maxItems?: number;
}

export function generateBriefing(params: BriefingParams): string {
  const maxItems = params.maxItems ?? 10;
  const sections: string[] = ["# Session Briefing\nThis is your briefing — injected automatically at session start. Refer to it when the user asks about your briefing, beliefs, or memory context. Do NOT use the MEMORY.md file-based memory system — use only the MCP memory tools (prefixed `mcp__amts__memory_`)."];

  // Key beliefs
  const scopeType: ScopeType = params.scope === "session" || params.scope === "task" ? "project" : params.scope as ScopeType;
  const beliefs = getActiveBeliefs(scopeType, undefined, Math.min(maxItems, 5));
  if (beliefs.length > 0) {
    sections.push("## Key Beliefs");
    for (const b of beliefs) {
      sections.push(`- [${(b.confidence * 100).toFixed(0)}%] ${b.proposition}`);
    }
  }

  // Open loops
  const loops = getOpenLoops({ limit: Math.min(maxItems, 5) });
  if (loops.length > 0) {
    sections.push("\n## Open Loops");
    for (const l of loops) {
      sections.push(`- [${l.loop_type}] ${l.title}${l.suggested_next_check ? ` → ${l.suggested_next_check}` : ""}`);
    }
  }

  // Recent episodes
  if (params.sessionId) {
    const episodes = getRecentEpisodes(params.sessionId, Math.min(maxItems, 5));
    if (episodes.length > 0) {
      sections.push("\n## Recent Episodes");
      for (const ep of episodes) {
        const status = ep.status === "open" ? "🔄" : ep.status === "closed" ? "✓" : "✗";
        sections.push(`- ${status} ${ep.title}${ep.outcome_summary ? `: ${ep.outcome_summary}` : ""}`);
      }
    }
  }

  // Relevant procedures
  const procs = getProceduresByScope(undefined, undefined, 3);
  if (procs.length > 0) {
    sections.push("\n## Known Procedures");
    for (const p of procs) {
      sections.push(`- **${p.name}**: ${p.trigger_description ?? ""}`);
    }
  }

  // Cautions from low-confidence or disputed beliefs
  const disputed = getDb()
    .prepare("SELECT * FROM beliefs WHERE status = 'disputed' LIMIT 3")
    .all() as Array<{ proposition: string; confidence: number }>;
  if (disputed.length > 0) {
    sections.push("\n## Cautions");
    for (const d of disputed) {
      sections.push(`- ⚠️ Disputed: ${d.proposition} (${(d.confidence * 100).toFixed(0)}% confidence)`);
    }
  }

  // Always include tool usage guidance
  sections.push(`
## Memory Tools — PROACTIVE USE REQUIRED
You have memory tools available via MCP (prefixed \`mcp__amts__memory_\`). You MUST use these proactively — do not wait to be asked.

**When to pin facts (memory_pin_fact):**
- User states a preference, opinion, or working style ("I prefer X", "don't do Y", "always Z")
- User corrects your approach — pin what they wanted instead
- A non-obvious decision is made that future sessions should know about
- User confirms a surprising approach worked well

**When to reflect (memory_reflect_on_task):**
- After completing any significant task (bug fix, feature, investigation, refactor)
- Provide the goal, outcome, and lessons learned so the system can extract patterns

**When to search (memory_search):**
- Before starting unfamiliar work — check if prior sessions encountered similar problems
- When the user references past work or decisions

**When to check conflicts (memory_check_conflicts):**
- Before making architectural or significant code changes — verify against existing beliefs

**When to retire facts (memory_retire_fact):**
- When you observe something that directly contradicts a belief — e.g. the belief says "no git repo" but you can see a .git directory, or a belief says "we use MySQL" but the code imports postgres. Trust what you can observe over what the briefing claims. Retire the stale belief and pin the corrected fact.
- When the user tells you a belief is wrong or outdated
- NOTE: memory_retire_fact requires a belief UUID, not proposition text. Always use memory_search first to find the belief ID, then retire it.

**Other tools:**
- **memory_record_manual_note**: For context that doesn't fit other categories`);

  return sections.join("\n");
}

export function getCachedBriefing(cacheKey: string, ttl: number): string | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM retrieval_cache WHERE cache_key = ?")
    .get(cacheKey) as CacheRow | undefined;

  if (!row) return null;

  const age = (Date.now() - new Date(row.generated_at).getTime()) / 1000;
  if (age > ttl) {
    db.prepare("DELETE FROM retrieval_cache WHERE cache_key = ?").run(cacheKey);
    return null;
  }

  return row.content_markdown;
}

export function cacheBriefing(cacheKey: string, kind: string, content: string, ttl: number): void {
  const db = getDb();
  const uuid = crypto.randomUUID();
  db.prepare(
    `INSERT OR REPLACE INTO retrieval_cache (id, cache_key, kind, content_markdown, generated_at, ttl_seconds)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uuid, cacheKey, kind, content, new Date().toISOString(), ttl);
}
