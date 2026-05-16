import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  createDefaultNexusHomeConfigBase,
  defaultNexusHomePath as defaultDevNexusHomePath,
  devNexusHomeConfigFileName,
  devNexusProjectConfigFileName,
  loadNexusHomeConfigFile,
  loadProjectConfig,
  nexusGeneratedDirectoryName,
  nexusHomeConfigPath,
  nexusLogsDirectoryName,
  nexusProjectWorktreesDirectoryName,
  NexusConfigError,
  projectConfigPath,
  projectWorktreesRootPath,
  resolveNexusAgentConfig,
  resolveNexusHome,
  resolveNexusHomePath,
  saveProjectConfig,
  saveNexusHomeConfigFile,
  samePath,
  validateNexusAgentConfig,
  validateNexusHomeConfigBase,
  validateProjectConfig,
  type NexusAgentConfig,
  type NexusHomeConfigBase,
  type NexusProjectConfig,
  type NexusProjectExtensionsConfig,
  type NexusProjectKanbanConfig,
  type NexusProjectRepoConfig,
  type NexusProjectRepoKind,
  type NexusProjectReference,
  type ResolveNexusAgentConfigOptions,
} from "dev-nexus";

export {
  devNexusHomeConfigFileName,
  devNexusProjectConfigFileName,
  loadProjectConfig,
  nexusGeneratedDirectoryName,
  nexusLogsDirectoryName,
  nexusProjectWorktreesDirectoryName,
  NexusConfigError,
  projectConfigPath,
  projectWorktreesRootPath,
  resolveNexusAgentConfig,
  resolveNexusHome,
  saveProjectConfig,
  validateNexusAgentConfig,
  validateProjectConfig,
};

export type {
  NexusAgentConfig,
  NexusHomeConfigBase,
  NexusProjectConfig,
  NexusProjectExtensionsConfig,
  NexusProjectKanbanConfig,
  NexusProjectRepoConfig,
  NexusProjectRepoKind,
  NexusProjectReference,
  ResolveNexusAgentConfigOptions,
};

export const pharoNexusControlProjectDirectoryName = "PharoNexus";
export const pharoNexusLegacyControlProjectDirectoryName = "control";
export const pharoNexusControlProjectId = "pharo-nexus-control";
export const pharoNexusControlProjectName = "PharoNexus";
export const vibeKanbanPinnedVersion = "0.1.43";
export const vibeKanbanPinnedPackage = `vibe-kanban@${vibeKanbanPinnedVersion}`;

export interface NexusControlProjectReference {
  id: string;
  name: string;
  root: string;
  vibeKanbanProjectId: string | null;
  vibeKanbanRepoId: string | null;
}

export interface NexusToolCommand {
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

export interface NexusHomeConfig extends Omit<NexusHomeConfigBase, "paths"> {
  paths: NexusHomeConfigBase["paths"] & {
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
    nexus: NexusToolCommand;
    vibeKanban: NexusToolCommand;
    plexus: NexusToolCommand;
  };
  integrations: {
    vibeKanban: {
      executor: string;
      nexusMcpServerName: string;
      plexusMcpServerName: string;
      installMcpOnStart: boolean;
      openBrowserOnStart: boolean;
      backend: VibeKanbanBackendConfig;
    };
  };
  controlProject: NexusControlProjectReference;
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

export interface InitNexusHomeOptions extends CreateDefaultHomeConfigOptions {
  homePath: string;
  force?: boolean;
}

export interface InitNexusHomeResult {
  homePath: string;
  configPath: string;
  config: NexusHomeConfig;
  controlProjectPath: string;
  controlProjectConfigPath: string;
}

export function defaultNexusHomePath(): string {
  return defaultDevNexusHomePath({
    envVarName: "PHARO_NEXUS_HOME",
    directoryName: ".pharo-nexus",
  });
}

export function defaultVibeKanbanToolCommand(): NexusToolCommand {
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

export function defaultNexusToolCommand(): NexusToolCommand {
  return {
    command: process.execPath,
    args: [pharoNexusCliEntrypointPath(), "mcp"],
  };
}

export const devNexusHomeConfigPath = nexusHomeConfigPath;

export function controlProjectRootPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    pharoNexusControlProjectDirectoryName,
  );
}

export function legacyControlProjectRootPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    pharoNexusLegacyControlProjectDirectoryName,
  );
}

export function controlProjectConfigPath(homePath: string): string {
  return projectConfigPath(controlProjectRootPath(homePath));
}

export function controlProjectWorktreesRootPath(
  homePath: string,
  controlProject?: NexusControlProjectReference,
): string {
  return path.join(
    controlProject?.root ?? controlProjectRootPath(homePath),
    nexusProjectWorktreesDirectoryName,
  );
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
): NexusHomeConfig {
  const resolvedHomePath = resolveNexusHome(homePath);
  const baseConfig = createDefaultNexusHomeConfigBase(resolvedHomePath, {
    projectsRoot: options.projectsRoot,
    workspacesRoot: options.workspacesRoot,
  });
  const config: NexusHomeConfig = {
    ...baseConfig,
    paths: {
      ...baseConfig.paths,
      plexusStateRoot: resolveNexusHomePath(
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
      nexus: defaultNexusToolCommand(),
      vibeKanban: defaultVibeKanbanToolCommand(),
      plexus: {
        command: "plexus-gateway",
        args: [],
      },
    },
    integrations: {
      vibeKanban: {
        executor: "CODEX",
        nexusMcpServerName: "pharo_nexus",
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
  };

  return validateHomeConfig(config, resolvedHomePath);
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an object`);
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
    throw new NexusConfigError(
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
    throw new NexusConfigError(
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
    throw new NexusConfigError(`${pathName}.${key} must be a boolean`);
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
    throw new NexusConfigError(
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
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string or null`,
    );
  }

  return value;
}

function requiredPort(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new NexusConfigError(
      `ports.${key} must be an integer between 1 and 65535`,
    );
  }

  return value;
}

function validateToolCommand(
  value: unknown,
  pathName: string,
): NexusToolCommand {
  const record = assertRecord(value, pathName);
  const command = requiredString(record, "command", pathName);
  const args = record.args;

  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string")) {
    throw new NexusConfigError(
      `${pathName}.args must be an array of strings`,
    );
  }

  return { command, args };
}

function defaultControlProjectReference(
  homePathForDefaults: string | undefined,
): NexusControlProjectReference {
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
): NexusControlProjectReference {
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
    throw new NexusConfigError(
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
    throw new NexusConfigError(
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

function resolveConfiguredPath(homePath: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(homePath, value);
}

function validateVibeKanbanBackendConfig(
  value: unknown,
  homePathForDefaults: string | undefined,
): VibeKanbanBackendConfig {
  const homePath = resolveNexusHome(homePathForDefaults ?? ".");
  const defaults = defaultVibeKanbanBackendConfig(homePath);
  const dindDefaults = defaultVibeKanbanDindBackendConfig(homePath);
  if (value === undefined) {
    return defaults;
  }

  const record = assertRecord(value, "integrations.vibeKanban.backend");
  const mode = record.mode ?? defaults.mode;
  if (mode !== "docker" && mode !== "dind" && mode !== "external") {
    throw new NexusConfigError(
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

export function createControlProjectConfig(
  controlProject?: NexusControlProjectReference,
): NexusProjectConfig {
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
    components: [
      {
        id: "primary",
        name: controlProject?.name ?? pharoNexusControlProjectName,
        kind: "local",
        role: "primary",
        remoteUrl: null,
        defaultBranch: null,
        sourceRoot: ".",
        relationships: [],
      },
    ],
    worktreesRoot: nexusProjectWorktreesDirectoryName,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId ?? null,
    },
  };
}

export function initControlProject(
  homePath: string,
  controlProject?: NexusControlProjectReference,
): {
  projectPath: string;
  configPath: string;
  config: NexusProjectConfig;
} {
  const projectPath = path.resolve(
    controlProject?.root ?? controlProjectRootPath(homePath),
  );
  const config = createControlProjectConfig(controlProject);
  fs.mkdirSync(path.join(projectPath, nexusProjectWorktreesDirectoryName), {
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
  controlProject?: NexusControlProjectReference,
): {
  projectPath: string;
  configPath: string;
  config: NexusProjectConfig;
} {
  const projectPath = path.resolve(
    controlProject?.root ?? controlProjectRootPath(homePath),
  );
  const configPath = projectConfigPath(projectPath);
  fs.mkdirSync(path.join(projectPath, nexusProjectWorktreesDirectoryName), {
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
): NexusHomeConfig["integrations"]["vibeKanban"] {
  if (value === undefined) {
    return {
      executor: "CODEX",
      nexusMcpServerName: "pharo_nexus",
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
    throw new NexusConfigError(
      "integrations.vibeKanban.installMcpOnStart must be a boolean",
    );
  }
  const openBrowserOnStart = record.openBrowserOnStart;
  if (
    openBrowserOnStart !== undefined &&
    typeof openBrowserOnStart !== "boolean"
  ) {
    throw new NexusConfigError(
      "integrations.vibeKanban.openBrowserOnStart must be a boolean",
    );
  }

  return {
    executor:
      optionalString(record, "executor", "integrations.vibeKanban") ?? "CODEX",
    nexusMcpServerName:
      optionalString(
        record,
        "nexusMcpServerName",
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
): NexusHomeConfig["integrations"] {
  const record =
    value === undefined ? {} : assertRecord(value, "integrations");

  return {
    vibeKanban: validateVibeKanbanIntegration(
      record.vibeKanban,
      homePathForDefaults,
    ),
  };
}

function assertProjectsDoNotCollideWithControlProject(
  projects: NexusProjectReference[],
  controlProject: NexusControlProjectReference,
): void {
  for (const project of projects) {
    if (project.id === controlProject.id) {
      throw new NexusConfigError(
        `Project id is reserved for the control project: ${controlProject.id}`,
      );
    }
    if (samePath(project.projectRoot, controlProject.root)) {
      throw new NexusConfigError(
        `Project root is reserved for the control project: ${controlProject.root}`,
      );
    }
  }
}

export function validateHomeConfig(
  value: unknown,
  homePathForDefaults?: string,
): NexusHomeConfig {
  const baseConfig = validateNexusHomeConfigBase(value, homePathForDefaults);
  const record = assertRecord(value, "config");
  const paths = assertRecord(record.paths, "paths");
  const ports = assertRecord(record.ports, "ports");
  const mcp =
    record.mcp === undefined ? {} : assertRecord(record.mcp, "mcp");
  const tools = assertRecord(record.tools, "tools");
  const integrations = validateIntegrations(
    record.integrations,
    homePathForDefaults,
  );
  const controlProject = validateControlProjectReference(
    record.controlProject,
    homePathForDefaults,
  );
  assertProjectsDoNotCollideWithControlProject(
    baseConfig.projects,
    controlProject,
  );

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
    throw new NexusConfigError(
      "ports.vibeKanban, ports.pharoNexusMcp, and ports.plexusMcp must be different",
    );
  }

  return {
    ...baseConfig,
    paths: {
      ...baseConfig.paths,
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
      nexus: validateToolCommand(
        tools.nexus ?? defaultNexusToolCommand(),
        "tools.nexus",
      ),
      vibeKanban: validateToolCommand(tools.vibeKanban, "tools.vibeKanban"),
      plexus: validateToolCommand(tools.plexus, "tools.plexus"),
    },
    integrations,
    controlProject,
  };
}

export function loadHomeConfig(homePath: string): NexusHomeConfig {
  return loadNexusHomeConfigFile(homePath, validateHomeConfig, {
    missingMessage: (configPath) =>
      `PharoNexus home is not initialized: ${configPath}. Run "pharo-nexus init" first, or set PHARO_NEXUS_HOME to an initialized home.`,
  });
}

export function saveHomeConfig(
  homePath: string,
  config: NexusHomeConfig,
): string {
  return saveNexusHomeConfigFile(homePath, config, validateHomeConfig);
}

export function initNexusHome(
  options: InitNexusHomeOptions,
): InitNexusHomeResult {
  const homePath = resolveNexusHome(options.homePath);
  const configPath = devNexusHomeConfigPath(homePath);
  if (fs.existsSync(configPath) && !options.force) {
    throw new NexusConfigError(
      `PharoNexus home is already initialized: ${configPath}`,
    );
  }

  const config = createDefaultHomeConfig(homePath, options);
  fs.mkdirSync(homePath, { recursive: true });
  fs.mkdirSync(config.paths.projectsRoot, { recursive: true });
  fs.mkdirSync(config.paths.workspacesRoot, { recursive: true });
  fs.mkdirSync(config.paths.plexusStateRoot, { recursive: true });
  fs.mkdirSync(path.join(homePath, nexusLogsDirectoryName), {
    recursive: true,
  });
  fs.mkdirSync(path.join(homePath, nexusGeneratedDirectoryName), {
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
