export type DevNexusPharoHostCapabilityTag =
  | "pharo"
  | "pharo-launcher"
  | "plexus"
  | "mcp"
  | "gui-adjacent";

export type DevNexusPharoStaticProbeStatus =
  | "present"
  | "missing"
  | "unknown";

export type DevNexusPharoStaticProbeEffect = "none";

export type DevNexusPharoCommandProbeName =
  | "pharo"
  | "plexus"
  | "plexus-gateway";

export type DevNexusPharoMcpServerProbeName =
  | "plexus_project"
  | "pharo_launcher"
  | "route_control"
  | "pharo_gateway";

export type DevNexusPharoRunnerOperationClass =
  | "read_only"
  | "verification"
  | "project_local_mutation"
  | "live_runtime"
  | "destructive";

export type DevNexusPharoRunnerMutationClass =
  | "none"
  | "verification"
  | "project_local"
  | "live_runtime"
  | "destructive";

export type DevNexusPharoRunnerArtifactRetentionMode =
  | "none"
  | "summary"
  | "logs"
  | "artifacts";

export type DevNexusPharoRunnerCredentialIdentityKind =
  | "none"
  | "host"
  | "automation"
  | "manual";

export interface DevNexusPharoStaticHostProbeFacts {
  commands?: Partial<Record<DevNexusPharoCommandProbeName, boolean>>;
  mcpServers?: Partial<Record<DevNexusPharoMcpServerProbeName, boolean>>;
  pharoLauncherInstalled?: boolean;
  guiAdjacentAvailable?: boolean;
}

export interface DevNexusPharoStaticHostCapabilityProbe {
  id: string;
  capability: DevNexusPharoHostCapabilityTag;
  status: DevNexusPharoStaticProbeStatus;
  effect: DevNexusPharoStaticProbeEffect;
  nextAction: string;
}

export interface DevNexusPharoStaticHostCapabilityResult {
  mode: "static-read-only";
  presentCapabilities: DevNexusPharoHostCapabilityTag[];
  missingCapabilities: DevNexusPharoHostCapabilityTag[];
  unknownCapabilities: DevNexusPharoHostCapabilityTag[];
  probes: DevNexusPharoStaticHostCapabilityProbe[];
}

export interface DevNexusPharoRunnerProfileTemplate {
  id: string;
  name: string;
  requiredCapabilities: DevNexusPharoHostCapabilityTag[];
  allowedOperationClasses: DevNexusPharoRunnerOperationClass[];
  commandProfileRefs: string[];
  mutationClass: DevNexusPharoRunnerMutationClass;
  artifactRetention: {
    mode: DevNexusPharoRunnerArtifactRetentionMode;
    ttlDays: number | null;
  };
  limits: {
    timeoutMs: number;
    outputLineLimit: number;
    outputByteLimit: number;
  };
  credentialIdentity: {
    kind: DevNexusPharoRunnerCredentialIdentityKind;
  };
  approval: {
    required: boolean;
    policyGateIds: string[];
    approvalRef: string | null;
    reason: string | null;
  };
  enabled: boolean;
}

export const devNexusPharoHostCapabilityTags: DevNexusPharoHostCapabilityTag[] = [
  "pharo",
  "pharo-launcher",
  "plexus",
  "mcp",
  "gui-adjacent",
];

const capabilityDescriptions: Record<DevNexusPharoHostCapabilityTag, string> = {
  pharo: "Pharo command-line tooling is visible to the host.",
  "pharo-launcher": "Pharo Launcher is installed for image lifecycle work.",
  plexus: "PLexus tooling is visible to the host.",
  mcp: "PLexus-owned MCP surfaces are configured for the worker.",
  "gui-adjacent":
    "The host can perform GUI-adjacent setup checks when explicitly approved.",
};

const capabilityProbeIds: Record<DevNexusPharoHostCapabilityTag, string[]> = {
  pharo: ["command:pharo"],
  "pharo-launcher": ["pharo-launcher:installation"],
  plexus: ["command:plexus", "command:plexus-gateway"],
  mcp: [
    "mcp-config:plexus_project",
    "mcp-config:pharo_launcher",
    "mcp-config:route_control",
    "mcp-config:pharo_gateway",
  ],
  "gui-adjacent": ["host:gui-adjacent"],
};

export const devNexusPharoCapabilityDescriptors = devNexusPharoHostCapabilityTags.map(
  (capability) => ({
    capability,
    description: capabilityDescriptions[capability],
    staticProbeIds: capabilityProbeIds[capability],
  }),
);

export const devNexusPharoRunnerProfileTemplates: DevNexusPharoRunnerProfileTemplate[] = [
  runnerProfileTemplate({
    id: "pharo-read-only-status",
    name: "Pharo Read-Only Status",
    requiredCapabilities: ["pharo"],
    allowedOperationClasses: ["read_only"],
    commandProfileRefs: ["pharo-status"],
    mutationClass: "none",
  }),
  runnerProfileTemplate({
    id: "pharo-mcp-tool-list",
    name: "Pharo MCP Tool List",
    requiredCapabilities: ["mcp", "plexus"],
    allowedOperationClasses: ["read_only"],
    commandProfileRefs: ["plexus-mcp-tool-list"],
    mutationClass: "none",
  }),
  runnerProfileTemplate({
    id: "pharo-verification",
    name: "Pharo Verification",
    requiredCapabilities: ["pharo", "pharo-launcher", "plexus", "mcp"],
    allowedOperationClasses: ["read_only", "verification"],
    commandProfileRefs: ["pharo-verify"],
    mutationClass: "verification",
    artifactRetention: { mode: "logs", ttlDays: 7 },
    limits: {
      timeoutMs: 300_000,
      outputLineLimit: 2_000,
      outputByteLimit: 1_000_000,
    },
  }),
  runnerProfileTemplate({
    id: "pharo-live-runtime",
    name: "Pharo Live Runtime",
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
    artifactRetention: { mode: "artifacts", ttlDays: 30 },
    approval: {
      required: true,
      policyGateIds: ["runner.dev-nexus-pharo.live-runtime.approved"],
      approvalRef: null,
      reason:
        "Live Pharo image, PLexus route, Docker, or GUI-adjacent runtime work requires an explicit bounded runner approval.",
    },
  }),
];

export function evaluateDevNexusPharoStaticHostCapabilities(
  facts: DevNexusPharoStaticHostProbeFacts,
): DevNexusPharoStaticHostCapabilityResult {
  const probes = [
    commandProbe("pharo", "pharo", facts.commands?.pharo),
    commandProbe("plexus", "plexus", facts.commands?.plexus),
    commandProbe("plexus-gateway", "plexus", facts.commands?.["plexus-gateway"]),
    mcpProbe("plexus_project", facts.mcpServers?.plexus_project),
    mcpProbe("pharo_launcher", facts.mcpServers?.pharo_launcher),
    mcpProbe("route_control", facts.mcpServers?.route_control),
    mcpProbe("pharo_gateway", facts.mcpServers?.pharo_gateway),
    booleanProbe({
      id: "pharo-launcher:installation",
      capability: "pharo-launcher",
      value: facts.pharoLauncherInstalled,
      presentAction: "Pharo Launcher installation was reported present.",
      missingAction: "Install or expose Pharo Launcher before image lifecycle work.",
      unknownAction: "Configure the static Pharo Launcher installation probe.",
    }),
    booleanProbe({
      id: "host:gui-adjacent",
      capability: "gui-adjacent",
      value: facts.guiAdjacentAvailable,
      presentAction: "GUI-adjacent automation was explicitly reported available.",
      missingAction:
        "Use a host or runner profile that allows GUI-adjacent automation.",
      unknownAction: "Configure the static GUI-adjacent capability probe.",
    }),
  ];

  return {
    mode: "static-read-only",
    presentCapabilities: capabilitiesWithStatus(probes, "present"),
    missingCapabilities: capabilitiesWithStatus(probes, "missing"),
    unknownCapabilities: capabilitiesWithStatus(probes, "unknown"),
    probes,
  };
}

function commandProbe(
  command: DevNexusPharoCommandProbeName,
  capability: DevNexusPharoHostCapabilityTag,
  value: boolean | undefined,
): DevNexusPharoStaticHostCapabilityProbe {
  return booleanProbe({
    id: `command:${command}`,
    capability,
    value,
    presentAction: `${command} command is visible to the host.`,
    missingAction: `Install or expose ${command} before selecting this host.`,
    unknownAction: `Configure the static command probe for ${command}.`,
  });
}

function mcpProbe(
  serverName: DevNexusPharoMcpServerProbeName,
  value: boolean | undefined,
): DevNexusPharoStaticHostCapabilityProbe {
  return booleanProbe({
    id: `mcp-config:${serverName}`,
    capability: "mcp",
    value,
    presentAction: `${serverName} MCP server is configured.`,
    missingAction: `Project the PLexus-owned ${serverName} MCP server before MCP work.`,
    unknownAction: `Configure the static MCP probe for ${serverName}.`,
  });
}

function booleanProbe(options: {
  id: string;
  capability: DevNexusPharoHostCapabilityTag;
  value: boolean | undefined;
  presentAction: string;
  missingAction: string;
  unknownAction: string;
}): DevNexusPharoStaticHostCapabilityProbe {
  const status =
    options.value === undefined
      ? "unknown"
      : options.value
        ? "present"
        : "missing";

  return {
    id: options.id,
    capability: options.capability,
    status,
    effect: "none",
    nextAction:
      status === "present"
        ? options.presentAction
        : status === "missing"
          ? options.missingAction
          : options.unknownAction,
  };
}

function capabilitiesWithStatus(
  probes: DevNexusPharoStaticHostCapabilityProbe[],
  status: DevNexusPharoStaticProbeStatus,
): DevNexusPharoHostCapabilityTag[] {
  return devNexusPharoHostCapabilityTags.filter((capability) => {
    const relevantProbes = probes.filter((probe) => probe.capability === capability);
    if (relevantProbes.length === 0) {
      return status === "unknown";
    }

    if (status === "present") {
      return relevantProbes.some((probe) => probe.status === "present");
    }

    if (status === "missing") {
      return (
        relevantProbes.every((probe) => probe.status !== "present") &&
        relevantProbes.some((probe) => probe.status === "missing")
      );
    }

    return relevantProbes.every((probe) => probe.status === "unknown");
  });
}

function runnerProfileTemplate(
  profile: Omit<
    DevNexusPharoRunnerProfileTemplate,
    "enabled" | "limits" | "artifactRetention" | "credentialIdentity" | "approval"
  > &
    Partial<
      Pick<
        DevNexusPharoRunnerProfileTemplate,
        "limits" | "artifactRetention" | "credentialIdentity" | "approval"
      >
    >,
): DevNexusPharoRunnerProfileTemplate {
  return {
    enabled: true,
    limits: {
      timeoutMs: 120_000,
      outputLineLimit: 1_000,
      outputByteLimit: 500_000,
      ...profile.limits,
    },
    artifactRetention: {
      mode: "summary",
      ttlDays: 1,
      ...profile.artifactRetention,
    },
    credentialIdentity: {
      kind: "none",
      ...profile.credentialIdentity,
    },
    approval: {
      required: false,
      policyGateIds: [],
      approvalRef: null,
      reason: null,
      ...profile.approval,
    },
    ...profile,
  };
}

export default devNexusPharoHostCapabilityTags;
