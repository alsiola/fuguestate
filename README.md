# FugueState

A memory system for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that watches everything your agent does, forms beliefs about how you work, lies awake at night worrying about contradictions, dreams up resolutions, and occasionally goes on ayahuasca-fuelled spirit quests to find deeper meaning in its own belief system.

You know, normal software.

> Internal codenames: `memit` (directory/project), `amts` (service/database)

## What it does

FugueState runs as a sidecar to Claude Code. It watches, remembers, and thinks.

**During the day** it records every interaction — prompts, tool calls, successes, failures — and builds up beliefs about your preferences, your codebase, and how work should be done. When you tell it something ("I prefer TypeScript", "never restart Docker without asking me"), it pins that as a belief with a confidence score.

**When contradictions arise** (and they will — humans are beautifully inconsistent), it detects them immediately and files them as open loops.

**At night** it sleeps. Literally. On a timer. The sleep cycle has three phases:

### 1. Falling Asleep
The system lies awake scanning all its beliefs against each other, looking for tensions it missed during the day. Like you, at 2am, suddenly realising two things you said can't both be true.

```
"Falling asleep... reviewing beliefs..."
"Tossing and turning — found new contradictions"
```

### 2. REM Sleep (Dreaming)
For each contradiction, an LLM reasons through the conflict and writes a dream journal entry. It might keep one belief, merge two into a deeper principle, or escalate to the user if it genuinely can't decide.

Dreams have narratives:

> *I found myself walking through a bridge made of test pipelines — each one solid, glowing with green checkmarks. But beneath it, the actual city was crumbling. I realized the bridge wasn't the destination; it was supposed to protect the journey to the city.*

And they have consequences: beliefs get retired, merged, or rewritten.

### 3. Spirit Quests (every 12th sleep cycle)
Every 12 dreams, the system takes the medicine. It re-examines its entire belief corpus without prejudice, extracts guiding principles, and rewrites each belief through that lens. Then — critically — it sobers up and checks each rewrite: was that a genuine insight, or a hallucination?

```
"The medicine takes hold... beginning spirit quest"
"Spirit quest: the visions begin..."
"Spirit quest: sobriety check..."
"Spirit quest complete — returning to consensus reality"
```

Results are tracked in a `spirit_quests` table with full before/after records, in case the trip goes sideways.

**Next morning** you start a new session and get a briefing: here's what I dreamed about, here's what changed, here's what I rejected. You're always in the loop.

## The sleep cycle, visualised

```
6 raw, contradictory gut feelings
  | falling asleep (scan for conflicts)
  | REM sleep (dream resolutions)
  v
2 coherent merged beliefs
  | spirit quest (extract principles, rewrite, consolidate)
  | sobriety check (insight or hallucination?)
  v
2 principled, refined beliefs + guiding principles
```

## Setup

### 1. Configure environment

```sh
cp .env.example .env
```

Add your Anthropic API key — this powers dreaming, conflict detection, and spirit quests. Without it, the system still records everything but can't think about it.

See `.env.example` for all available options (worker intervals, model choice, limits, etc.).

### 2. Start the service

```sh
docker compose up -d
```

Runs on port 4317 with SQLite storage in `./data/`.

### 3. Configure Claude Code hooks

Add to your project's `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/session-start" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/user-prompt-submit" }] }
    ],
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/pre-tool-use" }] }
    ],
    "PostToolUse": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/post-tool-use" }] }
    ],
    "PostToolUseFailure": [
      { "matcher": "*", "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/post-tool-use-failure" }] }
    ],
    "TaskCreated": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/task-created" }] }
    ],
    "TaskCompleted": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/task-completed" }] }
    ],
    "SubagentStart": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/subagent-start" }] }
    ],
    "SubagentStop": [
      { "hooks": [{ "type": "http", "url": "http://127.0.0.1:4317/hooks/subagent-stop" }] }
    ]
  }
}
```

A ready-made version is in [`hooks.json`](hooks.json).

### 4. Configure the MCP server

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "amts": {
      "type": "stdio",
      "command": "node",
      "args": ["./scripts/amts-mcp-stdio-shim.cjs"],
      "env": {
        "AMTS_BASE_URL": "http://127.0.0.1:4317"
      }
    }
  }
}
```

## FugueState Dashboard

The project ships with a full React dashboard (served from the backend container at `http://localhost:4317/ui/`).

### Features

- **Agent Ego** — a persistent identity that evolves. Randomly generated name, personality traits, and catchphrase (pulled from spirit quest narratives). Mood computed dynamically from recent dream activity and open contradictions. Displayed prominently in the sidebar.
- **Existential Dread Meter** — a 7-level scale from "Serene" to "Complete Ego Death", computed from contradictions, disputed beliefs, stale beliefs, and undelivered dreams.
- **Belief Confidence Sparklines** — inline charts showing how each belief's confidence has changed over time.
- **Dream Mood Colors** — dreams are color-coded by type (conflict resolution, insight, consolidation).
- **Undelivered Indicators** — dashboard shows counts of dreams and spirit quests waiting to be delivered to the next session.
- **Live Briefing** — the agent briefing auto-refreshes every 30 seconds, showing current beliefs, open loops, and known procedures.

### UI Stack

Vite + React, shadcn/ui components, react-router, @tanstack/react-query, Tailwind CSS. Dark theme. Served from the backend container (no separate frontend service).

## Project-Scoped Beliefs

Beliefs are scoped to the project they were created in via `scope_key` (derived from the `cwd` basename at session start). This means the system can run across multiple projects without cross-contamination — each project sees only its own beliefs and procedures in the briefing.

The briefing includes both `project` and `user` scope beliefs, so project-specific facts and user preferences are both surfaced.

## Non-Conflict Exemptions

When a dream resolves two beliefs as "not actually contradictory", the pair is recorded in a `belief_non_conflicts` table. Future sleep cycles skip these pairs during contradiction scanning, preventing the same non-conflict from being re-dreamed endlessly.

## Automated Failure Analysis

The synthesis worker (runs every 15 minutes) detects tools that fail repeatedly (3+ times in 7 days). When a repeated failure pattern is found:

1. An open loop is created flagging the pattern
2. On the next synthesis cycle, the failures are analyzed by LLM for root cause
3. A **procedure** is created with prevention steps
4. A **belief** is pinned about the root cause
5. The open loop is **resolved** with a full audit trail

## MCP Tools

| Tool | What it does |
|------|-------------|
| `memory_search` | Search across all memory types |
| `memory_pin_fact` | Pin a belief with project scope (auto-detects conflicts) |
| `memory_retire_fact` | Kill a belief that's no longer true (requires UUID) |
| `memory_check_conflicts` | Test claims against existing beliefs |
| `memory_get_open_loops` | What's unresolved? |
| `memory_get_project_truths` | What do we believe right now? |
| `memory_get_procedure` | Look up a procedure by ID or keyword |
| `memory_reflect_on_task` | Post-task reflection (extracts lessons and belief candidates) |
| `memory_extract_procedure` | Turn past experience or descriptions into a playbook |
| `memory_record_manual_note` | Store context that doesn't fit other categories |
| `memory_get_related_episodes` | Find similar past episodes |
| `memory_suggest_next_checks` | Get suggestions for what to verify next |
| `memory_explain_prior_decision` | Look up why a past decision was made |
| `memory_mark_resolution` | Mark an open loop as resolved |
| `memory_get_user_preferences` | Get known user preferences |

## Slash Commands

| Command | What it does |
|---------|-------------|
| `/sleep` | Trigger a sleep cycle (scan for conflicts, dream about them) |
| `/spirit-quest` | Trigger a full spirit quest (sleep cycle + deep belief review) |

## Design Principles

- **Record everything, believe cautiously** — experiences are cheap, beliefs are earned
- **Evidence beats memory** — what the code says now outranks what we remember
- **Forgetting is a feature** — beliefs decay, duplicates merge, contradictions resolve
- **Sleep on it** — don't resolve conflicts immediately, dream about them
- **Trust but verify** — spirit quest rewrites must pass a sobriety check
- **Fail open** — if memory is down, Claude Code works fine without it
- **No recurring nightmares** — resolved non-conflicts are remembered, not re-dreamed

## License

Private.
