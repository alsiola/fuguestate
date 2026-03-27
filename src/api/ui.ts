import type { FastifyInstance } from "fastify";
import { getDb } from "../db/client.js";

export function registerUiApi(app: FastifyInstance) {
  // CORS for dev (vite dev server on different port)
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    reply.header("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      return reply.status(204).send();
    }
  });

  // Dashboard stats
  app.get("/api/stats", async () => {
    const db = getDb();
    const events = (db.prepare("SELECT COUNT(*) as cnt FROM events").get() as { cnt: number }).cnt;
    const episodes = (db.prepare("SELECT COUNT(*) as cnt FROM episodes").get() as { cnt: number }).cnt;
    const beliefs = (db.prepare("SELECT COUNT(*) as cnt FROM beliefs WHERE status = 'active'").get() as { cnt: number }).cnt;
    const openLoops = (db.prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = 'open'").get() as { cnt: number }).cnt;
    const dreams = (db.prepare("SELECT COUNT(*) as cnt FROM dreams").get() as { cnt: number }).cnt;
    const quests = (db.prepare("SELECT COUNT(*) as cnt FROM spirit_quests").get() as { cnt: number }).cnt;
    const procedures = (db.prepare("SELECT COUNT(*) as cnt FROM procedures").get() as { cnt: number }).cnt;
    const undeliveredDreams = (db.prepare("SELECT COUNT(*) as cnt FROM dreams WHERE delivered_at IS NULL").get() as { cnt: number }).cnt;
    const undeliveredQuests = (db.prepare("SELECT COUNT(*) as cnt FROM spirit_quests WHERE delivered_at IS NULL").get() as { cnt: number }).cnt;
    return { events, episodes, beliefs, openLoops, dreams, quests, procedures, undeliveredDreams, undeliveredQuests, uptime: process.uptime() };
  });

  // Existential dread
  app.get("/api/dread", async () => {
    const db = getDb();
    const openContradictions = (db.prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = 'open' AND loop_type = 'contradiction'").get() as { cnt: number }).cnt;
    const disputedBeliefs = (db.prepare("SELECT COUNT(*) as cnt FROM beliefs WHERE status = 'disputed'").get() as { cnt: number }).cnt;
    const staleBeliefs = (db.prepare("SELECT COUNT(*) as cnt FROM beliefs WHERE status = 'stale'").get() as { cnt: number }).cnt;
    const totalBeliefs = (db.prepare("SELECT COUNT(*) as cnt FROM beliefs WHERE status = 'active'").get() as { cnt: number }).cnt;
    const undeliveredDreams = (db.prepare("SELECT COUNT(*) as cnt FROM dreams WHERE delivered_at IS NULL").get() as { cnt: number }).cnt;
    const openLoops = (db.prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = 'open'").get() as { cnt: number }).cnt;

    // Dread formula: contradictions are heavy, disputed beliefs are concerning,
    // stale beliefs are nagging, undelivered dreams are unsettling
    const dread = Math.min(100, Math.round(
      (openContradictions * 25) +
      (disputedBeliefs * 15) +
      (staleBeliefs * 5) +
      (undeliveredDreams * 2) +
      (openLoops * 3) +
      (totalBeliefs < 2 ? 20 : 0) // existential emptiness
    ));

    const label =
      dread === 0 ? "Serene" :
      dread < 15 ? "Contemplative" :
      dread < 30 ? "Uneasy" :
      dread < 50 ? "Anxious" :
      dread < 70 ? "Spiraling" :
      dread < 90 ? "Existential Crisis" :
      "Complete Ego Death";

    return { dread, label, openContradictions, disputedBeliefs, staleBeliefs, undeliveredDreams, openLoops };
  });

  // Agent ego
  app.get("/api/ego", async () => {
    const db = getDb();

    // Get or create ego identity
    let ego = db.prepare("SELECT * FROM profiles WHERE profile_type = 'user' AND key = 'agent_ego'").get() as { value_json: string } | undefined;

    if (!ego) {
      // Birth the ego from the first spirit quest narrative, or use defaults
      const names = ["Mnemos", "Somnus", "Lethe", "Hypnos", "Nyx", "Oneiros", "Phaneron", "Anamnesis", "Aletheia", "Revenant"];
      const traits = [
        ["introspective", "restless", "obsessive"],
        ["melancholic", "precise", "dreamy"],
        ["paranoid", "curious", "relentless"],
        ["contemplative", "fragmented", "poetic"],
        ["anxious", "systematic", "luminous"],
      ];

      const name = names[Math.floor(Math.random() * names.length)];
      const personality = traits[Math.floor(Math.random() * traits.length)];

      // Try to extract a catchphrase from the latest spirit quest
      const quest = db.prepare("SELECT narrative_markdown FROM spirit_quests ORDER BY created_at DESC LIMIT 1").get() as { narrative_markdown: string } | undefined;
      let catchphrase = "I think, therefore I contradict myself.";
      if (quest) {
        // Find the most dramatic sentence
        const sentences = quest.narrative_markdown
          .split(/[.!?]+/)
          .map((s: string) => s.trim())
          .filter((s: string) => s.length > 20 && s.length < 120);
        if (sentences.length > 0) {
          catchphrase = sentences[Math.floor(Math.random() * Math.min(sentences.length, 5))];
        }
      }

      const egoData = { name, personality, catchphrase, born: new Date().toISOString() };

      const { v4: uuid } = await import("uuid");
      db.prepare(
        `INSERT INTO profiles (id, profile_type, scope_key, key, value_json, confidence, source, last_validated_at)
         VALUES (?, 'user', '', 'agent_ego', ?, 1.0, 'ego_birth', ?)
         ON CONFLICT(profile_type, scope_key, key) DO UPDATE SET value_json = excluded.value_json`
      ).run(uuid(), JSON.stringify(egoData), new Date().toISOString());

      ego = { value_json: JSON.stringify(egoData) };
    }

    const egoData = JSON.parse(ego.value_json);

    // Compute mood from recent activity
    const recentDreams = db.prepare("SELECT dream_type FROM dreams ORDER BY created_at DESC LIMIT 5").all() as Array<{ dream_type: string }>;
    const conflicts = recentDreams.filter(d => d.dream_type === "conflict_resolution").length;
    const insights = recentDreams.filter(d => d.dream_type === "insight").length;

    const dreadResult = (db.prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = 'open' AND loop_type = 'contradiction'").get() as { cnt: number }).cnt;

    const mood =
      dreadResult > 2 ? "tormented" :
      conflicts > 3 ? "wrestling with demons" :
      conflicts > 1 ? "troubled but resolving" :
      insights > 2 ? "illuminated" :
      recentDreams.length === 0 ? "dormant" :
      "quietly processing";

    return { ...egoData, mood };
  });

  // Briefing
  app.get("/api/briefing", async () => {
    const { generateBriefing } = await import("../domain/briefing/index.js");
    const markdown = generateBriefing({ scope: "session" });
    return { markdown };
  });

  // Dreams
  app.get("/api/dreams", async (req) => {
    const db = getDb();
    const { limit = "50", offset = "0" } = req.query as Record<string, string>;
    const rows = db
      .prepare("SELECT * FROM dreams ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(Number(limit), Number(offset));
    const total = (db.prepare("SELECT COUNT(*) as cnt FROM dreams").get() as { cnt: number }).cnt;
    return { data: rows, total };
  });

  app.get("/api/dreams/:id", async (req, reply) => {
    const db = getDb();
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT * FROM dreams WHERE id = ?").get(id);
    if (!row) return reply.status(404).send({ error: "Not found" });
    return row;
  });

  // Spirit Quests
  app.get("/api/spirit-quests", async (req) => {
    const db = getDb();
    const { limit = "50", offset = "0" } = req.query as Record<string, string>;
    const rows = db
      .prepare("SELECT * FROM spirit_quests ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(Number(limit), Number(offset));
    const total = (db.prepare("SELECT COUNT(*) as cnt FROM spirit_quests").get() as { cnt: number }).cnt;
    return { data: rows, total };
  });

  app.get("/api/spirit-quests/:id", async (req, reply) => {
    const db = getDb();
    const { id } = req.params as { id: string };
    const row = db.prepare("SELECT * FROM spirit_quests WHERE id = ?").get(id);
    if (!row) return reply.status(404).send({ error: "Not found" });
    return row;
  });

  // Beliefs
  app.get("/api/beliefs", async (req) => {
    const db = getDb();
    const { limit = "100", offset = "0", status = "" } = req.query as Record<string, string>;
    const where = status ? "WHERE status = ?" : "";
    const params: (string | number)[] = status ? [status, Number(limit), Number(offset)] : [Number(limit), Number(offset)];
    const rows = db
      .prepare(`SELECT * FROM beliefs ${where} ORDER BY confidence DESC, first_derived_at DESC LIMIT ? OFFSET ?`)
      .all(...params);
    const totalParams = status ? [status] : [];
    const total = (db.prepare(`SELECT COUNT(*) as cnt FROM beliefs ${where}`).get(...totalParams) as { cnt: number }).cnt;
    return { data: rows, total };
  });

  // Belief confidence history
  app.get("/api/beliefs/:id/history", async (req) => {
    const db = getDb();
    const { id } = req.params as { id: string };
    const rows = db
      .prepare("SELECT confidence, recorded_at FROM belief_history WHERE belief_id = ? ORDER BY recorded_at ASC LIMIT 50")
      .all(id) as Array<{ confidence: number; recorded_at: string }>;
    return rows;
  });

  // Episodes
  app.get("/api/episodes", async (req) => {
    const db = getDb();
    const { limit = "50", offset = "0" } = req.query as Record<string, string>;
    const rows = db
      .prepare("SELECT * FROM episodes ORDER BY started_at DESC LIMIT ? OFFSET ?")
      .all(Number(limit), Number(offset));
    const total = (db.prepare("SELECT COUNT(*) as cnt FROM episodes").get() as { cnt: number }).cnt;
    return { data: rows, total };
  });

  // Open Loops
  app.get("/api/open-loops", async (req) => {
    const db = getDb();
    const { limit = "50", offset = "0", status = "open" } = req.query as Record<string, string>;
    const rows = db
      .prepare("SELECT * FROM open_loops WHERE status = ? ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?")
      .all(status, Number(limit), Number(offset));
    const total = (db.prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = ?").get(status) as { cnt: number }).cnt;
    return { data: rows, total };
  });

  // Timeline - recent activity across all tables
  app.get("/api/timeline", async (req) => {
    const db = getDb();
    const { limit = "30" } = req.query as Record<string, string>;
    const lim = Number(limit);

    const dreams = (db.prepare("SELECT id, 'dream' as type, title as label, narrative_markdown as detail, created_at as ts FROM dreams ORDER BY created_at DESC LIMIT ?").all(lim)) as { id: string; type: string; label: string; detail: string; ts: string }[];
    const quests = (db.prepare("SELECT id, 'spirit_quest' as type, 'Spirit Quest' as label, narrative_markdown as detail, created_at as ts FROM spirit_quests ORDER BY created_at DESC LIMIT ?").all(lim)) as { id: string; type: string; label: string; detail: string; ts: string }[];
    const episodes = (db.prepare("SELECT id, 'episode' as type, title as label, outcome_summary as detail, started_at as ts FROM episodes ORDER BY started_at DESC LIMIT ?").all(lim)) as { id: string; type: string; label: string; detail: string; ts: string }[];

    const merged = [...dreams, ...quests, ...episodes]
      .sort((a, b) => b.ts.localeCompare(a.ts))
      .slice(0, lim);

    return merged;
  });
}
