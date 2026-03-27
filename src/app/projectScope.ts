/**
 * Tracks the current project scope (derived from cwd at session start).
 * Used as the default scope_key for beliefs, open loops, etc.
 */

let currentScope = "";

export function setProjectScope(cwd: string): void {
  // Use the basename of the cwd as the project scope key
  currentScope = cwd.split("/").filter(Boolean).pop() ?? "";
}

export function getProjectScope(): string {
  return currentScope;
}
