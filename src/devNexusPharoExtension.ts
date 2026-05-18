import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultCoreSkillPack,
  type NexusExtension,
  type NexusSkillDefinition,
} from "dev-nexus";
import {
  type NexusProjectConfig,
} from "./config.js";
import { mcpPharoDomainSkillPack } from "./mcpPharoDomainSkills.js";
import type {
  NexusProjectStatusExtensionContribution,
} from "./nexusProjectService.js";

export interface PlexusProjectConfig {
  name: string;
  kanban: {
    provider: "vibe-kanban";
    projectId: string;
  };
  images: unknown[];
  imageExecution: PlexusImageExecutionPolicy;
  runtime: PlexusProjectRuntimeConfig;
}

export interface PlexusProjectRuntimeConfig {
  gateway: PlexusProjectGatewayConfig;
}

export interface PlexusProjectGatewayConfig {
  mode: "project-local";
  host: string;
  port: number;
  agentMcpPath: string;
  routeControlMcpPath: string;
}

export interface DevNexusPharoProjectFiles {
  agentsPath: string;
  suggestedFirstPromptPath: string;
  plexusProjectConfigPath: string;
  plexusProjectConfig: PlexusProjectConfig;
}

export const plexusProjectConfigFileName = "plexus.project.json";
export const devNexusPharoProjectExtensionConfigKey = "dev-nexus-pharo";
export const defaultPlexusGatewayHost = "127.0.0.1";
export const defaultPlexusGatewayAgentPath = "/mcp";
export const defaultPlexusGatewayRouteControlPath = "/control-mcp";
export const defaultPlexusProjectGatewayPortBase = 17_340;
export const defaultPlexusProjectGatewayPortSpan = 1_000;

export type PlexusImageExecutionMode = "disabled" | "docker";
export type PlexusImageExecutionDockerNetwork = "none" | "bridge";

export interface PlexusImageExecutionDockerPolicy {
  image: string | null;
  network: PlexusImageExecutionDockerNetwork;
  autoRemove: boolean;
  mountProjectReadOnly: boolean;
}

export interface PlexusImageExecutionPolicy {
  mode: PlexusImageExecutionMode;
  requireDisposableImage: boolean;
  requireCleanupPlan: boolean;
  docker: PlexusImageExecutionDockerPolicy;
}

export const defaultPlexusImageExecutionPolicy: PlexusImageExecutionPolicy = {
  mode: "disabled",
  requireDisposableImage: true,
  requireCleanupPlan: true,
  docker: {
    image: null,
    network: "none",
    autoRemove: true,
    mountProjectReadOnly: true,
  },
};

export interface DevNexusPharoProjectExtensionConfig {
  plexusProjectConfig?: string;
  imageExecution?: PlexusImageExecutionPolicy;
}

export function devNexusPharoProjectExtensionEntry(
  config: DevNexusPharoProjectExtensionConfig = {},
): Record<typeof devNexusPharoProjectExtensionConfigKey, Record<string, unknown>> {
  return {
    [devNexusPharoProjectExtensionConfigKey]: { ...config },
  };
}

export function projectUsesDevNexusPharoExtension(
  projectConfig: Pick<NexusProjectConfig, "extensions"> | undefined,
): boolean {
  return Boolean(
    projectConfig?.extensions?.[devNexusPharoProjectExtensionConfigKey],
  );
}

export interface InstallDevNexusPharoProjectFilesOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  vibeKanbanProjectId?: string | null;
  reservedGatewayPorts?: readonly number[];
}

const suggestedFirstPromptFileName = "suggestedFirstPrompt.md";

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
    "Workflow guidance for DevNexus-Pharo-managed projects, boards, worktrees, and publication decisions.",
    `
# DevNexus-Pharo Workflow

Use this skill when working inside a DevNexus-Pharo-managed project.

1. Identify whether the request belongs to the control project or an owning source project.
2. Read local AGENTS.md, NOTES.md, and the project config before changing files.
3. Use provider-neutral project and work-item tools where possible.
4. Confirm direct \`pharo\` MCP tools are available before changing Pharo code; if not, report the MCP infrastructure blocker instead of editing Pharo files.
5. Keep Vibe Kanban as tracker context only unless a task explicitly asks for Vibe diagnostics.
6. Verify focused behavior before broader checks, then record commits and publication state.
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
2. Use disposable image copies for smoke probes when available.
3. Record image identity, filesystem paths, processes, and cleanup commands.
4. Stop and report a blocker if cleanup or ownership is unclear.
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
3. Keep routed calls non-mutating until an isolated image boundary is explicit.
4. Capture request shape, response payload, route id, and owning project.
5. Add regression coverage at the lowest layer that owns the failure.
`,
  ),
  ...mcpPharoDomainSkillPack,
];

function packageRootPath(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function defaultAgentsTemplatePath(): string {
  return path.join(packageRootPath(), "AGENTS.md");
}

export function projectAgentsPath(projectRoot: string): string {
  return path.join(projectRoot, "AGENTS.md");
}

export function projectSuggestedFirstPromptPath(projectRoot: string): string {
  return path.join(projectRoot, suggestedFirstPromptFileName);
}

function saveJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "")) as T;
}

function resolveFromProject(projectRootPath: string, value: string): string {
  return path.resolve(projectRootPath, value);
}

export function devNexusPharoProjectExtensionConfig(
  projectConfig: Pick<NexusProjectConfig, "extensions">,
): DevNexusPharoProjectExtensionConfig {
  const value = projectConfig.extensions?.[devNexusPharoProjectExtensionConfigKey];
  if (value === undefined) {
    return {};
  }

  const plexusProjectConfig = value.plexusProjectConfig;
  if (
    plexusProjectConfig !== undefined &&
    typeof plexusProjectConfig !== "string"
  ) {
    throw new Error(
      `extensions.${devNexusPharoProjectExtensionConfigKey}.plexusProjectConfig must be a string`,
    );
  }
  const imageExecution =
    value.imageExecution === undefined
      ? undefined
      : resolvePlexusImageExecutionPolicy(
          value.imageExecution,
          `extensions.${devNexusPharoProjectExtensionConfigKey}.imageExecution`,
        );

  return {
    ...(plexusProjectConfig ? { plexusProjectConfig } : {}),
    ...(imageExecution ? { imageExecution } : {}),
  };
}

export function projectPlexusImageExecutionPolicy(
  config?: Pick<NexusProjectConfig, "extensions">,
): PlexusImageExecutionPolicy {
  if (!config) {
    return clonePlexusImageExecutionPolicy(defaultPlexusImageExecutionPolicy);
  }

  return (
    devNexusPharoProjectExtensionConfig(config).imageExecution ??
    clonePlexusImageExecutionPolicy(defaultPlexusImageExecutionPolicy)
  );
}

export function resolvePlexusImageExecutionPolicy(
  value: unknown,
  pathName = "imageExecution",
): PlexusImageExecutionPolicy {
  const record = value === undefined ? {} : assertRecord(value, pathName);
  const dockerRecord =
    record.docker === undefined
      ? {}
      : assertRecord(record.docker, `${pathName}.docker`);
  const mode = imageExecutionMode(
    record.mode,
    `${pathName}.mode`,
    defaultPlexusImageExecutionPolicy.mode,
  );
  const docker = {
    image:
      nullableString(dockerRecord.image, `${pathName}.docker.image`) ??
      defaultPlexusImageExecutionPolicy.docker.image,
    network: dockerNetwork(
      dockerRecord.network,
      `${pathName}.docker.network`,
      defaultPlexusImageExecutionPolicy.docker.network,
    ),
    autoRemove:
      optionalBoolean(dockerRecord.autoRemove, `${pathName}.docker.autoRemove`) ??
      defaultPlexusImageExecutionPolicy.docker.autoRemove,
    mountProjectReadOnly:
      optionalBoolean(
        dockerRecord.mountProjectReadOnly,
        `${pathName}.docker.mountProjectReadOnly`,
      ) ?? defaultPlexusImageExecutionPolicy.docker.mountProjectReadOnly,
  };

  if (mode === "docker" && !docker.image) {
    throw new Error(`${pathName}.docker.image is required when mode is docker`);
  }

  return {
    mode,
    requireDisposableImage:
      optionalBoolean(
        record.requireDisposableImage,
        `${pathName}.requireDisposableImage`,
      ) ?? defaultPlexusImageExecutionPolicy.requireDisposableImage,
    requireCleanupPlan:
      optionalBoolean(record.requireCleanupPlan, `${pathName}.requireCleanupPlan`) ??
      defaultPlexusImageExecutionPolicy.requireCleanupPlan,
    docker,
  };
}

export function projectPlexusConfigPath(
  projectRootPath: string,
  config?: Pick<NexusProjectConfig, "extensions">,
): string {
  const extensionConfig = config
    ? devNexusPharoProjectExtensionConfig(config)
    : {};
  return resolveFromProject(
    projectRootPath,
    extensionConfig.plexusProjectConfig ?? plexusProjectConfigFileName,
  );
}

function installDefaultAgentsFile(projectRoot: string): string {
  const agentsPath = projectAgentsPath(projectRoot);
  if (fs.existsSync(agentsPath)) {
    return agentsPath;
  }

  const templatePath = defaultAgentsTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Default AGENTS.md template is missing: ${templatePath}`);
  }

  fs.copyFileSync(templatePath, agentsPath);
  return agentsPath;
}

function resolveProjectSourceRoot(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  const sourceRoot = projectConfig.repo.sourceRoot;
  if (!sourceRoot) {
    return path.resolve(projectRoot);
  }

  return path.isAbsolute(sourceRoot)
    ? path.resolve(sourceRoot)
    : path.resolve(projectRoot, sourceRoot);
}

function formatPromptValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "(not known yet)";
}

function buildSuggestedFirstPrompt(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  const sourceRoot = resolveProjectSourceRoot(projectRoot, projectConfig);
  const kanbanProjectId = projectConfig.kanban?.projectId ?? null;
  const genericSkills = defaultCoreSkillPack
    .map((skill) => skill.manifest.id)
    .join(", ");
  const specializationSkills = devNexusPharoSkillPack
    .map((skill) => skill.manifest.id)
    .join(", ");

  return [
    `This is a Codex and DevNexus-Pharo project for ${projectConfig.name}.`,
    "",
    "Use the local AGENTS.md as the workflow contract. Then make this local project yours:",
    "",
    `- Inspect the DevNexus-Pharo project root at ${projectRoot}.`,
    `- Inspect the source checkout at ${sourceRoot}.`,
    "- Check the configured work tracker and current issues with the available DevNexus-Pharo tools.",
    "- Record durable local context in NOTES.md, including tracker ids and any source/workflow details future agents should know.",
    "- Edit AGENTS.md only when this project needs workflow guidance beyond the default DevNexus-Pharo contract.",
    `- Use installed support skills under ${path.join(projectRoot, ".dev-nexus", "skills")} when relevant; generic skills: ${genericSkills}; DevNexus-Pharo skills: ${specializationSkills}.`,
    "- When changes are complete and verified, commit them in the relevant source repository unless the user explicitly asks not to. Push only when requested or when project instructions say to publish.",
    "",
    "Known at prompt generation time:",
    "",
    `- DevNexus-Pharo project id: ${projectConfig.id}`,
    `- Legacy Vibe Kanban project id: ${formatPromptValue(kanbanProjectId)}`,
    `- Source remote: ${formatPromptValue(projectConfig.repo.remoteUrl)}`,
    `- Default branch: ${formatPromptValue(projectConfig.repo.defaultBranch)}`,
    "",
  ].join("\n");
}

function installSuggestedFirstPrompt(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  const suggestedFirstPromptPath = projectSuggestedFirstPromptPath(projectRoot);
  if (fs.existsSync(suggestedFirstPromptPath)) {
    return suggestedFirstPromptPath;
  }

  fs.writeFileSync(
    suggestedFirstPromptPath,
    buildSuggestedFirstPrompt(projectRoot, projectConfig),
    "utf8",
  );
  return suggestedFirstPromptPath;
}

export function buildPlexusProjectConfig(
  name: string,
  projectId: string,
  vibeKanbanProjectId: string | null = null,
  imageExecutionPolicy: PlexusImageExecutionPolicy =
    defaultPlexusImageExecutionPolicy,
  reservedGatewayPorts: readonly number[] = [],
): PlexusProjectConfig {
  return {
    name,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId ?? projectId,
    },
    images: [],
    imageExecution: clonePlexusImageExecutionPolicy(imageExecutionPolicy),
    runtime: {
      gateway: buildPlexusProjectGatewayConfig(projectId, reservedGatewayPorts),
    },
  };
}

export function buildPlexusProjectGatewayConfig(
  projectId: string,
  reservedPorts: readonly number[] = [],
): PlexusProjectGatewayConfig {
  return {
    mode: "project-local",
    host: defaultPlexusGatewayHost,
    port: allocatePlexusProjectGatewayPort(projectId, reservedPorts),
    agentMcpPath: defaultPlexusGatewayAgentPath,
    routeControlMcpPath: defaultPlexusGatewayRouteControlPath,
  };
}

export function allocatePlexusProjectGatewayPort(
  projectId: string,
  reservedPorts: readonly number[] = [],
): number {
  const reserved = new Set(reservedPorts);
  const start =
    defaultPlexusProjectGatewayPortBase +
    (stableHash(projectId) % defaultPlexusProjectGatewayPortSpan);
  for (let offset = 0; offset < defaultPlexusProjectGatewayPortSpan; offset += 1) {
    const candidate =
      defaultPlexusProjectGatewayPortBase +
      ((start - defaultPlexusProjectGatewayPortBase + offset) %
        defaultPlexusProjectGatewayPortSpan);
    if (!reserved.has(candidate)) {
      return candidate;
    }
  }

  throw new Error("No project-local PLexus gateway port is available in the configured policy range");
}

function stableHash(value: string): number {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function normalizeGatewayPath(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function maybeExistingGateway(
  value: Record<string, unknown>,
): PlexusProjectGatewayConfig | undefined {
  const runtime = value.runtime;
  if (!runtime || typeof runtime !== "object" || Array.isArray(runtime)) {
    return undefined;
  }
  const gateway = (runtime as Record<string, unknown>).gateway;
  if (!gateway || typeof gateway !== "object" || Array.isArray(gateway)) {
    return undefined;
  }
  const record = gateway as Record<string, unknown>;
  const port = record.port;
  if (
    typeof port !== "number" ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    return undefined;
  }

  return {
    mode: "project-local",
    host:
      typeof record.host === "string" && record.host.trim().length > 0
        ? record.host.trim()
        : defaultPlexusGatewayHost,
    port,
    agentMcpPath: normalizeGatewayPath(
      record.agentMcpPath ?? record.agentPath,
      defaultPlexusGatewayAgentPath,
    ),
    routeControlMcpPath: normalizeGatewayPath(
      record.routeControlMcpPath ?? record.routeControlPath,
      defaultPlexusGatewayRouteControlPath,
    ),
  };
}

export function normalizePlexusProjectConfig(
  existing: Record<string, unknown>,
  projectName: string,
  projectId: string,
  vibeKanbanProjectId: string | null,
  imageExecutionPolicy: PlexusImageExecutionPolicy =
    defaultPlexusImageExecutionPolicy,
  reservedGatewayPorts: readonly number[] = [],
): PlexusProjectConfig {
  const existingKanban =
    existing.kanban && typeof existing.kanban === "object" && !Array.isArray(existing.kanban)
      ? (existing.kanban as Record<string, unknown>)
      : {};
  const gateway = maybeExistingGateway(existing);
  if (gateway && reservedGatewayPorts.includes(gateway.port)) {
    throw new Error(
      `PLexus project gateway port ${gateway.port} is already reserved by another project`,
    );
  }

  return {
    ...existing,
    name: typeof existing.name === "string" ? existing.name : projectName,
    kanban: {
      ...existingKanban,
      provider: "vibe-kanban",
      projectId:
        vibeKanbanProjectId ??
        (typeof existingKanban.projectId === "string"
          ? existingKanban.projectId
          : projectId),
    },
    images: Array.isArray(existing.images) ? existing.images : [],
    imageExecution:
      existing.imageExecution === undefined
        ? clonePlexusImageExecutionPolicy(imageExecutionPolicy)
        : resolvePlexusImageExecutionPolicy(
            existing.imageExecution,
            "plexus.project.imageExecution",
          ),
    runtime: {
      gateway:
        gateway ??
        buildPlexusProjectGatewayConfig(projectId, reservedGatewayPorts),
    },
  } as PlexusProjectConfig;
}

export function updatePlexusProjectKanban(
  plexusConfigPath: string,
  projectName: string,
  projectId: string,
  vibeKanbanProjectId: string,
  imageExecutionPolicy: PlexusImageExecutionPolicy =
    defaultPlexusImageExecutionPolicy,
): PlexusProjectConfig {
  const existing = fs.existsSync(plexusConfigPath)
    ? readJsonFile<Record<string, unknown>>(plexusConfigPath)
    : (buildPlexusProjectConfig(
        projectName,
        projectId,
        vibeKanbanProjectId,
        imageExecutionPolicy,
        [],
      ) as unknown as Record<string, unknown>);
  const updated = normalizePlexusProjectConfig(
    existing,
    projectName,
    projectId,
    vibeKanbanProjectId,
    imageExecutionPolicy,
  );

  saveJsonFile(plexusConfigPath, updated);
  return updated;
}

export function installDevNexusPharoProjectFiles(
  options: InstallDevNexusPharoProjectFilesOptions,
): DevNexusPharoProjectFiles {
  const plexusConfigPath = projectPlexusConfigPath(
    options.projectRoot,
    options.projectConfig,
  );
  const imageExecutionPolicy = projectPlexusImageExecutionPolicy(
    options.projectConfig,
  );
  const existingPlexusProjectConfig = fs.existsSync(plexusConfigPath)
    ? readJsonFile<Record<string, unknown>>(plexusConfigPath)
    : null;
  let plexusProjectConfig = existingPlexusProjectConfig
    ? normalizePlexusProjectConfig(
        existingPlexusProjectConfig,
        options.projectConfig.name,
        options.projectConfig.id,
        options.vibeKanbanProjectId ?? options.projectConfig.kanban?.projectId ?? null,
        imageExecutionPolicy,
        options.reservedGatewayPorts ?? [],
      )
    : buildPlexusProjectConfig(
        options.projectConfig.name,
        options.projectConfig.id,
        options.vibeKanbanProjectId ?? options.projectConfig.kanban?.projectId ?? null,
        imageExecutionPolicy,
        options.reservedGatewayPorts ?? [],
      );

  if (!existingPlexusProjectConfig) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
  } else if (options.vibeKanbanProjectId) {
    plexusProjectConfig = updatePlexusProjectKanban(
      plexusConfigPath,
      options.projectConfig.name,
      options.projectConfig.id,
      options.vibeKanbanProjectId,
      imageExecutionPolicy,
    );
  } else if (
    existingPlexusProjectConfig.imageExecution === undefined ||
    existingPlexusProjectConfig.runtime === undefined
  ) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
  }

  return {
    agentsPath: installDefaultAgentsFile(options.projectRoot),
    suggestedFirstPromptPath: installSuggestedFirstPrompt(
      options.projectRoot,
      options.projectConfig,
    ),
    plexusProjectConfigPath: plexusConfigPath,
    plexusProjectConfig,
  };
}

export const devNexusPharoExtension: NexusExtension<
  NexusProjectConfig,
  DevNexusPharoProjectFiles,
  NexusProjectStatusExtensionContribution | undefined
> = {
  id: "dev-nexus-pharo",
  name: "DevNexus-Pharo",
  installProjectFiles: ({ projectRoot, projectConfig }) =>
    installDevNexusPharoProjectFiles({
      projectRoot,
      projectConfig,
      vibeKanbanProjectId: projectConfig.kanban?.projectId ?? null,
    }),
  projectSkills: ({ projectConfig }) =>
    projectUsesDevNexusPharoExtension(projectConfig)
      ? [...devNexusPharoSkillPack]
      : undefined,
  projectStatus: ({ projectRoot, projectConfig }) => {
    if (!projectUsesDevNexusPharoExtension(projectConfig)) {
      return undefined;
    }

    const plexusConfigPath = projectPlexusConfigPath(projectRoot, projectConfig);
    return {
      plexusProjectConfigPath: plexusConfigPath,
      plexusProjectConfigExists: fs.existsSync(plexusConfigPath),
    };
  },
};

function clonePlexusImageExecutionPolicy(
  policy: PlexusImageExecutionPolicy,
): PlexusImageExecutionPolicy {
  return {
    mode: policy.mode,
    requireDisposableImage: policy.requireDisposableImage,
    requireCleanupPlan: policy.requireCleanupPlan,
    docker: { ...policy.docker },
  };
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function imageExecutionMode(
  value: unknown,
  pathName: string,
  fallback: PlexusImageExecutionMode,
): PlexusImageExecutionMode {
  if (value === undefined) {
    return fallback;
  }
  if (value === "disabled" || value === "docker") {
    return value;
  }

  throw new Error(`${pathName} must be disabled or docker`);
}

function dockerNetwork(
  value: unknown,
  pathName: string,
  fallback: PlexusImageExecutionDockerNetwork,
): PlexusImageExecutionDockerNetwork {
  if (value === undefined) {
    return fallback;
  }
  if (value === "none" || value === "bridge") {
    return value;
  }

  throw new Error(`${pathName} must be none or bridge`);
}

function optionalBoolean(value: unknown, pathName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`${pathName} must be a boolean`);
}

function nullableString(value: unknown, pathName: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`${pathName} must be a non-empty string or null`);
}

export function devNexusPharoProjectFilesFromExtensionResult(
  value: unknown,
): DevNexusPharoProjectFiles {
  if (!value || typeof value !== "object") {
    throw new Error("DevNexus-Pharo extension did not produce project files");
  }

  return value as DevNexusPharoProjectFiles;
}
