import { describe, expect, it } from "vitest";
import { projectPluginCapabilityProjections } from "dev-nexus";
import {
  devNexusPharoDevNexusPluginConfig,
  devNexusPharoPluginId,
  devNexusPharoPluginName,
  devNexusPharoPluginVersion,
} from "./devNexusPharoPlugin.js";
import { devNexusPharoSkillPack } from "./devNexusPharoExtension.js";

type DevNexusPharoCapability =
  ReturnType<typeof devNexusPharoDevNexusPluginConfig>["capabilities"][number];

function capabilitiesOfKind<K extends DevNexusPharoCapability["kind"]>(
  kind: K,
): Array<Extract<DevNexusPharoCapability, { kind: K }>> {
  return devNexusPharoDevNexusPluginConfig().capabilities.filter(
    (capability): capability is Extract<DevNexusPharoCapability, { kind: K }> =>
      capability.kind === kind,
  );
}

function devNexusPharoSkillPackIds(): string[] {
  return devNexusPharoSkillPack.map((skill) => skill.manifest.id);
}

describe("DevNexusPharo DevNexus plugin", () => {
  it("declares a complete non-empty DevNexusPharo capability surface", () => {
    const config = devNexusPharoDevNexusPluginConfig();

    expect(config).toMatchObject({
      id: devNexusPharoPluginId,
      name: devNexusPharoPluginName,
      version: devNexusPharoPluginVersion,
      enabled: true,
    });
    expect(config.capabilities).not.toHaveLength(0);
    expect(config.capabilities.map((capability) => capability.id)).toEqual([
      "skill-dev-nexus-pharo-workflow",
      "skill-plexus-diagnostics",
      "skill-pharo-launcher-lifecycle",
      "skill-mcp-pharo-execution",
      "skill-pharo-ci-repro",
      "skill-pharo-image-git-handoff",
      "skill-pharo-project-load",
      "skill-pharo-version-compat",
      "plexus-mcp",
      "pharo-launcher-mcp",
      "plexus-route-control-mcp",
      "mcp-gateway",
      "setup-scoped-plexus-context",
      "setup-direct-pharo-mcp",
      "setup-scoped-pharo-image-profile",
      "setup-image-local-pharo-dependencies",
      "env-plexus-project-root",
      "env-plexus-workspace-id",
      "env-plexus-target-id",
      "env-plexus-state-root",
      "env-plexus-pharo-tools-json",
      "cleanup-owned-runtime",
      "affordance-scoped-image-lifecycle",
      "affordance-gateway-pharo-tools",
      "affordance-pharo-host-capability-probes",
      "context-pharo-runtime-boundary",
      "context-pharo-host-capabilities",
      "briefing-pharo-agent-setup",
    ]);
    expect(new Set(config.capabilities.map((capability) => capability.kind))).toEqual(
      new Set([
        "projected_skill",
        "mcp_server",
        "setup_obligation",
        "environment_hint",
        "cleanup_hook",
        "agent_affordance",
        "worker_context_fragment",
        "worker_briefing_fragment",
      ]),
    );
  });

  it("projects stable skill capabilities for every DevNexusPharo skill", () => {
    const projectedSkills = capabilitiesOfKind("projected_skill");

    expect(projectedSkills.map((capability) => capability.skillId).sort()).toEqual(
      devNexusPharoSkillPackIds().sort(),
    );
    expect(
      projectedSkills.map((capability) => ({
        id: capability.id,
        skillId: capability.skillId,
        targetAgents: capability.targetAgents,
      })),
    ).toEqual([
      {
        id: "skill-dev-nexus-pharo-workflow",
        skillId: "dev-nexus-pharo-workflow",
        targetAgents: ["codex"],
      },
      {
        id: "skill-plexus-diagnostics",
        skillId: "plexus-diagnostics",
        targetAgents: ["codex"],
      },
      {
        id: "skill-pharo-launcher-lifecycle",
        skillId: "pharo-launcher-lifecycle",
        targetAgents: ["codex"],
      },
      {
        id: "skill-mcp-pharo-execution",
        skillId: "mcp-pharo-execution",
        targetAgents: ["codex"],
      },
      {
        id: "skill-pharo-ci-repro",
        skillId: "pharo-ci-repro",
        targetAgents: ["codex"],
      },
      {
        id: "skill-pharo-image-git-handoff",
        skillId: "pharo-image-git-handoff",
        targetAgents: ["codex"],
      },
      {
        id: "skill-pharo-project-load",
        skillId: "pharo-project-load",
        targetAgents: ["codex"],
      },
      {
        id: "skill-pharo-version-compat",
        skillId: "pharo-version-compat",
        targetAgents: ["codex"],
      },
    ]);

    const projectedProfileCapabilities = projectPluginCapabilityProjections({
      plugins: [devNexusPharoDevNexusPluginConfig()],
    })[0].capabilities.filter(
      (capability) => capability.kind === "projected_skill",
    );
    expect(
      projectedProfileCapabilities.map((capability) => ({
        id: capability.id,
        skillId: capability.skillId,
        targetAgents: capability.targetAgents,
      })),
    ).toEqual(
      projectedSkills.map((capability) => ({
        id: capability.id,
        skillId: capability.skillId,
        targetAgents: capability.targetAgents ?? [],
      })),
    );
  });

  it("declares scoped PLexus and direct Pharo MCP server surfaces", () => {
    const mcpServers = capabilitiesOfKind("mcp_server");

    expect(
      mcpServers.map((server) => ({
        id: server.id,
        serverName: server.serverName,
        tools: server.tools?.map((tool) => tool.name),
      })),
    ).toEqual([
      {
        id: "plexus-mcp",
        serverName: "plexus_project",
        tools: [
          "plexus_project_status",
          "plexus_project_open",
          "plexus_project_close",
        ],
      },
      {
        id: "pharo-launcher-mcp",
        serverName: "pharo_launcher",
        tools: [
          "pharo_launcher_image_list",
          "pharo_launcher_image_info",
          "pharo_launcher_image_create",
          "pharo_launcher_image_start",
          "pharo_launcher_image_stop",
        ],
      },
      {
        id: "plexus-route-control-mcp",
        serverName: "route_control",
        tools: ["plexus_project_status", "plexus_route_to_image"],
      },
      {
        id: "mcp-gateway",
        serverName: "gateway",
        tools: ["pharo_eval"],
      },
    ]);
  });

  it("declares setup, environment, cleanup, and agent affordance obligations", () => {
    expect(capabilitiesOfKind("setup_obligation")).toMatchObject([
      {
        id: "setup-scoped-plexus-context",
        required: true,
      },
      {
        id: "setup-direct-pharo-mcp",
        required: true,
      },
      {
        id: "setup-scoped-pharo-image-profile",
        required: false,
      },
      {
        id: "setup-image-local-pharo-dependencies",
        required: false,
      },
    ]);
    expect(
      capabilitiesOfKind("environment_hint").map((capability) => ({
        id: capability.id,
        variable: capability.variable,
        required: capability.required,
      })),
    ).toEqual([
      {
        id: "env-plexus-project-root",
        variable: "PLEXUS_PROJECT_ROOT",
        required: true,
      },
      {
        id: "env-plexus-workspace-id",
        variable: "PLEXUS_WORKSPACE_ID",
        required: true,
      },
      {
        id: "env-plexus-target-id",
        variable: "PLEXUS_TARGET_ID",
        required: true,
      },
      {
        id: "env-plexus-state-root",
        variable: "PLEXUS_STATE_ROOT",
        required: true,
      },
      {
        id: "env-plexus-pharo-tools-json",
        variable: "PLEXUS_PHARO_TOOLS_JSON",
        required: true,
      },
    ]);
    expect(capabilitiesOfKind("cleanup_hook")).toMatchObject([
      {
        id: "cleanup-owned-runtime",
        trigger: "after_run",
        required: true,
      },
    ]);
    expect(capabilitiesOfKind("agent_affordance").map((capability) => capability.id))
      .toEqual([
        "affordance-scoped-image-lifecycle",
        "affordance-gateway-pharo-tools",
        "affordance-pharo-host-capability-probes",
      ]);
  });

  it("carries scoped worker fragments with Pharo runtime guidance", () => {
    const contextFragment = capabilitiesOfKind("worker_context_fragment").find(
      (capability) => capability.id === "context-pharo-runtime-boundary",
    );
    const capabilityFragment = capabilitiesOfKind("worker_context_fragment").find(
      (capability) => capability.id === "context-pharo-host-capabilities",
    );
    const briefingFragment = capabilitiesOfKind("worker_briefing_fragment")[0];

    expect(contextFragment).toMatchObject({
      id: "context-pharo-runtime-boundary",
      targetAgents: ["codex", "claude"],
    });
    expect(contextFragment.targetComponents).toBeUndefined();
    expect(contextFragment.body).toContain(
      "DevNexus-Pharo composes with DevNexus and does not choose or supervise implementation work",
    );
    expect(contextFragment.body).toContain("direct gateway MCP tools");
    expect(contextFragment.body).toContain("report the infrastructure blocker");
    expect(contextFragment.body).toContain("Smalltalk source files from disk");
    expect(capabilityFragment).toMatchObject({
      id: "context-pharo-host-capabilities",
      targetAgents: ["codex", "claude"],
    });
    expect(capabilityFragment?.body).toContain("Capability tags: pharo");
    expect(capabilityFragment?.body).toContain("pharo-live-runtime");
    expect(capabilityFragment?.body).toContain("approval-gated");

    expect(briefingFragment).toMatchObject({
      id: "briefing-pharo-agent-setup",
      targetAgents: ["codex", "claude"],
    });
    expect(briefingFragment.targetComponents).toBeUndefined();
    expect(briefingFragment.body).toContain(
      "Prefer scoped PLexus and gateway tools for image operations",
    );
    expect(briefingFragment.body).toContain("Keep image lifecycle");
    expect(briefingFragment.body).toContain("record imageId and route identity");
    expect(briefingFragment.body).toContain("clean only resources owned by the worker");
  });
});
