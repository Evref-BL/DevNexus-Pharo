import type { NexusProjectPluginConfig } from "dev-nexus";
import { devNexusPharoSkillPack } from "./devNexusPharoExtension.js";

export const devNexusPharoPluginId = "dev-nexus-pharo";
export const devNexusPharoPluginName = "DevNexus-Pharo";
export const devNexusPharoPluginVersion = "0.1.0";

const projectedSkillDescriptions: Record<string, string> = {
  "dev-nexus-pharo-workflow":
    "Project DevNexus-Pharo workflow guidance into Pharo-capable Codex workers.",
  "plexus-diagnostics":
    "Project static PLexus diagnostic guidance without launching live images.",
  "pharo-launcher-lifecycle":
    "Project safe image lifecycle guidance for explicitly approved launcher work.",
  "mcp-pharo-execution": "Project image-side Pharo MCP execution guidance.",
  "pharo-ci-repro":
    "Project MCP-Pharo Pharo CI reproduction guidance, including local smalltalkCI log capture.",
  "pharo-image-git-handoff":
    "Project MCP-Pharo image-to-Tonel Git handoff guidance for Pharo-capable workers.",
  "pharo-project-load":
    "Project MCP-Pharo project loading and Metacello diagnostic guidance.",
  "pharo-version-compat":
    "Project MCP-Pharo PharoCompatibility and cross-version guidance.",
};

function projectedSkillCapabilities(): NexusProjectPluginConfig["capabilities"] {
  return devNexusPharoSkillPack.map((skill) => ({
    kind: "projected_skill",
    id: `skill-${skill.manifest.id}`,
    skillId: skill.manifest.id,
    description:
      projectedSkillDescriptions[skill.manifest.id] ??
      `Project ${skill.manifest.name} guidance into Pharo-capable Codex workers.`,
    targetAgents: ["codex"],
  }));
}

export function devNexusPharoDevNexusPluginConfig(): NexusProjectPluginConfig {
  return {
    id: devNexusPharoPluginId,
    name: devNexusPharoPluginName,
    version: devNexusPharoPluginVersion,
    enabled: true,
    capabilities: [
      ...projectedSkillCapabilities(),
      {
        kind: "mcp_server",
        id: "plexus-mcp",
        serverName: "plexus_project",
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
        id: "pharo-launcher-mcp",
        serverName: "pharo_launcher",
        description:
          "Scoped Pharo Launcher image lifecycle surface supplied through PLexus.",
        tools: [
          {
            name: "pharo_launcher_image_list",
            description: "List scoped Pharo images.",
          },
          {
            name: "pharo_launcher_image_info",
            description: "Inspect one scoped Pharo image.",
          },
          {
            name: "pharo_launcher_image_start",
            description: "Start one scoped Pharo image when runtime policy allows it.",
          },
          {
            name: "pharo_launcher_image_stop",
            description: "Stop one scoped Pharo image owned by the current project.",
          },
        ],
      },
      {
        kind: "mcp_server",
        id: "plexus-route-control-mcp",
        serverName: "route_control",
        description:
          "Trusted PLexus gateway route-control surface for lifecycle route registration and diagnostics.",
        tools: [
          {
            name: "plexus_project_status",
            description: "Read gateway route status for the scoped project target.",
          },
          {
            name: "plexus_route_to_image",
            description:
              "Route raw image MCP calls through explicit image and target identity.",
          },
        ],
      },
      {
        kind: "mcp_server",
        id: "mcp-gateway",
        serverName: "gateway",
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
          "Verify direct gateway MCP availability before changing Pharo or MCP-Pharo code.",
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
          "Projected Pharo MCP tool contract supplied to the PLexus gateway facade.",
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
          "Agents should use the projected gateway MCP facade for image-side Pharo work instead of editing Smalltalk files as a substitute.",
      },
      {
        kind: "worker_context_fragment",
        id: "context-pharo-runtime-boundary",
        title: "Pharo Runtime Boundary",
        body: [
          "DevNexus-Pharo composes with DevNexus and does not choose or supervise implementation work.",
          "It contributes setup, skills, MCP projection, and scoped PLexus context only; the coordinator still chooses and supervises implementation work.",
          "For Pharo or MCP-Pharo code work, use the direct gateway MCP tools.",
          "If that surface is missing or unreachable, report the infrastructure blocker instead of editing Smalltalk source files from disk as a substitute.",
        ].join(" "),
        targetAgents: ["codex", "claude"],
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
        provenance: "DevNexus dogfood Pharo plugin plan",
      },
    ],
  };
}
