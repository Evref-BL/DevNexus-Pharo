import { describe, expect, it } from "vitest";
import {
  devNexusPharoHostCapabilityTags,
  devNexusPharoRunnerProfileTemplates,
  evaluateDevNexusPharoStaticHostCapabilities,
} from "./devNexusPharoHostCapabilities.js";

describe("DevNexus-Pharo host capability contributions", () => {
  it("declares Pharo-domain capability tags for generic DevNexus host matching", () => {
    expect(devNexusPharoHostCapabilityTags).toEqual([
      "pharo",
      "pharo-launcher",
      "plexus",
      "mcp",
      "dev-nexus-pharo",
      "gui-adjacent",
    ]);
  });

  it("evaluates static host probes without launching Pharo, PLexus, Docker, GUI, or SSH", () => {
    const result = evaluateDevNexusPharoStaticHostCapabilities({
      commands: {
        pharo: true,
        "dev-nexus-pharo": true,
        "plexus-gateway": false,
      },
      mcpServers: {
        dev_nexus_pharo: true,
        plexus_project: false,
        pharo_launcher: false,
      },
      pharoLauncherInstalled: false,
      guiAdjacentAvailable: true,
    });

    expect(result.mode).toBe("static-read-only");
    expect(result.presentCapabilities).toEqual([
      "pharo",
      "mcp",
      "dev-nexus-pharo",
      "gui-adjacent",
    ]);
    expect(result.missingCapabilities).toEqual(["pharo-launcher", "plexus"]);
    expect(result.probes).toMatchObject([
      {
        id: "command:pharo",
        capability: "pharo",
        status: "present",
      },
      {
        id: "command:dev-nexus-pharo",
        capability: "dev-nexus-pharo",
        status: "present",
      },
      {
        id: "command:plexus-gateway",
        capability: "plexus",
        status: "missing",
      },
      {
        id: "mcp-config:dev_nexus_pharo",
        capability: "mcp",
        status: "present",
      },
      {
        id: "mcp-config:plexus_project",
        capability: "mcp",
        status: "missing",
      },
      {
        id: "mcp-config:pharo_launcher",
        capability: "mcp",
        status: "missing",
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
      commands: {
        "dev-nexus-pharo": true,
      },
    });

    expect(result.presentCapabilities).toEqual(["dev-nexus-pharo"]);
    expect(result.missingCapabilities).toEqual([]);
    expect(result.unknownCapabilities).toEqual([
      "pharo",
      "pharo-launcher",
      "plexus",
      "mcp",
      "gui-adjacent",
    ]);
    expect(result.probes.find((probe) => probe.id === "command:pharo")).toMatchObject({
      status: "unknown",
      nextAction: "Configure the static command probe for pharo.",
    });
  });

  it("publishes runner profile templates for read-only, MCP, verification, and gated runtime work", () => {
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
        requiredCapabilities: ["dev-nexus-pharo"],
        allowedOperationClasses: ["read_only"],
        commandProfileRefs: ["dev-nexus-pharo-status"],
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
        requiredCapabilities: ["mcp", "dev-nexus-pharo"],
        allowedOperationClasses: ["read_only"],
        commandProfileRefs: ["dev-nexus-pharo-mcp-tool-list"],
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
        requiredCapabilities: [
          "pharo",
          "pharo-launcher",
          "plexus",
          "mcp",
          "dev-nexus-pharo",
        ],
        allowedOperationClasses: ["read_only", "verification"],
        commandProfileRefs: ["dev-nexus-pharo-verify"],
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
          "dev-nexus-pharo",
          "gui-adjacent",
        ],
        allowedOperationClasses: ["read_only", "live_runtime"],
        commandProfileRefs: ["dev-nexus-pharo-live-runtime-smoke"],
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
