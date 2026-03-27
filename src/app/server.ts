import Fastify from "fastify";
import { loadConfig } from "./config.js";
import { logger } from "./logger.js";
import { initDb, closeDb } from "../db/client.js";

// Hook handlers
import { handleSessionStart } from "../api/hooks/sessionStart.js";
import { handleUserPromptSubmit } from "../api/hooks/userPromptSubmit.js";
import { handlePreToolUse } from "../api/hooks/preToolUse.js";
import { handlePostToolUse } from "../api/hooks/postToolUse.js";
import { handlePostToolUseFailure } from "../api/hooks/postToolUseFailure.js";
import { handleTaskCreated } from "../api/hooks/taskCreated.js";
import { handleTaskCompleted } from "../api/hooks/taskCompleted.js";
import { handleSubagentStart } from "../api/hooks/subagentStart.js";
import { handleSubagentStop } from "../api/hooks/subagentStop.js";

// MCP routes
import { registerMcpRoutes } from "../mcp/server.js";

// UI API
import { registerUiApi } from "../api/ui.js";

// Workers
import { runConsolidation } from "../workers/consolidate.js";
import { runSynthesis } from "../workers/synthesise.js";
import { runDecay } from "../workers/decay.js";
import { runDream } from "../workers/dream.js";

const config = loadConfig();

// Init DB
initDb(config.dbPath);

// Create Fastify app
const app = Fastify({ logger: false });

// Request logging
app.addHook("onRequest", async (req) => {
  logger.info({ method: req.method, url: req.url }, "Incoming request");
});

// Health check
app.get("/healthz", async () => ({ status: "ok", ts: new Date().toISOString() }));

// Metrics (lightweight)
app.get("/metrics", async () => {
  const { getDb } = await import("../db/client.js");
  const db = getDb();
  const eventCount = (db.prepare("SELECT COUNT(*) as cnt FROM events").get() as { cnt: number }).cnt;
  const episodeCount = (db.prepare("SELECT COUNT(*) as cnt FROM episodes").get() as { cnt: number }).cnt;
  const beliefCount = (db.prepare("SELECT COUNT(*) as cnt FROM beliefs WHERE status = 'active'").get() as { cnt: number }).cnt;
  const openLoopCount = (db.prepare("SELECT COUNT(*) as cnt FROM open_loops WHERE status = 'open'").get() as { cnt: number }).cnt;
  const procedureCount = (db.prepare("SELECT COUNT(*) as cnt FROM procedures").get() as { cnt: number }).cnt;

  return {
    events: eventCount,
    episodes: episodeCount,
    activeBeliefs: beliefCount,
    openLoops: openLoopCount,
    procedures: procedureCount,
    uptime: process.uptime(),
  };
});

// Hook endpoints
app.post("/hooks/session-start", handleSessionStart);
app.post("/hooks/user-prompt-submit", handleUserPromptSubmit);
app.post("/hooks/pre-tool-use", handlePreToolUse);
app.post("/hooks/post-tool-use", handlePostToolUse);
app.post("/hooks/post-tool-use-failure", handlePostToolUseFailure);
app.post("/hooks/task-created", handleTaskCreated);
app.post("/hooks/task-completed", handleTaskCompleted);
app.post("/hooks/subagent-start", handleSubagentStart);
app.post("/hooks/subagent-stop", handleSubagentStop);

// Passthrough hooks (ingest only, no special logic)
app.post("/hooks/instructions-loaded", async (req, reply) => {
  const { ingestEvent } = await import("../domain/events/index.js");
  const body = req.body as Record<string, unknown>;
  ingestEvent({
    type: "session_started",
    sessionId: (body.sessionId as string) ?? "unknown",
    cwd: "",
    ts: new Date().toISOString(),
    payload: body,
  }, "claude_hook");
  return reply.send({});
});

app.post("/hooks/config-change", async (req, reply) => reply.send({}));
app.post("/hooks/stop", async (req, reply) => reply.send({}));
app.post("/hooks/stop-failure", async (req, reply) => reply.send({}));

// MCP routes
registerMcpRoutes(app);

// UI API routes
registerUiApi(app);

// Serve static UI files (built Vite app)
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiDistPath = path.resolve(__dirname, "../../ui/dist");

if (fs.existsSync(uiDistPath)) {
  app.register(import("@fastify/static"), {
    root: uiDistPath,
    prefix: "/ui/",
    decorateReply: false,
  });

  // SPA fallback — serve index.html for any /ui/* route that isn't a file
  app.setNotFoundHandler(async (req, reply) => {
    if (req.url.startsWith("/ui")) {
      const indexPath = path.join(uiDistPath, "index.html");
      const stream = fs.createReadStream(indexPath);
      return reply.type("text/html").send(stream);
    }
    return reply.status(404).send({ error: "Not found" });
  });
}

// Manual trigger endpoints
app.post("/trigger/sleep", async (_req, reply) => {
  const { runDream } = await import("../workers/dream.js");
  await runDream();
  const { getUndeliveredDreams, getUndeliveredQuests } = await import("../workers/dream.js");
  const dreams = getUndeliveredDreams();
  const quests = getUndeliveredQuests();
  return reply.send({
    dreams: dreams.map((d) => ({ title: d.title, narrative: d.narrative_markdown, actions: JSON.parse(d.actions_taken_json) })),
    quests: quests.map((q) => ({ narrative: q.narrative_markdown, principles: JSON.parse(q.guiding_principles_json), insights: JSON.parse(q.insights_json) })),
  });
});

app.post("/trigger/spirit-quest", async (req, reply) => {
  const { runDream, runSpiritQuest } = await import("../workers/dream.js");
  const body = req.body as { style?: string } | undefined;
  const styleOverride = body?.style || undefined;
  await runDream();
  await runSpiritQuest(styleOverride);
  const { getUndeliveredDreams, getUndeliveredQuests } = await import("../workers/dream.js");
  const dreams = getUndeliveredDreams();
  const quests = getUndeliveredQuests();
  return reply.send({
    dreams: dreams.map((d) => ({ title: d.title, narrative: d.narrative_markdown, actions: JSON.parse(d.actions_taken_json) })),
    quests: quests.map((q) => ({ narrative: q.narrative_markdown, principles: JSON.parse(q.guiding_principles_json), insights: JSON.parse(q.insights_json) })),
  });
});

// Start background workers
let consolidationTimer: NodeJS.Timeout;
let synthesisTimer: NodeJS.Timeout;
let decayTimer: NodeJS.Timeout;
let dreamTimer: NodeJS.Timeout;

function startWorkers() {
  // Run consolidation and dream immediately on startup
  runConsolidation().catch((err) => logger.error({ err }, "Startup consolidation error"));
  runDream().catch((err) => logger.error({ err }, "Startup dream error"));
  consolidationTimer = setInterval(runConsolidation, config.consolidationIntervalMs);
  synthesisTimer = setInterval(runSynthesis, config.synthesisIntervalMs);
  decayTimer = setInterval(runDecay, config.decayIntervalMs);
  dreamTimer = setInterval(runDream, config.dreamIntervalMs);
  logger.info("Background workers started");
}

function stopWorkers() {
  clearInterval(consolidationTimer);
  clearInterval(synthesisTimer);
  clearInterval(decayTimer);
  clearInterval(dreamTimer);
  logger.info("Background workers stopped");
}

// Graceful shutdown
async function shutdown() {
  logger.info("Shutting down...");
  stopWorkers();

  // Run final consolidation
  try {
    await runConsolidation();
  } catch (err) {
    logger.error({ err }, "Error in shutdown consolidation");
  }

  closeDb();
  await app.close();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Start
async function start() {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    startWorkers();
    logger.info({ port: config.port }, "AMTS server started");
  } catch (err) {
    logger.error({ err }, "Failed to start server");
    process.exit(1);
  }
}

start();
