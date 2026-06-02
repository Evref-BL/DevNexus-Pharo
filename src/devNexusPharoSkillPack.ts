import { type NexusSkillDefinition } from "dev-nexus";
import { mcpPharoDomainSkillPack } from "./mcpPharoDomainSkills.js";

function skillMarkdown(name: string, description: string, body: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

function devNexusPharoSkill(
  id: string,
  name: string,
  description: string,
  body: string,
): NexusSkillDefinition {
  return {
    manifest: {
      id,
      name,
      description,
      version: "0.1.0",
      license: "Apache-2.0",
      source: {
        type: "curated",
        uri: "dev-nexus-pharo:specialization",
      },
      supportedAgents: ["codex"],
      materialization: "copy",
      sourceControl: "support",
    },
    files: {
      "SKILL.md": skillMarkdown(name, description, body),
    },
  };
}

export const devNexusPharoSkillPack: readonly NexusSkillDefinition[] = [
  devNexusPharoSkill(
    "dev-nexus-pharo-workflow",
    "dev-nexus-pharo-workflow",
    "Workflow guidance for DevNexus-Pharo-managed projects, work trackers, worktrees, and publication decisions.",
    `
# DevNexus-Pharo Workflow

Use this skill when working inside a DevNexus-Pharo-managed project.

1. Identify whether the request belongs to the control project or an owning source project.
2. Read local AGENTS.md, NOTES.md, and the project config before changing files.
3. Use provider-neutral project and work-item tools where possible.
4. Confirm direct \`pharo\` MCP tools are available before changing Pharo code; if not, report the MCP infrastructure blocker instead of editing Pharo files.
5. Verify focused behavior before broader checks, then record commits and publication state.
`,
  ),
  devNexusPharoSkill(
    "plexus-diagnostics",
    "plexus-diagnostics",
    "Diagnostic workflow for PLexus gateway status, route health, and safe project-boundary probes.",
    `
# PLexus Diagnostics

Use this skill when checking PLexus gateway status or route behavior.

1. Prefer non-mutating status calls before live open or route probes.
2. Name the project path, state root, workspace id, target id, and cleanup boundary before live checks.
3. Do not launch images or Docker unless the selected task documents isolation and cleanup.
4. Route findings to the owning project board with reproduction details and expected behavior.
`,
  ),
  devNexusPharoSkill(
    "pharo-launcher-lifecycle",
    "pharo-launcher-lifecycle",
    "Safety guidance for Pharo Launcher image creation, launch, inspection, and cleanup operations.",
    `
# Pharo Launcher Lifecycle

Use this skill when a task touches image creation, launch, or cleanup.

1. Treat image launch as host mutation unless an isolated runner is documented.
2. For mutable Pharo work, default to a fresh disposable image per issue, branch, chat, or experiment; images are cheap isolation boundaries.
3. Treat shared or dev images as read-only unless this worker explicitly owns them; never share one writable image across parallel chats.
4. Create a new image instead of reusing an existing one when ownership, branch, or cleanup is unclear.
5. Record image identity, filesystem paths, processes, routes, and cleanup commands.
`,
  ),
  devNexusPharoSkill(
    "mcp-pharo-execution",
    "mcp-pharo-execution",
    "Execution guidance for in-image MCP calls, JSON-RPC reachability, and routed Pharo tool checks.",
    `
# MCP Pharo Execution

Use this skill when validating in-image MCP tool reachability or routed calls.

1. Prove transport reachability before assuming tool behavior is wrong.
2. Use direct \`pharo\` MCP tools for Pharo code work; do not substitute file edits when the MCP surface is missing.
3. Before mutating image-side code, verify the route targets a disposable image scoped to the current issue, branch, chat, or experiment.
4. Keep routed calls non-mutating until an isolated image boundary is explicit; if ownership is unclear, create a new image before writes.
5. Capture request shape, response payload, route id, image id, branch, and owning project.
6. Add regression coverage at the lowest layer that owns the failure.
`,
  ),
  ...mcpPharoDomainSkillPack,
];

export function devNexusPharoSkillDefinitions(): NexusSkillDefinition[] {
  return [...devNexusPharoSkillPack];
}
