export type DevNexusPharoHostCapabilityTag =
  | "pharo"
  | "pharo-launcher"
  | "plexus"
  | "mcp"
  | "dev-nexus-pharo"
  | "gui-adjacent";

export type DevNexusPharoStaticProbeStatus =
  | "present"
  | "missing"
  | "unknown";

export type DevNexusPharoStaticProbeEffect = "none";

export type DevNexusPharoCommandProbeName =
  | "pharo"
  | "dev-nexus-pharo"
  | "plexus-gateway";

export type DevNexusPharoMcpServerProbeName =
  | "dev_nexus_pharo"
  | "plexus_project"
  | "pharo_launcher";

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

export interface DevNexusPharoHostCapabilityProbe {
  id: string;
  capability: DevNexusPharoHostCapabilityTag;
  status: DevNexusPharoStaticProbeStatus;
  summary: string;
  nextAction: string | null;
  effect: DevNexusPharoStaticProbeEffect;
}

export interface DevNexusPharoHostCapabilityContribution {
  capability: DevNexusPharoHostCapabilityTag;
  description: string;
  staticProbeIds: string[];
}

export interface DevNexusPharoStaticHostCapabilityResult {
  mode: "static-read-only";
  presentCapabilities: DevNexusPharoHostCapabilityTag[];
  missingCapabilities: DevNexusPharoHostCapabilityTag[];
  unknownCapabilities: DevNexusPharoHostCapabilityTag[];
  probes: DevNexusPharoHostCapabilityProbe[];
}

export interface DevNexusPharoRunnerProfileLimitsTemplate {
  timeoutMs: number | null;
  outputLineLimit: number | null;
  outputByteLimit: number | null;
}

export interface DevNexusPharoRunnerArtifactRetentionTemplate {
  mode: DevNexusPharoRunnerArtifactRetentionMode;
  ttlDays: number | null;
}

export interface DevNexusPharoRunnerCredentialIdentityTemplate {
  kind: DevNexusPharoRunnerCredentialIdentityKind;
  identityRef: string | null;
}

export interface DevNexusPharoRunnerApprovalTemplate {
  required: boolean;
  policyGateIds: string[];
  approvalRef: string | null;
  reason: string | null;
}

export interface DevNexusPharoRunnerProfileTemplate {
  id: string;
  displayName: string;
  enabled: true;
  requiredCapabilities: DevNexusPharoHostCapabilityTag[];
  allowedOperationClasses: DevNexusPharoRunnerOperationClass[];
  commandProfileRefs: string[];
  limits: DevNexusPharoRunnerProfileLimitsTemplate;
  artifactRetention: DevNexusPharoRunnerArtifactRetentionTemplate;
  credentialIdentity: DevNexusPharoRunnerCredentialIdentityTemplate;
  mutationClass: DevNexusPharoRunnerMutationClass;
  approval: DevNexusPharoRunnerApprovalTemplate;
}

export const devNexusPharoHostCapabilityTags: DevNexusPharoHostCapabilityTag[] = [
  "pharo",
  "pharo-launcher",
  "plexus",
  "mcp",
  "dev-nexus-pharo",
  "gui-adjacent",
];

const readOnlyEffect: DevNexusPharoStaticProbeEffect = "none";

export const devNexusPharoHostCapabilityContributions: DevNexusPharoHostCapabilityContribution[] =
  [
    {
      capability: "pharo",
      description: "Pharo command-line tooling is visible to the host.",
      staticProbeIds: ["command:pharo"],
    },
    {
      capability: "pharo-launcher",
      description: "Pharo Launcher is installed for image lifecycle inspection.",
      staticProbeIds: ["pharo-launcher:installation"],
    },
    {
      capability: "plexus",
      description: "PLexus gateway tooling is visible to the host.",
      staticProbeIds: ["command:plexus-gateway", "mcp-config:plexus_project"],
    },
    {
      capability: "mcp",
      description: "DevNexus-Pharo, PLexus, or Pharo Launcher MCP entries are configured.",
      staticProbeIds: [
        "mcp-config:dev_nexus_pharo",
        "mcp-config:plexus_project",
        "mcp-config:pharo_launcher",
      ],
    },
    {
      capability: "dev-nexus-pharo",
      description: "DevNexus-Pharo command-line tooling is visible to the host.",
      staticProbeIds: ["command:dev-nexus-pharo"],
    },
    {
      capability: "gui-adjacent",
      description: "The host can perform GUI-adjacent setup checks when explicitly approved.",
      staticProbeIds: ["host:gui-adjacent"],
    },
  ];

export const devNexusPharoRunnerProfileTemplates: DevNexusPharoRunnerProfileTemplate[] =
  [
    runnerProfileTemplate({
      id: "pharo-read-only-status",
      displayName: "Pharo Read-Only Status",
      requiredCapabilities: ["dev-nexus-pharo"],
      allowedOperationClasses: ["read_only"],
      commandProfileRefs: ["dev-nexus-pharo-status"],
      mutationClass: "none",
    }),
    runnerProfileTemplate({
      id: "pharo-mcp-tool-list",
      displayName: "Pharo MCP Tool List",
      requiredCapabilities: ["mcp", "dev-nexus-pharo"],
      allowedOperationClasses: ["read_only"],
      commandProfileRefs: ["dev-nexus-pharo-mcp-tool-list"],
      mutationClass: "none",
    }),
    runnerProfileTemplate({
      id: "pharo-verification",
      displayName: "Pharo Verification",
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
      artifactRetention: {
        mode: "logs",
        ttlDays: 7,
      },
      limits: {
        timeoutMs: 300_000,
        outputLineLimit: 2_000,
        outputByteLimit: 1_000_000,
      },
    }),
    runnerProfileTemplate({
      id: "pharo-live-runtime",
      displayName: "Pharo Live Runtime",
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
      artifactRetention: {
        mode: "summary",
        ttlDays: 30,
      },
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
  const probes: DevNexusPharoHostCapabilityProbe[] = [
    commandProbe("pharo", "pharo", facts.commands?.pharo),
    commandProbe(
      "dev-nexus-pharo",
      "dev-nexus-pharo",
      facts.commands?.["dev-nexus-pharo"],
    ),
    commandProbe("plexus-gateway", "plexus", facts.commands?.["plexus-gateway"]),
    mcpProbe("dev_nexus_pharo", facts.mcpServers?.dev_nexus_pharo),
    mcpProbe("plexus_project", facts.mcpServers?.plexus_project),
    mcpProbe("pharo_launcher", facts.mcpServers?.pharo_launcher),
    booleanProbe({
      id: "pharo-launcher:installation",
      capability: "pharo-launcher",
      value: facts.pharoLauncherInstalled,
      presentSummary: "Pharo Launcher installation is configured.",
      missingSummary: "Pharo Launcher installation is missing.",
      unknownAction: "Configure the static Pharo Launcher installation probe.",
    }),
    booleanProbe({
      id: "host:gui-adjacent",
      capability: "gui-adjacent",
      value: facts.guiAdjacentAvailable,
      presentSummary: "GUI-adjacent host checks are available.",
      missingSummary: "GUI-adjacent host checks are unavailable.",
      unknownAction: "Configure the static GUI-adjacent host probe.",
    }),
  ];

  return {
    mode: "static-read-only",
    presentCapabilities: capabilityTagsWithStatus(probes, "present"),
    missingCapabilities: missingCapabilityTags(probes),
    unknownCapabilities: unknownCapabilityTags(probes),
    probes,
  };
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
    ...profile,
    enabled: true,
    limits: profile.limits ?? {
      timeoutMs: null,
      outputLineLimit: null,
      outputByteLimit: null,
    },
    artifactRetention: profile.artifactRetention ?? {
      mode: "none",
      ttlDays: null,
    },
    credentialIdentity: profile.credentialIdentity ?? {
      kind: "none",
      identityRef: null,
    },
    approval: profile.approval ?? {
      required: false,
      policyGateIds: [],
      approvalRef: null,
      reason: null,
    },
  };
}

function commandProbe(
  command: DevNexusPharoCommandProbeName,
  capability: DevNexusPharoHostCapabilityTag,
  value: boolean | undefined,
): DevNexusPharoHostCapabilityProbe {
  return booleanProbe({
    id: `command:${command}`,
    capability,
    value,
    presentSummary: `Found ${command} command.`,
    missingSummary: `Missing ${command} command.`,
    unknownAction: `Configure the static command probe for ${command}.`,
  });
}

function mcpProbe(
  serverName: DevNexusPharoMcpServerProbeName,
  value: boolean | undefined,
): DevNexusPharoHostCapabilityProbe {
  return booleanProbe({
    id: `mcp-config:${serverName}`,
    capability: "mcp",
    value,
    presentSummary: `Found MCP server config ${serverName}.`,
    missingSummary: `Missing MCP server config ${serverName}.`,
    unknownAction: `Configure the static MCP config probe for ${serverName}.`,
  });
}

function booleanProbe(options: {
  id: string;
  capability: DevNexusPharoHostCapabilityTag;
  value: boolean | undefined;
  presentSummary: string;
  missingSummary: string;
  unknownAction: string;
}): DevNexusPharoHostCapabilityProbe {
  if (options.value === undefined) {
    return {
      id: options.id,
      capability: options.capability,
      status: "unknown",
      summary: "Static probe fact was not provided.",
      nextAction: options.unknownAction,
      effect: readOnlyEffect,
    };
  }

  return {
    id: options.id,
    capability: options.capability,
    status: options.value ? "present" : "missing",
    summary: options.value ? options.presentSummary : options.missingSummary,
    nextAction: options.value ? null : missingNextAction(options.id),
    effect: readOnlyEffect,
  };
}

function missingNextAction(probeId: string): string {
  if (probeId.startsWith("command:")) {
    return "Install or add the command to the host-local runner path.";
  }
  if (probeId.startsWith("mcp-config:")) {
    return "Add or refresh the host-local MCP server configuration.";
  }
  if (probeId === "pharo-launcher:installation") {
    return "Install Pharo Launcher or mark this host as not supporting pharo-launcher.";
  }
  return "Mark this host as not supporting gui-adjacent checks or configure the capability.";
}

function capabilityTagsWithStatus(
  probes: readonly DevNexusPharoHostCapabilityProbe[],
  status: DevNexusPharoStaticProbeStatus,
): DevNexusPharoHostCapabilityTag[] {
  const capabilities = new Set(
    probes
      .filter((probe) => probe.status === status)
      .map((probe) => probe.capability),
  );
  return devNexusPharoHostCapabilityTags.filter((capability) =>
    capabilities.has(capability),
  );
}

function missingCapabilityTags(
  probes: readonly DevNexusPharoHostCapabilityProbe[],
): DevNexusPharoHostCapabilityTag[] {
  return devNexusPharoHostCapabilityTags.filter(
    (capability) =>
      probes.some(
        (probe) =>
          probe.capability === capability && probe.status === "missing",
      ) &&
      !probes.some(
        (probe) =>
          probe.capability === capability && probe.status === "present",
      ),
  );
}

function unknownCapabilityTags(
  probes: readonly DevNexusPharoHostCapabilityProbe[],
): DevNexusPharoHostCapabilityTag[] {
  return devNexusPharoHostCapabilityTags.filter(
    (capability) =>
      !probes.some(
        (probe) =>
          probe.capability === capability && probe.status !== "unknown",
      ),
  );
}
