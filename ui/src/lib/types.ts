export interface Dream {
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

export interface SpiritQuest {
  id: string;
  guiding_principles_json: string;
  beliefs_before_json: string;
  beliefs_after_json: string;
  rewrites_json: string;
  hallucinations_json: string;
  insights_json: string;
  narrative_markdown: string;
  style_used: string | null;
  delivered_at: string | null;
  created_at: string;
}

export interface Belief {
  id: string;
  proposition: string;
  scope_type: string;
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

export interface Episode {
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

export interface OpenLoop {
  id: string;
  title: string;
  description: string | null;
  loop_type: "contradiction" | "followup" | "risk" | "todo";
  priority: number;
  status: "open" | "resolved" | "dismissed";
  linked_belief_ids_json: string;
  created_at: string;
  resolved_at: string | null;
}

export interface Stats {
  events: number;
  episodes: number;
  beliefs: number;
  openLoops: number;
  dreams: number;
  quests: number;
  procedures: number;
  uptime: number;
}

export interface TimelineItem {
  id: string;
  type: "dream" | "spirit_quest" | "episode";
  label: string;
  detail: string | null;
  ts: string;
}

export interface Paginated<T> {
  data: T[];
  total: number;
}
