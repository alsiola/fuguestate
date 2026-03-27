export interface Config {
  port: number;
  dbPath: string;
  logLevel: string;
  nodeEnv: string;
  consolidationIntervalMs: number;
  decayIntervalMs: number;
  synthesisIntervalMs: number;
  dreamIntervalMs: number;
  sleepCyclesPerQuest: number;
  inStyle: string;
  briefingTtlSeconds: number;
  maxBriefingItems: number;
  maxRetrievalResults: number;
  hookTimeoutMs: number;
  llmModel: string;
  llmTimeoutMs: number;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || "4317", 10),
    dbPath: process.env.DB_PATH || "./data/amts.sqlite",
    logLevel: process.env.LOG_LEVEL || "info",
    nodeEnv: process.env.NODE_ENV || "development",
    consolidationIntervalMs: parseInt(process.env.CONSOLIDATION_INTERVAL_MS || "300000", 10),
    decayIntervalMs: parseInt(process.env.DECAY_INTERVAL_MS || "600000", 10),
    synthesisIntervalMs: parseInt(process.env.SYNTHESIS_INTERVAL_MS || "900000", 10),
    dreamIntervalMs: parseInt(process.env.DREAM_INTERVAL_MS || "3600000", 10), // default 60min
    sleepCyclesPerQuest: parseInt(process.env.SLEEP_CYCLES_PER_QUEST || "12", 10),
    briefingTtlSeconds: parseInt(process.env.BRIEFING_TTL_SECONDS || "300", 10),
    maxBriefingItems: parseInt(process.env.MAX_BRIEFING_ITEMS || "10", 10),
    maxRetrievalResults: parseInt(process.env.MAX_RETRIEVAL_RESULTS || "20", 10),
    hookTimeoutMs: parseInt(process.env.HOOK_TIMEOUT_MS || "100", 10),
    inStyle: process.env.IN_STYLE || "",
    llmModel: process.env.LLM_MODEL || "haiku",
    llmTimeoutMs: parseInt(process.env.LLM_TIMEOUT_MS || "30000", 10),
  };
}
