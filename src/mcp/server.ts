import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { logger } from "../app/logger.js";

// MCP tool handlers
import { generateBriefing } from "../domain/briefing/index.js";
import { handleSearch } from "./tools/search.js";
import { handleGetOpenLoops } from "./tools/getOpenLoops.js";
import { handleGetProjectTruths } from "./tools/getProjectTruths.js";
import { handleGetUserPreferences } from "./tools/getUserPreferences.js";
import { handleCheckConflicts } from "./tools/checkConflicts.js";
import { handleReflectOnTask } from "./tools/reflectOnTask.js";
import { handlePinFact } from "./tools/pinFact.js";
import { handleRetireFact } from "./tools/retireFact.js";
import { handleRecordManualNote } from "./tools/recordManualNote.js";
import { handleMarkResolution } from "./tools/markResolution.js";
import { handleGetRelatedEpisodes } from "./tools/getRelatedEpisodes.js";
import { handleSuggestNextChecks } from "./tools/suggestNextChecks.js";
import { handleExplainPriorDecision } from "./tools/explainPriorDecision.js";
import { handleExtractProcedure } from "./tools/extractProcedure.js";

// MCP resources
import { handleProjectBriefingResource } from "./resources/projectBriefing.js";
import { handleProjectBeliefsResource } from "./resources/projectBeliefs.js";
import { handleOpenLoopsResource } from "./resources/openLoops.js";
import { handleUserPreferencesResource } from "./resources/userPreferences.js";
import { handleCurrentTaskResource } from "./resources/currentTask.js";

// Tool definitions for MCP protocol
export const MCP_TOOLS = [
  {
    name: "memory_search",
    description: "Search across all memory types (episodes, beliefs, procedures, open loops) by keyword",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string" },
        memoryTypes: { type: "array", items: { type: "string", enum: ["episode", "belief", "procedure", "open_loop", "profile", "event"] } },
        scope: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_get_related_episodes",
    description: "Find episodes related to a given topic",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string" },
        scope: { type: "string" },
        limit: { type: "number" },
      },
      required: ["topic"],
    },
  },
  {
    name: "memory_get_open_loops",
    description: "Get unresolved contradictions, pending checks, and deferred risks",
    inputSchema: {
      type: "object" as const,
      properties: {
        scope: { type: "string" },
        priorityMin: { type: "number" },
      },
    },
  },
  {
    name: "memory_get_project_truths",
    description: "Get active beliefs scoped to a project or repo",
    inputSchema: {
      type: "object" as const,
      properties: {
        scopeKey: { type: "string" },
      },
      required: ["scopeKey"],
    },
  },
  {
    name: "memory_get_user_preferences",
    description: "Get known user profile and preferences",
    inputSchema: {
      type: "object" as const,
      properties: {
        userId: { type: "string" },
      },
    },
  },
  {
    name: "memory_check_conflicts",
    description: "Check a set of claims against existing beliefs for contradictions",
    inputSchema: {
      type: "object" as const,
      properties: {
        claims: { type: "array", items: { type: "string" } },
        scope: { type: "string" },
      },
      required: ["claims"],
    },
  },
  {
    name: "memory_suggest_next_checks",
    description: "Given a goal and current plan, suggest verification steps based on memory",
    inputSchema: {
      type: "object" as const,
      properties: {
        goal: { type: "string" },
        currentPlan: { type: "string" },
        scope: { type: "string" },
      },
      required: ["goal"],
    },
  },
  {
    name: "memory_explain_prior_decision",
    description: "Explain why a past decision was made, based on episodes, beliefs, and procedures",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string" },
        scope: { type: "string" },
      },
      required: ["topic"],
    },
  },
  {
    name: "memory_record_manual_note",
    description: "Record a manual note into episodic memory",
    inputSchema: {
      type: "object" as const,
      properties: {
        content: { type: "string" },
        scope: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        sessionId: { type: "string" },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_pin_fact",
    description: "Pin a proposition as a belief with explicit confidence",
    inputSchema: {
      type: "object" as const,
      properties: {
        proposition: { type: "string" },
        scope: { type: "string" },
        confidence: { type: "number" },
        reason: { type: "string" },
      },
      required: ["proposition", "reason"],
    },
  },
  {
    name: "memory_retire_fact",
    description: "Retire a belief that is no longer valid",
    inputSchema: {
      type: "object" as const,
      properties: {
        beliefId: { type: "string" },
        reason: { type: "string" },
      },
      required: ["beliefId", "reason"],
    },
  },
  {
    name: "memory_mark_resolution",
    description: "Mark an open loop as resolved",
    inputSchema: {
      type: "object" as const,
      properties: {
        openLoopId: { type: "string" },
        resolution: { type: "string" },
      },
      required: ["openLoopId", "resolution"],
    },
  },
  {
    name: "memory_reflect_on_task",
    description: "Perform post-task reflection to extract lessons, belief candidates, and procedure candidates",
    inputSchema: {
      type: "object" as const,
      properties: {
        taskId: { type: "string" },
        goal: { type: "string" },
        resultSummary: { type: "string" },
        lessons: { type: "array", items: { type: "string" } },
      },
      required: ["taskId", "goal", "resultSummary"],
    },
  },
  {
    name: "memory_extract_procedure",
    description: "Extract a reusable procedure from a set of episodes",
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: { type: "string" },
        episodeIds: { type: "array", items: { type: "string" } },
      },
      required: ["topic", "episodeIds"],
    },
  },
];

// Resource definitions
export const MCP_RESOURCES = [
  { uri: "memory://project/briefing", name: "Project Briefing", description: "Current cached project briefing", mimeType: "text/markdown" },
  { uri: "memory://project/beliefs", name: "Project Beliefs", description: "Active scoped beliefs", mimeType: "text/markdown" },
  { uri: "memory://project/open-loops", name: "Open Loops", description: "Open loops in current project", mimeType: "text/markdown" },
  { uri: "memory://user/preferences", name: "User Preferences", description: "Known user preferences", mimeType: "text/markdown" },
  { uri: "memory://task/current", name: "Current Task", description: "Current task-local working state", mimeType: "text/markdown" },
];

// Prompt definitions
export const MCP_PROMPTS = [
  {
    name: "task_briefing",
    description: "Get a briefing for starting a new task",
    arguments: [{ name: "taskHint", description: "Optional hint about the task", required: false }],
  },
  {
    name: "reflect_last_task",
    description: "Reflect on the most recently completed task",
    arguments: [{ name: "taskId", description: "Task ID to reflect on", required: false }],
  },
  {
    name: "show_open_loops",
    description: "Show all open loops and unresolved items",
    arguments: [],
  },
  {
    name: "project_truths",
    description: "Show all active project beliefs and truths",
    arguments: [],
  },
];

export function registerMcpRoutes(app: FastifyInstance): void {
  // MCP tool dispatch via HTTP (for the stdio shim to call)
  app.post("/mcp/tools/call", async (req, reply) => {
    const { name, arguments: args } = req.body as { name: string; arguments: Record<string, unknown> };

    try {
      const result = await dispatchTool(name, args);
      return reply.send({ content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }] });
    } catch (err) {
      logger.error({ err, tool: name }, "MCP tool error");
      return reply.status(500).send({ error: { message: (err as Error).message } });
    }
  });

  // MCP tool listing
  app.get("/mcp/tools", async (_req, reply) => {
    return reply.send({ tools: MCP_TOOLS });
  });

  // MCP resource listing
  app.get("/mcp/resources", async (_req, reply) => {
    return reply.send({ resources: MCP_RESOURCES });
  });

  // MCP resource reading
  app.post("/mcp/resources/read", async (req, reply) => {
    const { uri } = req.body as { uri: string };
    try {
      const content = await dispatchResource(uri);
      return reply.send({ contents: [{ uri, mimeType: "text/markdown", text: content }] });
    } catch (err) {
      logger.error({ err, uri }, "MCP resource error");
      return reply.status(404).send({ error: { message: `Resource not found: ${uri}` } });
    }
  });

  // MCP prompt listing
  app.get("/mcp/prompts", async (_req, reply) => {
    return reply.send({ prompts: MCP_PROMPTS });
  });

  // MCP prompt getting
  app.post("/mcp/prompts/get", async (req, reply) => {
    const { name, arguments: args } = req.body as { name: string; arguments?: Record<string, string> };
    try {
      const messages = await dispatchPrompt(name, args ?? {});
      return reply.send({ messages });
    } catch (err) {
      logger.error({ err, prompt: name }, "MCP prompt error");
      return reply.status(404).send({ error: { message: `Prompt not found: ${name}` } });
    }
  });
}

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "memory_search": return handleSearch(args);
    case "memory_get_related_episodes": return handleGetRelatedEpisodes(args);
    case "memory_get_open_loops": return handleGetOpenLoops(args);
    case "memory_get_project_truths": return handleGetProjectTruths(args);
    case "memory_get_user_preferences": return handleGetUserPreferences(args);
    case "memory_check_conflicts": return handleCheckConflicts(args);
    case "memory_suggest_next_checks": return handleSuggestNextChecks(args);
    case "memory_explain_prior_decision": return handleExplainPriorDecision(args);
    case "memory_record_manual_note": return handleRecordManualNote(args);
    case "memory_pin_fact": return handlePinFact(args);
    case "memory_retire_fact": return handleRetireFact(args);
    case "memory_mark_resolution": return handleMarkResolution(args);
    case "memory_reflect_on_task": return handleReflectOnTask(args);
    case "memory_extract_procedure": return handleExtractProcedure(args);
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

async function dispatchResource(uri: string): Promise<string> {
  switch (uri) {
    case "memory://project/briefing": return handleProjectBriefingResource();
    case "memory://project/beliefs": return handleProjectBeliefsResource();
    case "memory://project/open-loops": return handleOpenLoopsResource();
    case "memory://user/preferences": return handleUserPreferencesResource();
    case "memory://task/current": return handleCurrentTaskResource();
    default: throw new Error(`Unknown resource: ${uri}`);
  }
}

async function dispatchPrompt(name: string, args: Record<string, string>): Promise<Array<{ role: string; content: { type: string; text: string } }>> {
  switch (name) {
    case "task_briefing": {
      const briefing = generateBriefing({ scope: "task", taskHint: args.taskHint });
      return [{ role: "user", content: { type: "text", text: `Please review this task briefing and proceed:\n\n${briefing}` } }];
    }
    case "reflect_last_task": {
      return [{ role: "user", content: { type: "text", text: "Please reflect on the last completed task. What went well, what didn't, and what should be remembered for next time?" } }];
    }
    case "show_open_loops": {
      const loops = handleGetOpenLoops({});
      return [{ role: "user", content: { type: "text", text: `Here are the current open loops:\n\n${JSON.stringify(loops, null, 2)}\n\nPlease review and suggest which ones to address.` } }];
    }
    case "project_truths": {
      const truths = handleGetProjectTruths({ scopeKey: "" });
      return [{ role: "user", content: { type: "text", text: `Here are the current project beliefs:\n\n${JSON.stringify(truths, null, 2)}\n\nPlease review for accuracy.` } }];
    }
    default:
      throw new Error(`Unknown prompt: ${name}`);
  }
}
