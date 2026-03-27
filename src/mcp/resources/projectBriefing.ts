import { generateBriefing } from "../../domain/briefing/index.js";

export function handleProjectBriefingResource(): string {
  return generateBriefing({ scope: "project" });
}
