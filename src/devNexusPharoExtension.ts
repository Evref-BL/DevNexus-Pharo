import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultCoreSkillPack,
  type NexusExtension,
} from "dev-nexus";
import {
  type NexusProjectConfig,
} from "./config.js";
import type {
  NexusProjectStatusExtensionContribution,
} from "./nexusProjectService.js";
import { devNexusPharoSkillPack } from "./devNexusPharoSkillPack.js";
import {
  clonePlexusImageExecutionPolicy,
  defaultPlexusImageExecutionPolicy,
  resolvePlexusImageExecutionPolicy,
  type PlexusImageExecutionPolicy,
} from "./plexusImageExecutionPolicy.js";

export { devNexusPharoSkillPack } from "./devNexusPharoSkillPack.js";
export {
  defaultPlexusImageExecutionPolicy,
  resolvePlexusImageExecutionPolicy,
  type PlexusImageExecutionDockerNetwork,
  type PlexusImageExecutionDockerPolicy,
  type PlexusImageExecutionMode,
  type PlexusImageExecutionPolicy,
} from "./plexusImageExecutionPolicy.js";

export interface PlexusProjectConfig {
  id: string;
  name: string;
  images: unknown[];
  imageExecution: PlexusImageExecutionPolicy;
  runtime: PlexusProjectRuntimeConfig;
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

export interface DevNexusPharoProjectFiles {
  agentsPath: string;
  suggestedFirstPromptPath: string;
  plexusProjectConfigPath: string;
  plexusProjectConfig: PlexusProjectConfig;
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
  reservedGatewayPorts?: readonly number[];
}

const suggestedFirstPromptFileName = "suggestedFirstPrompt.md";

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
          imageExecutionPolicy,
          options.reservedGatewayPorts ?? [],
        )
    : buildPlexusProjectConfig(
        options.projectConfig.name,
        options.projectConfig.id,
        imageExecutionPolicy,
        options.reservedGatewayPorts ?? [],
      );

  if (!existingPlexusProjectConfig) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
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
  installProjectFiles: ({ projectRoot, projectConfig }) => {
    return installDevNexusPharoProjectFiles({
      projectRoot,
      projectConfig,
    });
  },
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

export function devNexusPharoProjectFilesFromExtensionResult(
  value: unknown,
): DevNexusPharoProjectFiles {
  if (!value || typeof value !== "object") {
    throw new Error("DevNexus-Pharo extension did not produce project files");
  }

  return value as DevNexusPharoProjectFiles;
}
