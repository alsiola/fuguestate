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
    return { events, episodes, beliefs, openLoops, dreams, quests, procedures, uptime: process.uptime() };
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
