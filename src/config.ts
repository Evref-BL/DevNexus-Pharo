import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type {
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  LocalWorkTrackingConfig,
  VibeKanbanWorkTrackingConfig,
  WorkTrackingBoardConfig,
  WorkTrackingConfig,
  WorkTrackingProviderName,
  WorkTrackingRepositoryConfig,
} from "./workTrackingTypes.js";

export const pharoNexusHomeConfigFileName = "pharo-nexus.home.json";
export const pharoNexusProjectConfigFileName = "pharo-nexus.project.json";
export const plexusProjectConfigFileName = "plexus.project.json";
export const pharoNexusLogsDirectoryName = "logs";
export const pharoNexusGeneratedDirectoryName = "generated";
export const pharoNexusControlProjectDirectoryName = "PharoNexus";
export const pharoNexusLegacyControlProjectDirectoryName = "control";
export const pharoNexusProjectWorktreesDirectoryName = "worktrees";
export const pharoNexusControlProjectId = "pharo-nexus-control";
export const pharoNexusControlProjectName = "PharoNexus";
export const vibeKanbanPinnedVersion = "0.1.43";
export const vibeKanbanPinnedPackage = `vibe-kanban@${vibeKanbanPinnedVersion}`;

export interface PharoNexusProjectReference {
  id: string;
  name: string;
  plexusProjectRoot: string;
  vibeKanbanProjectId?: string;
  vibeKanbanRepoId?: string;
}

export interface PharoNexusControlProjectReference {
  id: string;
  name: string;
  root: string;
  vibeKanbanProjectId: string | null;
  vibeKanbanRepoId: string | null;
}

export type PharoNexusProjectRepoKind = "local" | "git";

export interface PharoNexusProjectRepoConfig {
  kind: PharoNexusProjectRepoKind;
  remoteUrl: string | null;
  defaultBranch: string | null;
  sourceRoot?: string;
}

export interface PharoNexusAgentConfig {
  executor?: string;
  model?: string;
  reasoning?: string;
}

export interface PharoNexusProjectKanbanConfig {
  provider: "vibe-kanban";
  projectId: string | null;
}

export interface PharoNexusProjectConfig {
  version: 1;
  id: string;
  name: string;
  home: string | null;
  repo: PharoNexusProjectRepoConfig;
  plexusProjectConfig: string;
  worktreesRoot: string;
  kanban: PharoNexusProjectKanbanConfig;
  workTracking?: WorkTrackingConfig;
  agent?: PharoNexusAgentConfig;
}

export interface PharoNexusToolCommand {
  command: string;
  args: string[];
}

export type VibeKanbanBackendMode = "docker" | "dind" | "external";

export interface VibeKanbanDockerBackendConfig {
  mode: "docker";
  sharedApiBase: string;
  healthPath: string;
  sourceRepositoryUrl: string;
  autoBootstrap: boolean;
  composeCommand: string;
  composeArgs: string[];
  composeFile: string;
  envFile: string;
  projectName: string;
  workingDirectory: string;
  startOnPharoNexusStart: boolean;
  stopOnPharoNexusStop: boolean;
}

export interface VibeKanbanDindBackendConfig {
  mode: "dind";
  sharedApiBase: string;
  healthPath: string;
  sourceRepositoryUrl: string;
  sourceRoot: string;
  autoBootstrap: boolean;
  dockerCommand: string;
  dindImage: string;
  containerName: string;
  dataVolume: string;
  projectName: string;
  composeFile: string;
  envFile: string;
  workingDirectory: string;
  containerSourceRoot: string;
  containerWorkingDirectory: string;
  containerComposeFile: string;
  containerEnvFile: string;
  startOnPharoNexusStart: boolean;
  stopOnPharoNexusStop: boolean;
}

export interface VibeKanbanExternalBackendConfig {
  mode: "external";
  sharedApiBase: string;
  healthPath: string;
  startOnPharoNexusStart: boolean;
  stopOnPharoNexusStop: boolean;
}

export type VibeKanbanBackendConfig =
  | VibeKanbanDockerBackendConfig
  | VibeKanbanDindBackendConfig
  | VibeKanbanExternalBackendConfig;

export interface PharoNexusHomeConfig {
  version: 1;
  paths: {
    projectsRoot: string;
    workspacesRoot: string;
    plexusStateRoot: string;
  };
  ports: {
    vibeKanban: number;
    pharoNexusMcp: number;
    plexusMcp: number;
  };
  mcp: {
    host: string;
  };
  tools: {
    pharoNexus: PharoNexusToolCommand;
    vibeKanban: PharoNexusToolCommand;
    plexus: PharoNexusToolCommand;
  };
  integrations: {
    vibeKanban: {
      executor: string;
      pharoNexusMcpServerName: string;
      plexusMcpServerName: string;
      installMcpOnStart: boolean;
      openBrowserOnStart: boolean;
      backend: VibeKanbanBackendConfig;
    };
  };
  agent?: PharoNexusAgentConfig;
  controlProject: PharoNexusControlProjectReference;
  projects: PharoNexusProjectReference[];
}

export interface ResolvePharoNexusAgentConfigOptions {
  issue?: PharoNexusAgentConfig;
  project?: Pick<PharoNexusProjectConfig, "agent"> | PharoNexusAgentConfig;
  home?: Pick<PharoNexusHomeConfig, "agent"> | PharoNexusAgentConfig;
  fallback?: PharoNexusAgentConfig;
}

export interface CreateDefaultHomeConfigOptions {
  projectsRoot?: string;
  workspacesRoot?: string;
  plexusStateRoot?: string;
  vibeKanbanPort?: number;
  pharoNexusMcpPort?: number;
  plexusMcpPort?: number;
  mcpHost?: string;
}

export interface InitPharoNexusHomeOptions extends CreateDefaultHomeConfigOptions {
  homePath: string;
  force?: boolean;
}

export interface InitPharoNexusHomeResult {
  homePath: string;
  configPath: string;
  config: PharoNexusHomeConfig;
  controlProjectPath: string;
  controlProjectConfigPath: string;
}

export class PharoNexusConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PharoNexusConfigError";
  }
}

export function defaultPharoNexusHomePath(): string {
  return process.env.PHARO_NEXUS_HOME ?? path.join(os.homedir(), ".pharo-nexus");
}

export function defaultVibeKanbanToolCommand(): PharoNexusToolCommand {
  return {
    command: "npx",
    args: ["-y", vibeKanbanPinnedPackage],
  };
}

export function pharoNexusCliEntrypointPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const packageRoot =
    path.basename(moduleDirectory).toLowerCase() === "src" ||
    path.basename(moduleDirectory).toLowerCase() === "dist"
      ? path.dirname(moduleDirectory)
      : moduleDirectory;

  return path.join(packageRoot, "dist", "cli.js");
}

export function defaultPharoNexusToolCommand(): PharoNexusToolCommand {
  return {
    command: process.execPath,
    args: [pharoNexusCliEntrypointPath(), "mcp"],
  };
}

export function resolvePharoNexusHome(homePath: string): string {
  if (!homePath.trim()) {
    throw new PharoNexusConfigError("PharoNexus home path is required");
  }

  return path.resolve(homePath);
}

export function pharoNexusHomeConfigPath(homePath: string): string {
  return path.join(resolvePharoNexusHome(homePath), pharoNexusHomeConfigFileName);
}

export function controlProjectRootPath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    pharoNexusControlProjectDirectoryName,
  );
}

export function legacyControlProjectRootPath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    pharoNexusLegacyControlProjectDirectoryName,
  );
}

export function projectConfigPath(projectRootPath: string): string {
  return path.join(path.resolve(projectRootPath), pharoNexusProjectConfigFileName);
}

function resolveFromProject(projectRootPath: string, value: string): string {
  return path.resolve(projectRootPath, value);
}

export function projectPlexusConfigPath(
  projectRootPath: string,
  config?: Pick<PharoNexusProjectConfig, "plexusProjectConfig">,
): string {
  return resolveFromProject(
    projectRootPath,
    config?.plexusProjectConfig ?? plexusProjectConfigFileName,
  );
}

export function projectWorktreesRootPath(
  projectRootPath: string,
  config?: Pick<PharoNexusProjectConfig, "worktreesRoot">,
): string {
  return resolveFromProject(
    projectRootPath,
    config?.worktreesRoot ?? pharoNexusProjectWorktreesDirectoryName,
  );
}

export function controlProjectConfigPath(homePath: string): string {
  return projectConfigPath(controlProjectRootPath(homePath));
}

export function controlProjectWorktreesRootPath(
  homePath: string,
  controlProject?: PharoNexusControlProjectReference,
): string {
  return path.join(
    controlProject?.root ?? controlProjectRootPath(homePath),
    pharoNexusProjectWorktreesDirectoryName,
  );
}

function resolveFromHome(
  homePath: string,
  value: string | undefined,
  fallback: string,
): string {
  return path.resolve(homePath, value ?? fallback);
}

export function defaultVibeKanbanBackendConfig(
  homePath: string,
): VibeKanbanDockerBackendConfig {
  const sourceRoot = path.join(homePath, "vibe-kanban");
  const remoteRoot = path.join(sourceRoot, "crates", "remote");

  return {
    mode: "docker",
    sharedApiBase: "http://127.0.0.1:3100",
    healthPath: "/v1/health",
    sourceRepositoryUrl: "https://github.com/BloopAI/vibe-kanban.git",
    autoBootstrap: true,
    composeCommand: "auto",
    composeArgs: [],
    composeFile: path.join(remoteRoot, "docker-compose.yml"),
    envFile: path.join(remoteRoot, ".env.remote"),
    projectName: "pharo-nexus-vibe",
    workingDirectory: remoteRoot,
    startOnPharoNexusStart: true,
    stopOnPharoNexusStop: true,
  };
}

export function defaultVibeKanbanDindBackendConfig(
  homePath: string,
): VibeKanbanDindBackendConfig {
  const sourceRoot = path.join(homePath, "vibe-kanban");
  const remoteRoot = path.join(sourceRoot, "crates", "remote");
  const containerSourceRoot = "/workspace/vibe-kanban";
  const containerRemoteRoot = path.posix.join(
    containerSourceRoot,
    "crates",
    "remote",
  );

  return {
    mode: "dind",
    sharedApiBase: "http://127.0.0.1:3100",
    healthPath: "/v1/health",
    sourceRepositoryUrl: "https://github.com/BloopAI/vibe-kanban.git",
    sourceRoot,
    autoBootstrap: true,
    dockerCommand: "docker",
    dindImage: "docker:29-dind",
    containerName: "pharo-nexus-vibe-dind",
    dataVolume: "pharo-nexus-vibe-dind-data",
    projectName: "pharo-nexus-vibe",
    composeFile: path.join(remoteRoot, "docker-compose.yml"),
    envFile: path.join(remoteRoot, ".env.remote"),
    workingDirectory: remoteRoot,
    containerSourceRoot,
    containerWorkingDirectory: containerRemoteRoot,
    containerComposeFile: path.posix.join(containerRemoteRoot, "docker-compose.yml"),
    containerEnvFile: path.posix.join(containerRemoteRoot, ".env.remote"),
    startOnPharoNexusStart: true,
    stopOnPharoNexusStop: true,
  };
}

export function createDefaultHomeConfig(
  homePath: string,
  options: CreateDefaultHomeConfigOptions = {},
): PharoNexusHomeConfig {
  const resolvedHomePath = resolvePharoNexusHome(homePath);
  const config: PharoNexusHomeConfig = {
    version: 1,
    paths: {
      projectsRoot: resolveFromHome(
        resolvedHomePath,
        options.projectsRoot,
        "projects",
      ),
      workspacesRoot: resolveFromHome(
        resolvedHomePath,
        options.workspacesRoot,
        "workspaces",
      ),
      plexusStateRoot: resolveFromHome(
        resolvedHomePath,
        options.plexusStateRoot,
        path.join("state", "plexus"),
      ),
    },
    ports: {
      vibeKanban: options.vibeKanbanPort ?? 3000,
      pharoNexusMcp: options.pharoNexusMcpPort ?? 7330,
      plexusMcp: options.plexusMcpPort ?? 7331,
    },
    mcp: {
      host: options.mcpHost ?? "127.0.0.1",
    },
    tools: {
      pharoNexus: defaultPharoNexusToolCommand(),
      vibeKanban: defaultVibeKanbanToolCommand(),
      plexus: {
        command: "plexus-gateway",
        args: [],
      },
    },
    integrations: {
      vibeKanban: {
        executor: "CODEX",
        pharoNexusMcpServerName: "pharo_nexus",
        plexusMcpServerName: "plexus",
        installMcpOnStart: true,
        openBrowserOnStart: true,
        backend: defaultVibeKanbanBackendConfig(resolvedHomePath),
      },
    },
    controlProject: {
      id: pharoNexusControlProjectId,
      name: pharoNexusControlProjectName,
      root: controlProjectRootPath(resolvedHomePath),
      vibeKanbanProjectId: null,
      vibeKanbanRepoId: null,
    },
    projects: [],
  };

  return validateHomeConfig(config, resolvedHomePath);
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PharoNexusConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PharoNexusConfigError(
      `${pathName}.${key} must be a non-empty string`,
    );
  }

  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PharoNexusConfigError(
      `${pathName}.${key} must be a non-empty string`,
    );
  }

  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new PharoNexusConfigError(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new PharoNexusConfigError(
      `${pathName}.${key} must be an array of strings`,
    );
  }

  return [...value];
}

function nullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null {
  const value = record[key];
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PharoNexusConfigError(
      `${pathName}.${key} must be a non-empty string or null`,
    );
  }

  return value;
}

function validateAgentConfig(
  value: unknown,
  pathName: string,
): PharoNexusAgentConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const agent = compactAgentConfig({
    executor: optionalString(record, "executor", pathName),
    model: optionalString(record, "model", pathName),
    reasoning: optionalString(record, "reasoning", pathName),
  });
  if (Object.keys(agent).length === 0) {
    throw new PharoNexusConfigError(
      `${pathName} must define executor, model, or reasoning`,
    );
  }

  return agent;
}

function compactAgentConfig(
  config: PharoNexusAgentConfig | undefined,
): PharoNexusAgentConfig {
  const compacted: PharoNexusAgentConfig = {};
  if (config?.executor) {
    compacted.executor = config.executor;
  }
  if (config?.model) {
    compacted.model = config.model;
  }
  if (config?.reasoning) {
    compacted.reasoning = config.reasoning;
  }

  return compacted;
}

function agentConfigFromSource(
  source:
    | Pick<PharoNexusProjectConfig, "agent">
    | Pick<PharoNexusHomeConfig, "agent">
    | PharoNexusAgentConfig
    | undefined,
): PharoNexusAgentConfig {
  if (!source) {
    return {};
  }

  if (Object.prototype.hasOwnProperty.call(source, "agent")) {
    return compactAgentConfig((source as { agent?: PharoNexusAgentConfig }).agent);
  }

  return compactAgentConfig(source as PharoNexusAgentConfig);
}

export function resolvePharoNexusAgentConfig(
  options: ResolvePharoNexusAgentConfigOptions,
): PharoNexusAgentConfig {
  return compactAgentConfig({
    ...agentConfigFromSource(options.fallback),
    ...agentConfigFromSource(options.home),
    ...agentConfigFromSource(options.project),
    ...agentConfigFromSource(options.issue),
  });
}

function requiredPort(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new PharoNexusConfigError(
      `ports.${key} must be an integer between 1 and 65535`,
    );
  }

  return value;
}

function validateToolCommand(
  value: unknown,
  pathName: string,
): PharoNexusToolCommand {
  const record = assertRecord(value, pathName);
  const command = requiredString(record, "command", pathName);
  const args = record.args;

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new PharoNexusConfigError(
      `${pathName}.args must be an array of strings`,
    );
  }

  return { command, args };
}

function validateProjectReference(
  value: unknown,
  index: number,
): PharoNexusProjectReference {
  const pathName = `projects[${index}]`;
  const record = assertRecord(value, pathName);
  const vibeKanbanProjectId = optionalString(
    record,
    "vibeKanbanProjectId",
    pathName,
  );
  const vibeKanbanRepoId = optionalString(
    record,
    "vibeKanbanRepoId",
    pathName,
  );
  return {
    id: requiredString(record, "id", pathName),
    name: requiredString(record, "name", pathName),
    plexusProjectRoot: requiredString(record, "plexusProjectRoot", pathName),
    ...(vibeKanbanProjectId ? { vibeKanbanProjectId } : {}),
    ...(vibeKanbanRepoId ? { vibeKanbanRepoId } : {}),
  };
}

function defaultControlProjectReference(
  homePathForDefaults: string | undefined,
): PharoNexusControlProjectReference {
  return {
    id: pharoNexusControlProjectId,
    name: pharoNexusControlProjectName,
    root: controlProjectRootPath(homePathForDefaults ?? "."),
    vibeKanbanProjectId: null,
    vibeKanbanRepoId: null,
  };
}

function validateControlProjectReference(
  value: unknown,
  homePathForDefaults: string | undefined,
): PharoNexusControlProjectReference {
  if (value === undefined) {
    return defaultControlProjectReference(homePathForDefaults);
  }

  const record = assertRecord(value, "controlProject");
  const vibeKanbanProjectId = record.vibeKanbanProjectId;
  if (
    vibeKanbanProjectId !== undefined &&
    vibeKanbanProjectId !== null &&
    (typeof vibeKanbanProjectId !== "string" ||
      vibeKanbanProjectId.trim().length === 0)
  ) {
    throw new PharoNexusConfigError(
      "controlProject.vibeKanbanProjectId must be a non-empty string or null",
    );
  }
  const vibeKanbanRepoId = record.vibeKanbanRepoId;
  if (
    vibeKanbanRepoId !== undefined &&
    vibeKanbanRepoId !== null &&
    (typeof vibeKanbanRepoId !== "string" ||
      vibeKanbanRepoId.trim().length === 0)
  ) {
    throw new PharoNexusConfigError(
      "controlProject.vibeKanbanRepoId must be a non-empty string or null",
    );
  }

  return {
    id: requiredString(record, "id", "controlProject"),
    name: requiredString(record, "name", "controlProject"),
    root: path.resolve(
      homePathForDefaults ?? ".",
      requiredString(record, "root", "controlProject"),
    ),
    vibeKanbanProjectId:
      typeof vibeKanbanProjectId === "string" ? vibeKanbanProjectId : null,
    vibeKanbanRepoId:
      typeof vibeKanbanRepoId === "string" ? vibeKanbanRepoId : null,
  };
}

function validateKanbanConfig(value: unknown): PharoNexusProjectKanbanConfig {
  const record = assertRecord(value, "kanban");
  if (record.provider !== "vibe-kanban") {
    throw new PharoNexusConfigError("kanban.provider must be vibe-kanban");
  }

  return {
    provider: "vibe-kanban",
    projectId: nullableString(record, "projectId", "kanban"),
  };
}

function validateWorkTrackingProviderName(
  value: unknown,
): WorkTrackingProviderName {
  if (
    value === "local" ||
    value === "vibe-kanban" ||
    value === "github" ||
    value === "gitlab" ||
    value === "jira"
  ) {
    return value;
  }

  throw new PharoNexusConfigError(
    "workTracking.provider must be local, vibe-kanban, github, gitlab, or jira",
  );
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new PharoNexusConfigError(
      `${pathName}.${key} must be a non-empty string or null`,
    );
  }

  return value;
}

function optionalInteger(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new PharoNexusConfigError(`${pathName}.${key} must be an integer or null`);
  }

  return value;
}

function optionalStringRecord(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): Record<string, string> | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }

  const valueRecord = assertRecord(value, `${pathName}.${key}`);
  for (const [recordKey, recordValue] of Object.entries(valueRecord)) {
    if (typeof recordValue !== "string") {
      throw new PharoNexusConfigError(
        `${pathName}.${key}.${recordKey} must be a string`,
      );
    }
  }

  return valueRecord as Record<string, string>;
}

function validateWorkTrackingRepositoryConfig(
  value: unknown,
  pathName: string,
): WorkTrackingRepositoryConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, pathName);
  const owner = optionalString(record, "owner", pathName);
  const name = optionalString(record, "name", pathName);
  const id = optionalString(record, "id", pathName);
  const repositoryPath = optionalString(record, "path", pathName);

  return {
    ...(owner ? { owner } : {}),
    ...(name ? { name } : {}),
    ...(id ? { id } : {}),
    ...(repositoryPath ? { path: repositoryPath } : {}),
  };
}

function validateRequiredWorkTrackingRepositoryConfig(
  value: unknown,
  pathName: string,
): WorkTrackingRepositoryConfig {
  const repository = validateWorkTrackingRepositoryConfig(value, pathName);
  if (!repository) {
    throw new PharoNexusConfigError(`${pathName} must be an object`);
  }

  return repository;
}

function validateWorkTrackingBoardConfig(
  value: unknown,
): WorkTrackingBoardConfig | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const pathName = "workTracking.board";
  const record = assertRecord(value, pathName);
  const id = optionalNullableString(record, "id", pathName);
  const number = optionalInteger(record, "number", pathName);
  const owner = optionalNullableString(record, "owner", pathName);
  const ownerKind = optionalNullableString(record, "ownerKind", pathName);
  const projectId = optionalNullableString(record, "projectId", pathName);
  const statusFieldId = optionalNullableString(
    record,
    "statusFieldId",
    pathName,
  );
  const statusOptions = optionalStringRecord(record, "statusOptions", pathName);

  return {
    kind: requiredString(record, "kind", pathName),
    ...(id !== undefined ? { id } : {}),
    ...(number !== undefined ? { number } : {}),
    ...(owner !== undefined ? { owner } : {}),
    ...(ownerKind !== undefined ? { ownerKind } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(statusFieldId !== undefined ? { statusFieldId } : {}),
    ...(statusOptions ? { statusOptions } : {}),
  };
}

function validateWorkTrackingConfig(
  value: unknown,
): WorkTrackingConfig | undefined {
  if (value === undefined) {
    return undefined;
  }

  const record = assertRecord(value, "workTracking");
  const provider = validateWorkTrackingProviderName(record.provider);
  const host = optionalNullableString(record, "host", "workTracking");
  const repository = validateWorkTrackingRepositoryConfig(
    record.repository,
    "workTracking.repository",
  );
  const board = validateWorkTrackingBoardConfig(record.board);
  const common = {
    ...(host !== undefined ? { host } : {}),
    ...(repository ? { repository } : {}),
    ...(board !== undefined ? { board } : {}),
  };

  if (provider === "local") {
    const storePath = optionalNullableString(record, "storePath", "workTracking");

    return {
      provider,
      ...common,
      ...(storePath !== undefined ? { storePath } : {}),
    } satisfies LocalWorkTrackingConfig;
  }

  if (provider === "vibe-kanban") {
    const projectId = optionalNullableString(record, "projectId", "workTracking");
    const repoId = optionalNullableString(record, "repoId", "workTracking");

    return {
      provider,
      ...common,
      ...(projectId !== undefined ? { projectId } : {}),
      ...(repoId !== undefined ? { repoId } : {}),
    } satisfies VibeKanbanWorkTrackingConfig;
  }

  if (provider === "github") {
    const githubRepository = validateRequiredWorkTrackingRepositoryConfig(
      record.repository,
      "workTracking.repository",
    );
    if (!githubRepository.owner) {
      throw new PharoNexusConfigError(
        "workTracking.repository.owner must be a non-empty string",
      );
    }
    if (!githubRepository.name) {
      throw new PharoNexusConfigError(
        "workTracking.repository.name must be a non-empty string",
      );
    }

    return {
      provider,
      ...common,
      repository: {
        ...githubRepository,
        owner: githubRepository.owner,
        name: githubRepository.name,
      },
    } satisfies GitHubWorkTrackingConfig;
  }

  if (provider === "gitlab") {
    const gitlabRepository = validateRequiredWorkTrackingRepositoryConfig(
      record.repository,
      "workTracking.repository",
    );
    if (!gitlabRepository.id) {
      throw new PharoNexusConfigError(
        "workTracking.repository.id must be a non-empty string",
      );
    }

    return {
      provider,
      ...common,
      repository: {
        ...gitlabRepository,
        id: gitlabRepository.id,
      },
    } satisfies GitLabWorkTrackingConfig;
  }

  const issueType = optionalNullableString(record, "issueType", "workTracking");

  return {
    provider,
    ...common,
    projectKey: requiredString(record, "projectKey", "workTracking"),
    ...(issueType !== undefined ? { issueType } : {}),
  } satisfies JiraWorkTrackingConfig;
}

function validateRepoConfig(value: unknown): PharoNexusProjectRepoConfig {
  if (value === undefined) {
    return {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    };
  }

  const record = assertRecord(value, "repo");
  const kind = record.kind;
  if (kind !== "local" && kind !== "git") {
    throw new PharoNexusConfigError("repo.kind must be local or git");
  }
  const sourceRoot = optionalString(record, "sourceRoot", "repo");

  return {
    kind,
    remoteUrl: nullableString(record, "remoteUrl", "repo"),
    defaultBranch: nullableString(record, "defaultBranch", "repo"),
    ...(sourceRoot ? { sourceRoot } : {}),
  };
}

function resolveConfiguredPath(homePath: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(homePath, value);
}

function validateVibeKanbanBackendConfig(
  value: unknown,
  homePathForDefaults: string | undefined,
): VibeKanbanBackendConfig {
  const homePath = resolvePharoNexusHome(homePathForDefaults ?? ".");
  const defaults = defaultVibeKanbanBackendConfig(homePath);
  const dindDefaults = defaultVibeKanbanDindBackendConfig(homePath);
  if (value === undefined) {
    return defaults;
  }

  const record = assertRecord(value, "integrations.vibeKanban.backend");
  const mode = record.mode ?? defaults.mode;
  if (mode !== "docker" && mode !== "dind" && mode !== "external") {
    throw new PharoNexusConfigError(
      "integrations.vibeKanban.backend.mode must be docker, dind, or external",
    );
  }

  const pathName = "integrations.vibeKanban.backend";
  if (mode === "external") {
    return {
      mode: "external",
      sharedApiBase:
        optionalString(record, "sharedApiBase", pathName) ??
        defaults.sharedApiBase,
      healthPath:
        optionalString(record, "healthPath", pathName) ?? defaults.healthPath,
      startOnPharoNexusStart:
        optionalBoolean(record, "startOnPharoNexusStart", pathName) ?? false,
      stopOnPharoNexusStop:
        optionalBoolean(record, "stopOnPharoNexusStop", pathName) ?? false,
    };
  }

  if (mode === "dind") {
    const sourceRootValue =
      optionalString(record, "sourceRoot", pathName) ?? dindDefaults.sourceRoot;
    const sourceRoot = resolveConfiguredPath(homePath, sourceRootValue);
    const remoteRoot = path.join(sourceRoot, "crates", "remote");
    const composeFile =
      optionalString(record, "composeFile", pathName) ??
      path.join(remoteRoot, "docker-compose.yml");
    const envFile =
      optionalString(record, "envFile", pathName) ??
      path.join(remoteRoot, ".env.remote");
    const workingDirectory =
      optionalString(record, "workingDirectory", pathName) ?? remoteRoot;
    const containerSourceRoot =
      optionalString(record, "containerSourceRoot", pathName) ??
      dindDefaults.containerSourceRoot;
    const containerRemoteRoot = path.posix.join(
      containerSourceRoot.replaceAll("\\", "/"),
      "crates",
      "remote",
    );

    return {
      mode: "dind",
      sharedApiBase:
        optionalString(record, "sharedApiBase", pathName) ??
        dindDefaults.sharedApiBase,
      healthPath:
        optionalString(record, "healthPath", pathName) ??
        dindDefaults.healthPath,
      sourceRepositoryUrl:
        optionalString(record, "sourceRepositoryUrl", pathName) ??
        dindDefaults.sourceRepositoryUrl,
      sourceRoot,
      autoBootstrap:
        optionalBoolean(record, "autoBootstrap", pathName) ?? true,
      dockerCommand:
        optionalString(record, "dockerCommand", pathName) ??
        dindDefaults.dockerCommand,
      dindImage:
        optionalString(record, "dindImage", pathName) ??
        dindDefaults.dindImage,
      containerName:
        optionalString(record, "containerName", pathName) ??
        dindDefaults.containerName,
      dataVolume:
        optionalString(record, "dataVolume", pathName) ??
        dindDefaults.dataVolume,
      projectName:
        optionalString(record, "projectName", pathName) ??
        dindDefaults.projectName,
      composeFile: resolveConfiguredPath(homePath, composeFile),
      envFile: resolveConfiguredPath(homePath, envFile),
      workingDirectory: resolveConfiguredPath(homePath, workingDirectory),
      containerSourceRoot,
      containerWorkingDirectory:
        optionalString(record, "containerWorkingDirectory", pathName) ??
        containerRemoteRoot,
      containerComposeFile:
        optionalString(record, "containerComposeFile", pathName) ??
        path.posix.join(containerRemoteRoot, "docker-compose.yml"),
      containerEnvFile:
        optionalString(record, "containerEnvFile", pathName) ??
        path.posix.join(containerRemoteRoot, ".env.remote"),
      startOnPharoNexusStart:
        optionalBoolean(record, "startOnPharoNexusStart", pathName) ?? true,
      stopOnPharoNexusStop:
        optionalBoolean(record, "stopOnPharoNexusStop", pathName) ?? true,
    };
  }

  const composeFile =
    optionalString(record, "composeFile", pathName) ?? defaults.composeFile;
  const envFile =
    optionalString(record, "envFile", pathName) ?? defaults.envFile;
  const workingDirectory =
    optionalString(record, "workingDirectory", pathName) ??
    defaults.workingDirectory;

  return {
    mode: "docker",
    sharedApiBase:
      optionalString(record, "sharedApiBase", pathName) ??
      defaults.sharedApiBase,
    healthPath:
      optionalString(record, "healthPath", pathName) ?? defaults.healthPath,
    sourceRepositoryUrl:
      optionalString(record, "sourceRepositoryUrl", pathName) ??
      defaults.sourceRepositoryUrl,
    autoBootstrap:
      optionalBoolean(record, "autoBootstrap", pathName) ?? true,
    composeCommand:
      optionalString(record, "composeCommand", pathName) ??
      defaults.composeCommand,
    composeArgs:
      optionalStringArray(record, "composeArgs", pathName) ??
      defaults.composeArgs,
    composeFile: resolveConfiguredPath(homePath, composeFile),
    envFile: resolveConfiguredPath(homePath, envFile),
    projectName:
      optionalString(record, "projectName", pathName) ?? defaults.projectName,
    workingDirectory: resolveConfiguredPath(homePath, workingDirectory),
    startOnPharoNexusStart:
      optionalBoolean(record, "startOnPharoNexusStart", pathName) ?? true,
    stopOnPharoNexusStop:
      optionalBoolean(record, "stopOnPharoNexusStop", pathName) ?? true,
  };
}

export function validateProjectConfig(value: unknown): PharoNexusProjectConfig {
  const record = assertRecord(value, "project config");
  if (record.version !== 1) {
    throw new PharoNexusConfigError("project config.version must be 1");
  }
  const agent = validateAgentConfig(record.agent, "project config.agent");
  const workTracking = validateWorkTrackingConfig(record.workTracking);

  return {
    version: 1,
    id: requiredString(record, "id", "project config"),
    name: requiredString(record, "name", "project config"),
    home: nullableString(record, "home", "project config"),
    repo: validateRepoConfig(record.repo),
    plexusProjectConfig:
      optionalString(record, "plexusProjectConfig", "project config") ??
      plexusProjectConfigFileName,
    worktreesRoot:
      optionalString(record, "worktreesRoot", "project config") ??
      pharoNexusProjectWorktreesDirectoryName,
    kanban: validateKanbanConfig(record.kanban),
    ...(workTracking ? { workTracking } : {}),
    ...(agent ? { agent } : {}),
  };
}

export function createControlProjectConfig(
  controlProject?: PharoNexusControlProjectReference,
): PharoNexusProjectConfig {
  const vibeKanbanProjectId = controlProject?.vibeKanbanProjectId;

  return {
    version: 1,
    id: controlProject?.id ?? pharoNexusControlProjectId,
    name: controlProject?.name ?? pharoNexusControlProjectName,
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    },
    plexusProjectConfig: plexusProjectConfigFileName,
    worktreesRoot: pharoNexusProjectWorktreesDirectoryName,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId ?? null,
    },
  };
}

export function loadProjectConfig(projectRootPath: string): PharoNexusProjectConfig {
  const configPath = projectConfigPath(projectRootPath);
  if (!fs.existsSync(configPath)) {
    throw new PharoNexusConfigError(
      `PharoNexus project is not initialized: ${configPath}`,
    );
  }

  return validateProjectConfig(
    JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function saveProjectConfig(
  projectRootPath: string,
  config: PharoNexusProjectConfig,
): string {
  const configPath = projectConfigPath(projectRootPath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(validateProjectConfig(config), null, 2)}\n`,
    "utf8",
  );
  return configPath;
}

export function initControlProject(
  homePath: string,
  controlProject?: PharoNexusControlProjectReference,
): {
  projectPath: string;
  configPath: string;
  config: PharoNexusProjectConfig;
} {
  const projectPath = path.resolve(
    controlProject?.root ?? controlProjectRootPath(homePath),
  );
  const config = createControlProjectConfig(controlProject);
  fs.mkdirSync(path.join(projectPath, pharoNexusProjectWorktreesDirectoryName), {
    recursive: true,
  });
  const configPath = saveProjectConfig(projectPath, config);

  return {
    projectPath,
    configPath,
    config,
  };
}

export function ensureControlProject(
  homePath: string,
  controlProject?: PharoNexusControlProjectReference,
): {
  projectPath: string;
  configPath: string;
  config: PharoNexusProjectConfig;
} {
  const projectPath = path.resolve(
    controlProject?.root ?? controlProjectRootPath(homePath),
  );
  const configPath = projectConfigPath(projectPath);
  fs.mkdirSync(path.join(projectPath, pharoNexusProjectWorktreesDirectoryName), {
    recursive: true,
  });

  if (fs.existsSync(configPath)) {
    return {
      projectPath,
      configPath,
      config: loadProjectConfig(projectPath),
    };
  }

  const config = createControlProjectConfig(controlProject);
  saveProjectConfig(projectPath, config);

  return {
    projectPath,
    configPath,
    config,
  };
}

function validateVibeKanbanIntegration(
  value: unknown,
  homePathForDefaults: string | undefined,
): PharoNexusHomeConfig["integrations"]["vibeKanban"] {
  if (value === undefined) {
    return {
      executor: "CODEX",
      pharoNexusMcpServerName: "pharo_nexus",
      plexusMcpServerName: "plexus",
      installMcpOnStart: true,
      openBrowserOnStart: true,
      backend: validateVibeKanbanBackendConfig(undefined, homePathForDefaults),
    };
  }

  const record = assertRecord(value, "integrations.vibeKanban");
  const installMcpOnStart =
    record.installMcpOnStart ?? record.installPlexusMcpOnStart;
  if (
    installMcpOnStart !== undefined &&
    typeof installMcpOnStart !== "boolean"
  ) {
    throw new PharoNexusConfigError(
      "integrations.vibeKanban.installMcpOnStart must be a boolean",
    );
  }
  const openBrowserOnStart = record.openBrowserOnStart;
  if (
    openBrowserOnStart !== undefined &&
    typeof openBrowserOnStart !== "boolean"
  ) {
    throw new PharoNexusConfigError(
      "integrations.vibeKanban.openBrowserOnStart must be a boolean",
    );
  }

  return {
    executor:
      optionalString(record, "executor", "integrations.vibeKanban") ?? "CODEX",
    pharoNexusMcpServerName:
      optionalString(
        record,
        "pharoNexusMcpServerName",
        "integrations.vibeKanban",
      ) ?? "pharo_nexus",
    plexusMcpServerName:
      optionalString(
        record,
        "plexusMcpServerName",
        "integrations.vibeKanban",
      ) ?? "plexus",
    installMcpOnStart: installMcpOnStart ?? true,
    openBrowserOnStart: openBrowserOnStart ?? true,
    backend: validateVibeKanbanBackendConfig(
      record.backend,
      homePathForDefaults,
    ),
  };
}

function validateIntegrations(
  value: unknown,
  homePathForDefaults: string | undefined,
): PharoNexusHomeConfig["integrations"] {
  const record =
    value === undefined ? {} : assertRecord(value, "integrations");

  return {
    vibeKanban: validateVibeKanbanIntegration(
      record.vibeKanban,
      homePathForDefaults,
    ),
  };
}

export function validateHomeConfig(
  value: unknown,
  homePathForDefaults?: string,
): PharoNexusHomeConfig {
  const record = assertRecord(value, "config");
  if (record.version !== 1) {
    throw new PharoNexusConfigError("config.version must be 1");
  }

  const paths = assertRecord(record.paths, "paths");
  const ports = assertRecord(record.ports, "ports");
  const mcp =
    record.mcp === undefined ? {} : assertRecord(record.mcp, "mcp");
  const tools = assertRecord(record.tools, "tools");
  const integrations = validateIntegrations(
    record.integrations,
    homePathForDefaults,
  );
  const agent = validateAgentConfig(record.agent, "agent");
  const controlProject = validateControlProjectReference(
    record.controlProject,
    homePathForDefaults,
  );
  const projectsValue = record.projects;
  if (!Array.isArray(projectsValue)) {
    throw new PharoNexusConfigError("projects must be an array");
  }

  const vibeKanbanPort = requiredPort(ports, "vibeKanban");
  const pharoNexusMcpPort =
    ports.pharoNexusMcp === undefined
      ? 7330
      : requiredPort(ports, "pharoNexusMcp");
  const plexusMcpPort = requiredPort(ports, "plexusMcp");
  const uniquePorts = new Set([
    vibeKanbanPort,
    pharoNexusMcpPort,
    plexusMcpPort,
  ]);
  if (uniquePorts.size !== 3) {
    throw new PharoNexusConfigError(
      "ports.vibeKanban, ports.pharoNexusMcp, and ports.plexusMcp must be different",
    );
  }

  const projects = projectsValue.map(validateProjectReference);
  const projectIds = new Set<string>();
  for (const project of projects) {
    if (projectIds.has(project.id)) {
      throw new PharoNexusConfigError(`Project id is duplicated: ${project.id}`);
    }

    projectIds.add(project.id);
  }

  return {
    version: 1,
    paths: {
      projectsRoot: requiredString(paths, "projectsRoot", "paths"),
      workspacesRoot: requiredString(paths, "workspacesRoot", "paths"),
      plexusStateRoot: requiredString(paths, "plexusStateRoot", "paths"),
    },
    ports: {
      vibeKanban: vibeKanbanPort,
      pharoNexusMcp: pharoNexusMcpPort,
      plexusMcp: plexusMcpPort,
    },
    mcp: {
      host: optionalString(mcp, "host", "mcp") ?? "127.0.0.1",
    },
    tools: {
      pharoNexus: validateToolCommand(
        tools.pharoNexus ?? defaultPharoNexusToolCommand(),
        "tools.pharoNexus",
      ),
      vibeKanban: validateToolCommand(tools.vibeKanban, "tools.vibeKanban"),
      plexus: validateToolCommand(tools.plexus, "tools.plexus"),
    },
    integrations,
    ...(agent ? { agent } : {}),
    controlProject,
    projects,
  };
}

export function loadHomeConfig(homePath: string): PharoNexusHomeConfig {
  const configPath = pharoNexusHomeConfigPath(homePath);
  if (!fs.existsSync(configPath)) {
    throw new PharoNexusConfigError(
      `PharoNexus home is not initialized: ${configPath}. Run "pharo-nexus init" first, or set PHARO_NEXUS_HOME to an initialized home.`,
    );
  }

  return validateHomeConfig(
    JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/, "")),
    resolvePharoNexusHome(homePath),
  );
}

export function saveHomeConfig(
  homePath: string,
  config: PharoNexusHomeConfig,
): string {
  const configPath = pharoNexusHomeConfigPath(homePath);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify(validateHomeConfig(config, homePath), null, 2)}\n`,
    "utf8",
  );
  return configPath;
}

export function initPharoNexusHome(
  options: InitPharoNexusHomeOptions,
): InitPharoNexusHomeResult {
  const homePath = resolvePharoNexusHome(options.homePath);
  const configPath = pharoNexusHomeConfigPath(homePath);
  if (fs.existsSync(configPath) && !options.force) {
    throw new PharoNexusConfigError(
      `PharoNexus home is already initialized: ${configPath}`,
    );
  }

  const config = createDefaultHomeConfig(homePath, options);
  fs.mkdirSync(homePath, { recursive: true });
  fs.mkdirSync(config.paths.projectsRoot, { recursive: true });
  fs.mkdirSync(config.paths.workspacesRoot, { recursive: true });
  fs.mkdirSync(config.paths.plexusStateRoot, { recursive: true });
  fs.mkdirSync(path.join(homePath, pharoNexusLogsDirectoryName), {
    recursive: true,
  });
  fs.mkdirSync(path.join(homePath, pharoNexusGeneratedDirectoryName), {
    recursive: true,
  });
  saveHomeConfig(homePath, config);
  const controlProject = options.force
    ? initControlProject(homePath, config.controlProject)
    : ensureControlProject(homePath, config.controlProject);

  return {
    homePath,
    configPath,
    config,
    controlProjectPath: controlProject.projectPath,
    controlProjectConfigPath: controlProject.configPath,
  };
}
