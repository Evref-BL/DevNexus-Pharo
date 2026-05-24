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
  loadProjectConfigIfExists,
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
  type NexusProjectRepoConfig,
  type NexusProjectRepoKind,
  type NexusProjectReference,
  type ResolveNexusAgentConfigOptions,
} from "dev-nexus";

export {
  devNexusHomeConfigFileName,
  devNexusProjectConfigFileName,
  loadProjectConfig,
  loadProjectConfigIfExists,
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
  NexusProjectRepoConfig,
  NexusProjectRepoKind,
  NexusProjectReference,
  ResolveNexusAgentConfigOptions,
};

export const devNexusPharoControlProjectDirectoryName = "DevNexus-Pharo";
export const devNexusPharoControlProjectId = "dev-nexus-pharo-control";
export const devNexusPharoControlProjectName = "DevNexus-Pharo";
const obsoleteControlProjectDirectoryName = "control";

export interface NexusControlProjectReference {
  id: string;
  name: string;
  root: string;
}

export interface NexusToolCommand {
  command: string;
  args: string[];
}

export interface NexusHomeConfig extends Omit<NexusHomeConfigBase, "paths"> {
  paths: NexusHomeConfigBase["paths"] & {
    plexusStateRoot: string;
  };
  ports: {
    devNexusPharoMcp: number;
    plexusMcp: number;
  };
  mcp: {
    host: string;
  };
  tools: {
    nexus: NexusToolCommand;
    plexus: NexusToolCommand;
  };
  controlProject: NexusControlProjectReference;
}

export interface CreateDefaultHomeConfigOptions {
  projectsRoot?: string;
  workspacesRoot?: string;
  plexusStateRoot?: string;
  devNexusPharoMcpPort?: number;
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
    envVarName: "DEV_NEXUS_PHARO_HOME",
    directoryName: ".dev-nexus-pharo",
  });
}

export function devNexusPharoCliEntrypointPath(): string {
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
    args: [devNexusPharoCliEntrypointPath(), "mcp"],
  };
}

export const devNexusHomeConfigPath = nexusHomeConfigPath;

export function controlProjectRootPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    devNexusPharoControlProjectDirectoryName,
  );
}

function obsoleteControlProjectRootPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    obsoleteControlProjectDirectoryName,
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
      devNexusPharoMcp: options.devNexusPharoMcpPort ?? 7330,
      plexusMcp: options.plexusMcpPort ?? 7331,
    },
    mcp: {
      host: options.mcpHost ?? "127.0.0.1",
    },
    tools: {
      nexus: defaultNexusToolCommand(),
      plexus: {
        command: "plexus-gateway",
        args: [],
      },
    },
    controlProject: {
      id: devNexusPharoControlProjectId,
      name: devNexusPharoControlProjectName,
      root: controlProjectRootPath(resolvedHomePath),
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

function normalizedExecutableName(command: string): string {
  return path
    .basename(command)
    .toLowerCase()
    .replace(/\.(cmd|exe|ps1)$/u, "");
}

function assertNexusToolDoesNotUseObsoleteBareCommand(
  tool: NexusToolCommand,
): void {
  if (normalizedExecutableName(tool.command) !== "dev-nexus-pharo") {
    return;
  }

  throw new NexusConfigError(
    'tools.nexus.command uses obsolete bare command "dev-nexus-pharo". Regenerate the MCP config through current DevNexus/DevNexus-Pharo setup so it uses the current Node executable and CLI entrypoint.',
  );
}

function defaultControlProjectReference(
  homePathForDefaults: string | undefined,
): NexusControlProjectReference {
  return {
    id: devNexusPharoControlProjectId,
    name: devNexusPharoControlProjectName,
    root: controlProjectRootPath(homePathForDefaults ?? "."),
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

  return {
    id: requiredString(record, "id", "controlProject"),
    name: requiredString(record, "name", "controlProject"),
    root: path.resolve(
      homePathForDefaults ?? ".",
      requiredString(record, "root", "controlProject"),
    ),
  };
}

export function createControlProjectConfig(
  controlProject?: NexusControlProjectReference,
): NexusProjectConfig {
  return {
    version: 1,
    id: controlProject?.id ?? devNexusPharoControlProjectId,
    name: controlProject?.name ?? devNexusPharoControlProjectName,
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    },
    components: [
      {
        id: "primary",
        name: controlProject?.name ?? devNexusPharoControlProjectName,
        kind: "local",
        role: "primary",
        remoteUrl: null,
        defaultBranch: null,
        sourceRoot: ".",
        relationships: [],
      },
    ],
    worktreesRoot: nexusProjectWorktreesDirectoryName,
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

function assertControlProjectDoesNotUseObsoleteRoot(
  controlProject: NexusControlProjectReference,
  homePathForDefaults: string | undefined,
): void {
  if (!homePathForDefaults || controlProject.id !== devNexusPharoControlProjectId) {
    return;
  }

  const obsoleteRoot = obsoleteControlProjectRootPath(homePathForDefaults);
  if (!samePath(controlProject.root, obsoleteRoot)) {
    return;
  }

  throw new NexusConfigError(
    `DevNexus-Pharo home config uses obsolete controlProject.root "${obsoleteRoot}". Regenerate the home through current DevNexus/DevNexus-Pharo setup; this version will not move or rewrite that root.`,
  );
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
  const controlProject = validateControlProjectReference(
    record.controlProject,
    homePathForDefaults,
  );
  assertControlProjectDoesNotUseObsoleteRoot(
    controlProject,
    homePathForDefaults,
  );
  assertProjectsDoNotCollideWithControlProject(
    baseConfig.projects,
    controlProject,
  );

  const devNexusPharoMcpPort =
    ports.devNexusPharoMcp === undefined
      ? 7330
      : requiredPort(ports, "devNexusPharoMcp");
  const plexusMcpPort = requiredPort(ports, "plexusMcp");
  const uniquePorts = new Set([
    devNexusPharoMcpPort,
    plexusMcpPort,
  ]);
  if (uniquePorts.size !== 2) {
    throw new NexusConfigError(
      "ports.devNexusPharoMcp and ports.plexusMcp must be different",
    );
  }
  const nexusTool = validateToolCommand(
    tools.nexus ?? defaultNexusToolCommand(),
    "tools.nexus",
  );
  assertNexusToolDoesNotUseObsoleteBareCommand(nexusTool);

  return {
    ...baseConfig,
    paths: {
      ...baseConfig.paths,
      plexusStateRoot: requiredString(paths, "plexusStateRoot", "paths"),
    },
    ports: {
      devNexusPharoMcp: devNexusPharoMcpPort,
      plexusMcp: plexusMcpPort,
    },
    mcp: {
      host: optionalString(mcp, "host", "mcp") ?? "127.0.0.1",
    },
    tools: {
      nexus: nexusTool,
      plexus: validateToolCommand(tools.plexus, "tools.plexus"),
    },
    controlProject,
  };
}

export function loadHomeConfig(homePath: string): NexusHomeConfig {
  return loadNexusHomeConfigFile(homePath, validateHomeConfig, {
    missingMessage: (configPath) =>
      `DevNexus-Pharo home is not initialized: ${configPath}. Run "dev-nexus-pharo init" first, or set DEV_NEXUS_PHARO_HOME to an initialized home.`,
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
      `DevNexus-Pharo home is already initialized: ${configPath}`,
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
