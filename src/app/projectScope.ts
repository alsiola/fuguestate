/**
 * Project scope utilities.
 *
 * Scope flows explicitly: the MCP stdio shim injects its cwd into every
 * tool call, and hooks carry cwd from Claude Code. No global state.
 */

import { logger } from "./logger.js";

/**
 * Derive a scope key from a cwd path (uses the basename).
 */
export function scopeFromCwd(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? "";
}

/**
 * Require a valid scope key or throw. Use this for writes that must not
 * proceed without a valid scope.
 */
export function requireScope(scope: string | undefined | null, context: string): string {
  if (!scope) {
    logger.error({ context }, "No project scope available — refusing to write unscoped data");
    throw new Error(`No project scope available (${context}). Ensure the MCP shim or hook is providing a cwd.`);
  }
  return scope;
}
