import { describe, expect, it } from "vitest";
import {
  devNexusPharoHostCapabilityTags,
  devNexusPharoRunnerProfileTemplates,
  evaluateDevNexusPharoStaticHostCapabilities,
} from "../../src/devNexusPharoHostCapabilities.js";

describe("DevNexus-Pharo host capability contributions", () => {
  it("evaluates static PLexus and Pharo host probes without DevNexus-Pharo commands", () => {
    const result = evaluateDevNexusPharoStaticHostCapabilities({
      commands: {
        pharo: true,
        plexus: true,
        "plexus-gateway": false,
      },
      mcpServers: {
        plexus_project: true,
        pharo_launcher: false,
        route_control: true,
        pharo_gateway: true,
      },
      pharoLauncherInstalled: false,
      guiAdjacentAvailable: true,
    });

    expect(result.mode).toBe("static-read-only");
    expect(result.presentCapabilities).toEqual([
      "pharo",
      "plexus",
      "mcp",
      "gui-adjacent",
    ]);
    expect(result.missingCapabilities).toEqual(["pharo-launcher"]);
    expect(result.unknownCapabilities).toEqual([]);
    expect(result.probes).toMatchObject([
      {
        id: "command:pharo",
        capability: "pharo",
        status: "present",
      },
      {
        id: "command:plexus",
        capability: "plexus",
        status: "present",
      },
      {
        id: "command:plexus-gateway",
        capability: "plexus",
        status: "missing",
      },
      {
        id: "mcp-config:plexus_project",
        capability: "mcp",
        status: "present",
      },
      {
        id: "mcp-config:pharo_launcher",
        capability: "mcp",
        status: "missing",
      },
      {
        id: "mcp-config:route_control",
        capability: "mcp",
        status: "present",
      },
      {
        id: "mcp-config:pharo_gateway",
        capability: "mcp",
        status: "present",
      },
      {
        id: "pharo-launcher:installation",
        capability: "pharo-launcher",
        status: "missing",
      },
      {
        id: "host:gui-adjacent",
        capability: "gui-adjacent",
        status: "present",
      },
    ]);
    expect(result.probes.map((probe) => probe.effect)).toEqual(
      Array(result.probes.length).fill("none"),
    );
  });

  it("keeps unknown static probe facts out of present and missing host tags", () => {
    const result = evaluateDevNexusPharoStaticHostCapabilities({
      commands: { plexus: true },
    });

    expect(result.presentCapabilities).toEqual(["plexus"]);
    expect(result.missingCapabilities).toEqual([]);
    expect(result.unknownCapabilities).toEqual([
      "pharo",
      "pharo-launcher",
      "mcp",
      "gui-adjacent",
    ]);
    expect(result.probes.find((probe) => probe.id === "command:pharo")).toMatchObject({
      status: "unknown",
      nextAction: "Configure the static command probe for pharo.",
    });
  });

  it("publishes runner profile templates for PLexus-backed Pharo work", () => {
    expect(devNexusPharoHostCapabilityTags).toEqual([
      "pharo",
      "pharo-launcher",
      "plexus",
      "mcp",
      "gui-adjacent",
    ]);
    expect(
      devNexusPharoRunnerProfileTemplates.map((profile) => ({
        id: profile.id,
        requiredCapabilities: profile.requiredCapabilities,
        allowedOperationClasses: profile.allowedOperationClasses,
        commandProfileRefs: profile.commandProfileRefs,
        mutationClass: profile.mutationClass,
        approval: profile.approval,
      })),
    ).toEqual([
      {
        id: "pharo-read-only-status",
        requiredCapabilities: ["pharo"],
        allowedOperationClasses: ["read_only"],
        commandProfileRefs: ["pharo-status"],
        mutationClass: "none",
        approval: {
          required: false,
          policyGateIds: [],
          approvalRef: null,
          reason: null,
        },
      },
      {
        id: "pharo-mcp-tool-list",
        requiredCapabilities: ["mcp", "plexus"],
        allowedOperationClasses: ["read_only"],
        commandProfileRefs: ["plexus-mcp-tool-list"],
        mutationClass: "none",
        approval: {
          required: false,
          policyGateIds: [],
          approvalRef: null,
          reason: null,
        },
      },
      {
        id: "pharo-verification",
        requiredCapabilities: ["pharo", "pharo-launcher", "plexus", "mcp"],
        allowedOperationClasses: ["read_only", "verification"],
        commandProfileRefs: ["pharo-verify"],
        mutationClass: "verification",
        approval: {
          required: false,
          policyGateIds: [],
          approvalRef: null,
          reason: null,
        },
      },
      {
        id: "pharo-live-runtime",
        requiredCapabilities: [
          "pharo",
          "pharo-launcher",
          "plexus",
          "mcp",
          "gui-adjacent",
        ],
        allowedOperationClasses: ["read_only", "live_runtime"],
        commandProfileRefs: ["pharo-live-runtime-smoke"],
        mutationClass: "live_runtime",
        approval: {
          required: true,
          policyGateIds: ["runner.dev-nexus-pharo.live-runtime.approved"],
          approvalRef: null,
          reason:
            "Live Pharo image, PLexus route, Docker, or GUI-adjacent runtime work requires an explicit bounded runner approval.",
        },
      },
    ]);
  });
});
