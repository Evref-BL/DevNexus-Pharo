import type { NexusProjectPluginConfig } from "dev-nexus";

export const pharoNexusPluginId = "pharo-nexus";
export const pharoNexusPluginName = "PharoNexus";
export const pharoNexusPluginVersion = "0.1.0";

export function pharoNexusDevNexusPluginConfig(): NexusProjectPluginConfig {
  return {
    id: pharoNexusPluginId,
    name: pharoNexusPluginName,
    version: pharoNexusPluginVersion,
    enabled: true,
    capabilities: [
      {
        kind: "projected_skill",
        id: "skill-pharo-nexus-workflow",
        skillId: "pharo-nexus-workflow",
        description:
          "Project PharoNexus workflow guidance into Pharo-capable Codex workers.",
        targetAgents: ["codex"],
      },
      {
        kind: "projected_skill",
        id: "skill-plexus-diagnostics",
        skillId: "plexus-diagnostics",
        description:
          "Project static PLexus diagnostic guidance without launching live images.",
        targetAgents: ["codex"],
      },
      {
        kind: "projected_skill",
        id: "skill-pharo-launcher-lifecycle",
        skillId: "pharo-launcher-lifecycle",
        description:
          "Project safe image lifecycle guidance for explicitly approved launcher work.",
        targetAgents: ["codex"],
      },
      {
        kind: "projected_skill",
        id: "skill-mcp-pharo-execution",
        skillId: "mcp-pharo-execution",
        description: "Project image-side Pharo MCP execution guidance.",
        targetAgents: ["codex"],
      },
      {
        kind: "mcp_server",
        id: "mcp-plexus",
        serverName: "plexus",
        description:
          "Scoped PLexus project and lifecycle surface; live open/close remains policy-gated.",
        tools: [
          {
            name: "plexus_project_status",
            description: "Read scoped PLexus project and route status.",
          },
          {
            name: "plexus_project_open",
            description:
              "Open scoped runtime resources only when an approved runner allows it.",
          },
          {
            name: "plexus_project_close",
            description:
              "Close only runtime resources owned by the scoped project/workspace.",
          },
        ],
      },
      {
        kind: "mcp_server",
        id: "mcp-pharo",
        serverName: "pharo",
        description:
          "PLexus-projected direct Pharo MCP facade for the selected scoped image.",
        tools: [
          {
            name: "pharo_eval",
            description: "Evaluate Smalltalk code in the routed Pharo image.",
          },
        ],
      },
      {
        kind: "setup_obligation",
        id: "setup-scoped-plexus-context",
        description:
          "Generate project, workspace, target, state-root, and route identity context before Pharo runtime work.",
        required: true,
      },
      {
        kind: "setup_obligation",
        id: "setup-direct-pharo-mcp",
        description:
          "Verify direct pharo MCP availability before changing Pharo or MCP-Pharo code.",
        required: true,
      },
      {
        kind: "environment_hint",
        id: "env-plexus-project-root",
        variable: "PLEXUS_PROJECT_ROOT",
        description: "Project root used by the scoped PLexus project context.",
        required: true,
      },
      {
        kind: "environment_hint",
        id: "env-plexus-workspace-id",
        variable: "PLEXUS_WORKSPACE_ID",
        description: "Stable scoped workspace id for the worker route context.",
        required: true,
      },
      {
        kind: "environment_hint",
        id: "env-plexus-target-id",
        variable: "PLEXUS_TARGET_ID",
        description: "Stable scoped target id for route and cleanup records.",
        required: true,
      },
      {
        kind: "environment_hint",
        id: "env-plexus-state-root",
        variable: "PLEXUS_STATE_ROOT",
        description: "PLexus state root for scoped runtime metadata.",
        required: true,
      },
      {
        kind: "environment_hint",
        id: "env-plexus-pharo-tools-json",
        variable: "PLEXUS_PHARO_TOOLS_JSON",
        description:
          "Projected Pharo MCP tool contract supplied to the PLexus pharo facade.",
        required: true,
      },
      {
        kind: "cleanup_hook",
        id: "cleanup-owned-runtime",
        description:
          "Record imageId and route identity, then clean only owned routes, processes, and disposable image resources.",
        trigger: "after_run",
        required: true,
      },
      {
        kind: "agent_affordance",
        id: "affordance-scoped-image-lifecycle",
        description:
          "Agents may inspect scoped image lifecycle state through PLexus; mutations require the approved runner boundary.",
      },
      {
        kind: "agent_affordance",
        id: "affordance-gateway-pharo-tools",
        description:
          "Agents should use the projected pharo MCP facade for image-side Pharo work instead of editing Smalltalk files as a substitute.",
      },
      {
        kind: "worker_context_fragment",
        id: "context-pharo-runtime-boundary",
        title: "Pharo Runtime Boundary",
        body: [
          "PharoNexus composes with DevNexus and does not choose or supervise implementation work.",
          "It contributes setup, skills, MCP projection, and scoped PLexus context only; the coordinator still chooses and supervises implementation work.",
          "For Pharo or MCP-Pharo code work, use the direct pharo MCP tools.",
          "If that surface is missing or unreachable, report the infrastructure blocker instead of editing Smalltalk source files from disk as a substitute.",
        ].join(" "),
        targetAgents: ["codex", "claude"],
        targetComponents: ["pharo-nexus", "mcp-pharo"],
        provenance: "DevNexus dogfood Pharo plugin plan",
      },
      {
        kind: "worker_briefing_fragment",
        id: "briefing-pharo-agent-setup",
        title: "Pharo Agent Setup",
        body: [
          "Prefer scoped PLexus and gateway tools for image operations.",
          "Keep image lifecycle mutations inside the assigned project/workspace/target scope, record imageId and route identity in handoffs, and clean only resources owned by the worker.",
          "Do not run live images, Docker, PLexus open/close, or gateway live routes unless the selected work item documents the approved isolated runner and cleanup plan.",
        ].join(" "),
        targetAgents: ["codex", "claude"],
        targetComponents: ["pharo-nexus", "mcp-pharo"],
        provenance: "DevNexus dogfood Pharo plugin plan",
      },
    ],
  };
}
