import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  pharoNexusDevNexusPluginConfig,
  pharoNexusPluginId,
  pharoNexusPluginName,
  pharoNexusPluginVersion,
} from "./pharoNexusPlugin.js";

type PharoNexusCapability =
  ReturnType<typeof pharoNexusDevNexusPluginConfig>["capabilities"][number];

function capabilitiesOfKind<K extends PharoNexusCapability["kind"]>(
  kind: K,
): Array<Extract<PharoNexusCapability, { kind: K }>> {
  return pharoNexusDevNexusPluginConfig().capabilities.filter(
    (capability): capability is Extract<PharoNexusCapability, { kind: K }> =>
      capability.kind === kind,
  );
}

function pharoNexusSkillPackIds(): string[] {
  const extensionSource = fs.readFileSync(
    new URL("./pharoNexusExtension.ts", import.meta.url),
    "utf8",
  );
  expect(extensionSource).toContain("export const pharoNexusSkillPack");

  return [...extensionSource.matchAll(/pharoNexusSkill\(\s*"([^"]+)"/gu)].map(
    (match) => match[1],
  );
}

describe("PharoNexus DevNexus plugin", () => {
  it("declares a complete non-empty PharoNexus capability surface", () => {
    const config = pharoNexusDevNexusPluginConfig();

    expect(config).toMatchObject({
      id: pharoNexusPluginId,
      name: pharoNexusPluginName,
      version: pharoNexusPluginVersion,
      enabled: true,
    });
    expect(config.capabilities).not.toHaveLength(0);
    expect(config.capabilities.map((capability) => capability.id)).toEqual([
      "skill-pharo-nexus-workflow",
      "skill-plexus-diagnostics",
      "skill-pharo-launcher-lifecycle",
      "skill-mcp-pharo-execution",
      "mcp-plexus",
      "mcp-pharo",
      "setup-scoped-plexus-context",
      "setup-direct-pharo-mcp",
      "env-plexus-project-root",
      "env-plexus-workspace-id",
      "env-plexus-target-id",
      "env-plexus-state-root",
      "env-plexus-pharo-tools-json",
      "cleanup-owned-runtime",
      "affordance-scoped-image-lifecycle",
      "affordance-gateway-pharo-tools",
      "context-pharo-runtime-boundary",
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

  it("projects stable skill capabilities for every PharoNexus skill", () => {
    const projectedSkills = capabilitiesOfKind("projected_skill");

    expect(projectedSkills.map((capability) => capability.skillId).sort()).toEqual(
      pharoNexusSkillPackIds().sort(),
    );
    expect(
      projectedSkills.map((capability) => ({
        id: capability.id,
        skillId: capability.skillId,
        targetAgents: capability.targetAgents,
      })),
    ).toEqual([
      {
        id: "skill-pharo-nexus-workflow",
        skillId: "pharo-nexus-workflow",
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
    ]);
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
        id: "mcp-plexus",
        serverName: "plexus",
        tools: [
          "plexus_project_status",
          "plexus_project_open",
          "plexus_project_close",
        ],
      },
      {
        id: "mcp-pharo",
        serverName: "pharo",
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
      ]);
  });

  it("carries scoped worker fragments with Pharo runtime guidance", () => {
    const contextFragment = capabilitiesOfKind("worker_context_fragment")[0];
    const briefingFragment = capabilitiesOfKind("worker_briefing_fragment")[0];

    expect(contextFragment).toMatchObject({
      id: "context-pharo-runtime-boundary",
      targetAgents: ["codex", "claude"],
      targetComponents: ["pharo-nexus", "mcp-pharo"],
    });
    expect(contextFragment.body).toContain(
      "PharoNexus composes with DevNexus and does not choose or supervise implementation work",
    );
    expect(contextFragment.body).toContain("direct pharo MCP tools");
    expect(contextFragment.body).toContain("report the infrastructure blocker");
    expect(contextFragment.body).toContain("Smalltalk source files from disk");

    expect(briefingFragment).toMatchObject({
      id: "briefing-pharo-agent-setup",
      targetAgents: ["codex", "claude"],
      targetComponents: ["pharo-nexus", "mcp-pharo"],
    });
    expect(briefingFragment.body).toContain(
      "Prefer scoped PLexus and gateway tools for image operations",
    );
    expect(briefingFragment.body).toContain("Keep image lifecycle");
    expect(briefingFragment.body).toContain("record imageId and route identity");
    expect(briefingFragment.body).toContain("clean only resources owned by the worker");
  });
});
