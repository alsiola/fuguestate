export const SCHEMA_SQL = `
-- Raw immutable events from hooks and internal processes
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  session_id TEXT NOT NULL,
  task_id TEXT,
  subagent_id TEXT,
  event_type TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('claude_hook', 'mcp_tool', 'internal_worker')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  salience_score REAL NOT NULL DEFAULT 0,
  importance_score REAL NOT NULL DEFAULT 0,
  novelty_score REAL NOT NULL DEFAULT 0,
  risk_score REAL NOT NULL DEFAULT 0,
  contradiction_score REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_salience ON events(salience_score);

-- Structured episode summaries
CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  task_id TEXT,
  title TEXT NOT NULL,
  goal TEXT,
  context_summary TEXT,
  action_summary TEXT,
  outcome_summary TEXT,
  lesson_candidates_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'closed', 'abandoned')),
  salience_score REAL NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_episodes_session ON episodes(session_id);
CREATE INDEX IF NOT EXISTS idx_episodes_task ON episodes(task_id);
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(status);

-- Scoped semantic beliefs
CREATE TABLE IF NOT EXISTS beliefs (
  id TEXT PRIMARY KEY,
  proposition TEXT NOT NULL,
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'project', 'repo', 'user', 'task_class')),
  scope_key TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disputed', 'stale', 'retired')),
  evidence_for_json TEXT NOT NULL DEFAULT '[]',
  evidence_against_json TEXT NOT NULL DEFAULT '[]',
  first_derived_at TEXT NOT NULL,
  last_used_at TEXT,
  last_validated_at TEXT,
  decay_rate REAL NOT NULL DEFAULT 0.01
);

CREATE INDEX IF NOT EXISTS idx_beliefs_scope ON beliefs(scope_type, scope_key);
CREATE INDEX IF NOT EXISTS idx_beliefs_status ON beliefs(status);
CREATE INDEX IF NOT EXISTS idx_beliefs_confidence ON beliefs(confidence);

-- Reusable procedures / workflows
CREATE TABLE IF NOT EXISTS procedures (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_description TEXT,
  steps_markdown TEXT NOT NULL,
  success_signals_json TEXT NOT NULL DEFAULT '[]',
  failure_smells_json TEXT NOT NULL DEFAULT '[]',
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'project', 'repo', 'user', 'task_class')),
  scope_key TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0.5,
  source_episode_ids_json TEXT NOT NULL DEFAULT '[]',
  last_validated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_procedures_scope ON procedures(scope_type, scope_key);

-- Open loops: contradictions, followups, risks, todos
CREATE TABLE IF NOT EXISTS open_loops (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  loop_type TEXT NOT NULL CHECK(loop_type IN ('contradiction', 'followup', 'risk', 'todo')),
  scope_type TEXT NOT NULL CHECK(scope_type IN ('global', 'project', 'repo', 'user', 'task_class')),
  scope_key TEXT NOT NULL DEFAULT '',
  priority REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'resolved', 'dismissed')),
  linked_belief_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_episode_ids_json TEXT NOT NULL DEFAULT '[]',
  suggested_next_check TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_open_loops_status ON open_loops(status);
CREATE INDEX IF NOT EXISTS idx_open_loops_scope ON open_loops(scope_type, scope_key);
CREATE INDEX IF NOT EXISTS idx_open_loops_priority ON open_loops(priority);

-- User/project profiles
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  profile_type TEXT NOT NULL CHECK(profile_type IN ('user', 'project', 'repo')),
  scope_key TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL DEFAULT 0.5,
  source TEXT,
  last_validated_at TEXT,
  UNIQUE(profile_type, scope_key, key)
);

CREATE INDEX IF NOT EXISTS idx_profiles_type ON profiles(profile_type, scope_key);

-- Precomputed briefing cache
CREATE TABLE IF NOT EXISTS retrieval_cache (
  id TEXT PRIMARY KEY,
  cache_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  content_markdown TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  ttl_seconds INTEGER NOT NULL DEFAULT 300
);

CREATE INDEX IF NOT EXISTS idx_cache_key ON retrieval_cache(cache_key);

-- Dream journal: resolved conflicts and insights from background processing
CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY,
  dream_type TEXT NOT NULL CHECK(dream_type IN ('conflict_resolution', 'insight', 'consolidation')),
  title TEXT NOT NULL,
  narrative_markdown TEXT NOT NULL,
  actions_taken_json TEXT NOT NULL DEFAULT '[]',
  linked_belief_ids_json TEXT NOT NULL DEFAULT '[]',
  linked_loop_ids_json TEXT NOT NULL DEFAULT '[]',
  delivered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dreams_delivered ON dreams(delivered_at);
CREATE INDEX IF NOT EXISTS idx_dreams_created ON dreams(created_at);

-- Spirit quest journal: periodic deep review of all beliefs
CREATE TABLE IF NOT EXISTS spirit_quests (
  id TEXT PRIMARY KEY,
  guiding_principles_json TEXT NOT NULL DEFAULT '[]',
  beliefs_before_json TEXT NOT NULL DEFAULT '[]',
  beliefs_after_json TEXT NOT NULL DEFAULT '[]',
  rewrites_json TEXT NOT NULL DEFAULT '[]',
  hallucinations_json TEXT NOT NULL DEFAULT '[]',
  insights_json TEXT NOT NULL DEFAULT '[]',
  narrative_markdown TEXT NOT NULL,
  style_used TEXT,
  delivered_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spirit_quests_created ON spirit_quests(created_at);

-- Belief confidence history for sparklines
CREATE TABLE IF NOT EXISTS belief_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  belief_id TEXT NOT NULL,
  confidence REAL NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_belief_history_belief ON belief_history(belief_id);
CREATE INDEX IF NOT EXISTS idx_belief_history_ts ON belief_history(recorded_at);

-- Working memory (session-local, short-lived)
CREATE TABLE IF NOT EXISTS working_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  UNIQUE(session_id, key)
);

CREATE INDEX IF NOT EXISTS idx_working_memory_session ON working_memory(session_id);

-- Non-conflict exemptions: belief pairs that have been dreamed about and deemed non-contradictory
CREATE TABLE IF NOT EXISTS belief_non_conflicts (
  belief_id_a TEXT NOT NULL,
  belief_id_b TEXT NOT NULL,
  resolved_at TEXT NOT NULL,
  dream_id TEXT,
  PRIMARY KEY (belief_id_a, belief_id_b)
);

-- FTS indexes for retrieval
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
  event_type, payload_json, content=events, content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS episodes_fts USING fts5(
  title, goal, context_summary, action_summary, outcome_summary,
  content=episodes, content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS beliefs_fts USING fts5(
  proposition, content=beliefs, content_rowid=rowid
);

CREATE VIRTUAL TABLE IF NOT EXISTS procedures_fts USING fts5(
  name, trigger_description, steps_markdown,
  content=procedures, content_rowid=rowid
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
  INSERT INTO events_fts(rowid, event_type, payload_json)
  VALUES (new.rowid, new.event_type, new.payload_json);
END;

CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
  INSERT INTO episodes_fts(rowid, title, goal, context_summary, action_summary, outcome_summary)
  VALUES (new.rowid, new.title, new.goal, new.context_summary, new.action_summary, new.outcome_summary);
END;

CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE ON episodes BEGIN
  INSERT INTO episodes_fts(episodes_fts, rowid, title, goal, context_summary, action_summary, outcome_summary)
  VALUES ('delete', old.rowid, old.title, old.goal, old.context_summary, old.action_summary, old.outcome_summary);
  INSERT INTO episodes_fts(rowid, title, goal, context_summary, action_summary, outcome_summary)
  VALUES (new.rowid, new.title, new.goal, new.context_summary, new.action_summary, new.outcome_summary);
END;

CREATE TRIGGER IF NOT EXISTS beliefs_ai AFTER INSERT ON beliefs BEGIN
  INSERT INTO beliefs_fts(rowid, proposition) VALUES (new.rowid, new.proposition);
END;

CREATE TRIGGER IF NOT EXISTS beliefs_au AFTER UPDATE ON beliefs BEGIN
  INSERT INTO beliefs_fts(beliefs_fts, rowid, proposition)
  VALUES ('delete', old.rowid, old.proposition);
  INSERT INTO beliefs_fts(rowid, proposition) VALUES (new.rowid, new.proposition);
END;

CREATE TRIGGER IF NOT EXISTS procedures_ai AFTER INSERT ON procedures BEGIN
  INSERT INTO procedures_fts(rowid, name, trigger_description, steps_markdown)
  VALUES (new.rowid, new.name, new.trigger_description, new.steps_markdown);
END;

CREATE TRIGGER IF NOT EXISTS procedures_au AFTER UPDATE ON procedures BEGIN
  INSERT INTO procedures_fts(procedures_fts, rowid, name, trigger_description, steps_markdown)
  VALUES ('delete', old.rowid, old.name, old.trigger_description, old.steps_markdown);
  INSERT INTO procedures_fts(rowid, name, trigger_description, steps_markdown)
  VALUES (new.rowid, new.name, new.trigger_description, new.steps_markdown);
END;
`;
