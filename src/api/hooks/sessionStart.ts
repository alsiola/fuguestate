import type { FastifyRequest, FastifyReply } from "fastify";
import { ingestEvent } from "../../domain/events/index.js";
import { setWorkingMemory } from "../../domain/workingMemory/index.js";
import { generateBriefing, getCachedBriefing, cacheBriefing } from "../../domain/briefing/index.js";
import { getUndeliveredDreams, markDreamsDelivered, getUndeliveredQuests, markQuestsDelivered } from "../../workers/dream.js";
import { loadConfig } from "../../app/config.js";
import { logger } from "../../app/logger.js";
import { scopeFromCwd } from "../../app/projectScope.js";

interface SessionStartBody {
  session_id?: string;
  sessionId?: string;
  cwd?: string;
  source?: string;
  model?: string;
  [key: string]: unknown;
}

export async function handleSessionStart(req: FastifyRequest, reply: FastifyReply) {
  const body = req.body as SessionStartBody;
  const sessionId = body.session_id ?? body.sessionId ?? "unknown";
  const ts = new Date().toISOString();

  try {
    // Ingest event
    ingestEvent(
      {
        type: "session_started",
        sessionId,
        cwd: body.cwd ?? process.cwd(),
        ts,
        payload: body,
      },
      "claude_hook"
    );

    // Init working memory and project scope
    setWorkingMemory(sessionId, "session_start", { cwd: body.cwd, ts });
    // Scope is now derived at point-of-use from cwd (via shim or hook payload)

    // Generate or fetch cached briefing
    const config = loadConfig();
    const cacheKey = `briefing:session:${sessionId}`;
    let briefing = getCachedBriefing(cacheKey, config.briefingTtlSeconds);
    if (!briefing) {
      briefing = generateBriefing({ scope: "session", sessionId, scopeKey: body.cwd ? scopeFromCwd(body.cwd) : undefined });
      if (briefing !== "No relevant memory available yet.") {
        cacheBriefing(cacheKey, "session_briefing", briefing, config.briefingTtlSeconds);
      }
    }

    // Check for undelivered dreams
    const dreams = getUndeliveredDreams();
    let dreamSection = "";
    if (dreams.length > 0) {
      const lines: string[] = ["\n## Dreams (overnight processing)"];
      lines.push("The following were resolved while you were away. Tell the user about these.\n");
      for (const dream of dreams) {
        const actions = JSON.parse(dream.actions_taken_json) as string[];
        lines.push(`### ${dream.title}`);
        lines.push(dream.narrative_markdown);
        if (actions.length > 0) {
          lines.push("\n**Actions taken:**");
          for (const action of actions) {
            lines.push(`- ${action}`);
          }
        }
        lines.push("");
      }
      dreamSection = lines.join("\n");
      markDreamsDelivered(dreams.map((d) => d.id));
      logger.info({ dreamCount: dreams.length }, "Delivered dreams to session briefing");
    }

    // Check for undelivered spirit quests
    const quests = getUndeliveredQuests();
    if (quests.length > 0) {
      const questLines: string[] = ["\n## Spirit Quest Report 🍄"];
      questLines.push("A deep belief review was performed. Tell the user about the results.\n");
      for (const quest of quests) {
        const principles = JSON.parse(quest.guiding_principles_json) as string[];
        const insights = JSON.parse(quest.insights_json) as string[];
        const hallucinations = JSON.parse(quest.hallucinations_json) as string[];

        questLines.push(quest.narrative_markdown);
        questLines.push("\n**Guiding Principles:**");
        for (const p of principles) {
          questLines.push(`- ${p}`);
        }
        if (insights.length > 0) {
          questLines.push("\n**Applied Insights:**");
          for (const i of insights) {
            questLines.push(`- ${i}`);
          }
        }
        if (hallucinations.length > 0) {
          questLines.push("\n**Rejected Hallucinations:**");
          for (const h of hallucinations) {
            questLines.push(`- ${h}`);
          }
        }
        questLines.push("");
      }
      dreamSection += questLines.join("\n");
      markQuestsDelivered(quests.map((q) => q.id));
      logger.info({ questCount: quests.length }, "Delivered spirit quest reports to session briefing");
    }

    const fullBriefing = briefing !== "No relevant memory available yet."
      ? briefing + dreamSection
      : dreamSection || undefined;

    return reply.send({
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: fullBriefing },
    });
  } catch (err) {
    logger.error({ err, sessionId }, "Error in session-start hook");
    // Fail open
    return reply.send({});
  }
}
