// ---- Agent Events ----
export type AgentEvent =
  | {
      type: "session_started";
      sessionId: string;
      cwd: string;
      ts: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "prompt_submitted";
      sessionId: string;
      taskId?: string;
      prompt: string;
      ts: string;
      payload: Record<string, unknown>;
    }
  | {
      type: "tool_started";
      sessionId: string;
      taskId?: string;
      toolName: string;
      input: unknown;
      ts: string;
    }
  | {
      type: "tool_succeeded";
      sessionId: string;
      taskId?: string;
      toolName: string;
      input: unknown;
      outputSummary: string;
      ts: string;
    }
  | {
      type: "tool_failed";
      sessionId: string;
      taskId?: string;
      toolName: string;
      input: unknown;
      errorSummary: string;
      ts: string;
    }
  | {
      type: "task_started";
      sessionId: string;
      taskId: string;
      goal: string;
      ts: string;
    }
  | {
      type: "task_completed";
      sessionId: string;
      taskId: string;
      outcomeSummary: string;
      ts: string;
    }
  | {
      type: "subagent_started";
      sessionId: string;
      subagentId: string;
      role?: string;
      ts: string;
    }
  | {
      type: "subagent_stopped";
      sessionId: string;
      subagentId: string;
      summary?: string;
      ts: string;
    };

// ---- DB Row types ----
export interface EventRow {
  id: string;
  ts: string;
  session_id: string;
  task_id: string | null;
  subagent_id: string | null;
  event_type: string;
  source: "claude_hook" | "mcp_tool" | "internal_worker";
  payload_json: string;
  salience_score: number;
  importance_score: number;
  novelty_score: number;
  risk_score: number;
  contradiction_score: number;
}

export interface EpisodeRow {
  id: string;
  session_id: string;
  task_id: string | null;
  title: string;
  goal: string | null;
  context_summary: string | null;
  action_summary: string | null;
  outcome_summary: string | null;
  lesson_candidates_json: string;
  status: "open" | "closed" | "abandoned";
  salience_score: number;
  started_at: string;
  ended_at: string | null;
}

export interface BeliefRow {
  id: string;
  proposition: string;
  scope_type: ScopeType;
  scope_key: string;
  confidence: number;
  status: "active" | "disputed" | "stale" | "retired";
  evidence_for_json: string;
  evidence_against_json: string;
  first_derived_at: string;
  last_used_at: string | null;
  last_validated_at: string | null;
  decay_rate: number;
}

export interface ProcedureRow {
  id: string;
  name: string;
  trigger_description: string | null;
  steps_markdown: string;
  success_signals_json: string;
  failure_smells_json: string;
  scope_type: ScopeType;
  scope_key: string;
  confidence: number;
  source_episode_ids_json: string;
  last_validated_at: string | null;
}

export interface OpenLoopRow {
  id: string;
  title: string;
  description: string | null;
  loop_type: "contradiction" | "followup" | "risk" | "todo";
  scope_type: ScopeType;
  scope_key: string;
  priority: number;
  status: "open" | "resolved" | "dismissed";
  linked_belief_ids_json: string;
  linked_episode_ids_json: string;
  suggested_next_check: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface ProfileRow {
  id: string;
  profile_type: "user" | "project" | "repo";
  scope_key: string;
  key: string;
  value_json: string;
  confidence: number;
  source: string | null;
  last_validated_at: string | null;
}

export interface SpiritQuestRow {
  id: string;
  guiding_principles_json: string;
  beliefs_before_json: string;
  beliefs_after_json: string;
  rewrites_json: string;
  hallucinations_json: string;
  insights_json: string;
  narrative_markdown: string;
  delivered_at: string | null;
  created_at: string;
}

export interface DreamRow {
  id: string;
  dream_type: "conflict_resolution" | "insight" | "consolidation";
  title: string;
  narrative_markdown: string;
  actions_taken_json: string;
  linked_belief_ids_json: string;
  linked_loop_ids_json: string;
  delivered_at: string | null;
  created_at: string;
}

export interface WorkingMemoryRow {
  id: string;
  session_id: string;
  key: string;
  value_json: string;
  updated_at: string;
  expires_at: string | null;
}

export interface CacheRow {
  id: string;
  cache_key: string;
  kind: string;
  content_markdown: string;
  generated_at: string;
  ttl_seconds: number;
}

export type ScopeType = "global" | "project" | "repo" | "user" | "task_class";

// ---- Appraisal scores ----
export interface AppraisalScores {
  importance: number;
  novelty: number;
  risk: number;
  reuseP: number;
  contradictionPressure: number;
  userEmphasis: number;
  failureIntensity: number;
  salience: number;
}

// ---- Hook response ----
export interface HookResponse {
  additionalContext?: string;
  hookSpecificOutput?: {
    permissionDecision?: "allow" | "deny";
    updatedInput?: unknown;
    additionalContext?: string;
  };
}

// ---- Retrieval ----
export interface RetrievalResult {
  type: "episode" | "belief" | "procedure" | "open_loop" | "profile" | "event";
  id: string;
  score: number;
  summary: string;
  confidence?: number;
  scope?: string;
}

// ---- Conflict ----
export interface Conflict {
  claim: string;
  conflictsWith: string;
  sourceType: string;
  sourceId: string;
  severity: number;
  suggestedResolution: "override" | "partition" | "defer" | "escalate" | "dual_track";
  suggestedCheck?: string;
}
