import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { SCHEMA_SQL } from "./schema.js";
import { logger } from "../app/logger.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialised. Call initDb() first.");
  }
  return db;
}

export function initDb(dbPath: string): Database.Database {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);

  // Performance pragmas
  db.pragma("journal_mode = DELETE");
  db.pragma("synchronous = FULL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  // Run schema
  db.exec(SCHEMA_SQL);

  // Migrations for existing databases
  const cols = db.prepare("PRAGMA table_info(spirit_quests)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "style_used")) {
    db.exec("ALTER TABLE spirit_quests ADD COLUMN style_used TEXT");
    logger.info("Migration: added style_used column to spirit_quests");
  }
  if (!cols.some((c) => c.name === "drug_used")) {
    db.exec("ALTER TABLE spirit_quests ADD COLUMN drug_used TEXT NOT NULL DEFAULT 'ayahuasca'");
    logger.info("Migration: added drug_used column to spirit_quests");
  }

  logger.info({ dbPath }, "Database initialised");
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    logger.info("Database closed");
  }
}
