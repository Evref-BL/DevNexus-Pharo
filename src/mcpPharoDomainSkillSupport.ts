import type { NexusSkillDefinition } from "dev-nexus";

export const mcpPharoDomainSkillSourceCommit =
  "8ba98ede78404d6a1e3937a8a759022f90c33bde";

const mcpPharoRepositoryUri = "https://github.com/Evref-BL/MCP";

export function skillText(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

export function mcpPharoDomainSkill(
  id: string,
  description: string,
  files: Record<string, string>,
): NexusSkillDefinition {
  return {
    manifest: {
      id,
      name: id,
      description,
      version: "0.1.0",
      license: "Apache-2.0",
      source: {
        type: "git",
        uri: `${mcpPharoRepositoryUri}/tree/${mcpPharoDomainSkillSourceCommit}/user/skills/${id}`,
        commit: mcpPharoDomainSkillSourceCommit,
      },
      supportedAgents: ["codex"],
      materialization: "copy",
      sourceControl: "support",
    },
    files,
  };
}
