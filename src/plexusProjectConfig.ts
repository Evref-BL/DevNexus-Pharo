import path from "node:path";
import {
  type NexusProjectConfig,
} from "./config.js";
import {
  clonePlexusImageExecutionPolicy,
  defaultPlexusImageExecutionPolicy,
  resolvePlexusImageExecutionPolicy,
  type PlexusImageExecutionPolicy,
} from "./plexusImageExecutionPolicy.js";

export interface PlexusProjectConfig {
  id: string;
  name: string;
  images: unknown[];
  imageExecution: PlexusImageExecutionPolicy;
  runtime: PlexusProjectRuntimeConfig;
}

export type PlexusRepositoryWorkspaceMaterializationStrategy =
  | "copy"
  | "git-worktree"
  | "clone";

export interface PlexusRepositoryIdentityConfig {
  id: string;
  componentId?: string;
  remoteUrl?: string;
  originPath?: string;
}

export interface PlexusRepositoryWorkspaceMaterializationConfig {
  strategy: PlexusRepositoryWorkspaceMaterializationStrategy;
  path?: string;
}

export interface PlexusRepositoryWorkspaceConfig {
  repository: PlexusRepositoryIdentityConfig;
  sourceDirectory: string;
  baseline: string;
  loadGroup?: string;
  pharoVersion?: number;
  templateName?: string;
  templateCategory?: string;
  branch?: string;
  baseBranch?: string;
  baseCommit?: string;
  materialization: PlexusRepositoryWorkspaceMaterializationConfig;
}

export interface PlexusPharoImageProfile {
  id: string;
  imageName: string;
  active: boolean;
  mcp: {
    loadScript: string | null;
  };
  create: {
    kind: "template";
    profileId: string;
    templateName: string;
    templateCategory: string;
  };
  git: {
    transport: "https" | "ssh";
  };
  repositoryWorkspace?: PlexusRepositoryWorkspaceConfig;
}

export interface PlexusProjectRuntimeConfig {
  gateway: PlexusProjectGatewayConfig;
}

export interface PlexusProjectGatewayConfig {
  mode: "project-local";
  host: string;
  port: number;
  agentMcpServerName: string;
  agentMcpPath: string;
  routeControlMcpPath: string;
}

export interface DevNexusPharoProjectExtensionConfig {
  plexusProjectConfig?: string;
  imageExecution?: PlexusImageExecutionPolicy;
}

export const plexusProjectConfigFileName = "plexus.project.json";
export const devNexusPharoProjectExtensionConfigKey = "dev-nexus-pharo";
export const defaultPlexusGatewayHost = "127.0.0.1";
export const defaultPlexusGatewayAgentMcpServerName = "pharo_gateway";
export const defaultPlexusGatewayAgentPath = "/mcp";
export const defaultPlexusGatewayRouteControlPath = "/control-mcp";
export const defaultPlexusProjectGatewayPortBase = 17_340;
export const defaultPlexusProjectGatewayPortSpan = 1_000;
export const defaultPlexusPharoImageProfileId = "dev";
export const defaultPlexusPharoImageCreateProfileId = "pharo-13-default";
export const defaultPlexusPharoImageTemplateName = "Pharo 13.0 - 64bit";
export const defaultPlexusPharoImageTemplateCategory = "Official";

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

export function buildPlexusProjectConfig(
  name: string,
  projectId: string,
  imageExecutionPolicy: PlexusImageExecutionPolicy =
    defaultPlexusImageExecutionPolicy,
  reservedGatewayPorts: readonly number[] = [],
): PlexusProjectConfig {
  return {
    id: projectId,
    name,
    images: [],
    imageExecution: clonePlexusImageExecutionPolicy(imageExecutionPolicy),
    runtime: {
      gateway: buildPlexusProjectGatewayConfig(projectId, reservedGatewayPorts),
    },
  };
}

export function buildPlexusPharoImageProfile(
  projectId: string,
  options: {
    id?: string;
    loadScript?: string | null;
    gitTransport?: "https" | "ssh";
    repositoryWorkspace?: PlexusRepositoryWorkspaceConfig;
  } = {},
): PlexusPharoImageProfile {
  const id = safePlexusImageProfileId(
    options.id ?? defaultPlexusPharoImageProfileId,
  );
  return {
    id,
    imageName: `${safePlexusImageNameToken(projectId)}-{workspaceId}-${id}`,
    active: true,
    mcp: {
      loadScript: options.loadScript ?? null,
    },
    create: {
      kind: "template",
      profileId: defaultPlexusPharoImageCreateProfileId,
      templateName: defaultPlexusPharoImageTemplateName,
      templateCategory: defaultPlexusPharoImageTemplateCategory,
    },
    git: {
      transport: options.gitTransport ?? "https",
    },
    ...(options.repositoryWorkspace
      ? { repositoryWorkspace: options.repositoryWorkspace }
      : {}),
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
    agentMcpServerName: defaultPlexusGatewayAgentMcpServerName,
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

function safePlexusImageProfileId(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/gu, "-");
  const compact = safe.replace(/^-+|-+$/gu, "");
  if (compact.length === 0) {
    throw new Error("Plexus image profile id must contain at least one safe character");
  }

  return compact;
}

function safePlexusImageNameToken(value: string): string {
  const safe = value.trim().replace(/[^A-Za-z0-9_-]+/gu, "-");
  const compact = safe.replace(/^-+|-+$/gu, "");
  return compact.length > 0 ? compact : "PharoProject";
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

function normalizeGatewayServerName(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    return fallback;
  }
  return value.trim();
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
    agentMcpServerName: normalizeGatewayServerName(
      record.agentMcpServerName ?? record.agentServerName ?? record.serverName,
      defaultPlexusGatewayAgentMcpServerName,
    ),
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
  imageExecutionPolicy: PlexusImageExecutionPolicy =
    defaultPlexusImageExecutionPolicy,
  reservedGatewayPorts: readonly number[] = [],
): PlexusProjectConfig {
  const gateway = maybeExistingGateway(existing);
  if (gateway && reservedGatewayPorts.includes(gateway.port)) {
    throw new Error(
      `PLexus project gateway port ${gateway.port} is already reserved by another project`,
    );
  }
  const configuredProjectId =
    typeof existing.id === "string" && existing.id.trim().length > 0
      ? existing.id
      : projectId;

  return {
    id: configuredProjectId,
    name: typeof existing.name === "string" ? existing.name : projectName,
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
