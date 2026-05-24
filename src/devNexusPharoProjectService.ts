import fs from "node:fs";
import path from "node:path";
import {
  initCodexWorkspace,
  type InitCodexWorkspaceResult,
} from "./codexConfig.js";
import {
  loadProjectConfigIfExists,
  loadHomeConfig,
  resolveNexusHome,
  saveProjectConfig,
  saveHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  createNexusProjectInRegistry,
  importNexusProjectInRegistry,
} from "dev-nexus";
import {
  defaultImportedProjectRoot,
  NexusProjectError,
  registerNexusProjectExtension,
  safeDirectoryName,
  samePath,
  slugify,
  type GitCommandResult,
  type GitRunner,
} from "./nexusProjectService.js";
import {
  devNexusPharoExtension,
  devNexusPharoProjectExtensionEntry,
  devNexusPharoProjectFilesFromExtensionResult,
  type PlexusProjectConfig,
} from "./devNexusPharoExtension.js";
import { devNexusPharoDevNexusPluginConfig } from "./devNexusPharoPlugin.js";

registerNexusProjectExtension(devNexusPharoExtension);

export interface CreateDevNexusPharoProjectOptions {
  homePath: string;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
  gitRunner?: GitRunner;
}

export interface ImportDevNexusPharoProjectOptions {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
  gitRunner?: GitRunner;
}

export interface CreateDevNexusPharoProjectResult {
  homePath: string;
  projectRoot: string;
  projectConfigPath: string;
  plexusProjectConfigPath: string;
  worktreesRoot: string;
  agentsPath: string;
  suggestedFirstPromptPath: string;
  codexConfigPath: string;
  projectConfig: NexusProjectConfig;
  plexusProjectConfig: PlexusProjectConfig;
  codex: InitCodexWorkspaceResult;
  git: {
    operation: "clone" | "init";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: GitCommandResult[];
  };
}

export interface ImportDevNexusPharoProjectResult {
  homePath: string;
  projectRoot: string;
  projectConfigPath: string;
  plexusProjectConfigPath: string;
  worktreesRoot: string;
  agentsPath: string;
  suggestedFirstPromptPath: string;
  codexConfigPath: string;
  projectConfig: NexusProjectConfig;
  plexusProjectConfig: PlexusProjectConfig;
  codex: InitCodexWorkspaceResult;
  git: {
    operation: "import";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: GitCommandResult[];
  };
}

function assertNormalProjectDoesNotUseControlProject(
  homeConfig: { controlProject: { id: string; root: string } },
  projectId: string,
  projectRoot: string,
  operation: "create" | "import",
): void {
  if (projectId === homeConfig.controlProject.id) {
    throw new NexusProjectError(
      `Cannot ${operation} normal project with reserved control project id: ${projectId}`,
    );
  }
  if (samePath(projectRoot, homeConfig.controlProject.root)) {
    throw new NexusProjectError(
      `Cannot ${operation} normal project at reserved control project root: ${homeConfig.controlProject.root}`,
    );
  }
}

function withDevNexusPharoDevNexusPlugin(
  projectConfig: NexusProjectConfig,
): NexusProjectConfig {
  const pluginConfig = devNexusPharoDevNexusPluginConfig();
  const plugins = projectConfig.plugins ?? [];
  const nextPlugins = [];
  let addedDevNexusPharoPlugin = false;

  for (const plugin of plugins) {
    if (plugin.id !== pluginConfig.id) {
      nextPlugins.push(plugin);
      continue;
    }

    if (!addedDevNexusPharoPlugin) {
      nextPlugins.push(pluginConfig);
      addedDevNexusPharoPlugin = true;
    }
  }

  if (!addedDevNexusPharoPlugin) {
    nextPlugins.push(pluginConfig);
  }

  return {
    ...projectConfig,
    plugins: nextPlugins,
  };
}

function saveProjectConfigWithDevNexusPharoPlugin(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectConfig {
  const updatedProjectConfig = withDevNexusPharoDevNexusPlugin(projectConfig);
  saveProjectConfig(projectRoot, updatedProjectConfig);

  return updatedProjectConfig;
}

export function createDevNexusPharoProject(
  options: CreateDevNexusPharoProjectOptions,
): CreateDevNexusPharoProjectResult {
  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const projectId = slugify(options.name);
  const projectRoot = path.resolve(
    options.root ??
      path.join(homeConfig.paths.projectsRoot, safeDirectoryName(options.name)),
  );
  assertNormalProjectDoesNotUseControlProject(
    homeConfig,
    projectId,
    projectRoot,
    "create",
  );
  const result = createNexusProjectInRegistry({
    homePath,
    registry: homeConfig,
    name: options.name,
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.from !== undefined ? { from: options.from } : {}),
    ...(options.gitInit !== undefined ? { gitInit: options.gitInit } : {}),
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
    extensions: devNexusPharoProjectExtensionEntry(),
    scaffoldExtensions: [devNexusPharoExtension],
  });
  const pharoFiles = devNexusPharoProjectFilesFromExtensionResult(
    result.scaffold.extensionResults[devNexusPharoExtension.id],
  );
  const projectConfig = saveProjectConfigWithDevNexusPharoPlugin(
    result.projectRoot,
    result.projectConfig,
  );
  const codex = initCodexWorkspace({
    homePath,
    workspacePath: result.projectRoot,
    config: homeConfig,
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    plexusProjectConfigPath: pharoFiles.plexusProjectConfigPath,
    worktreesRoot: result.worktreesRoot,
    agentsPath: pharoFiles.agentsPath,
    suggestedFirstPromptPath: pharoFiles.suggestedFirstPromptPath,
    codexConfigPath: codex.configPath,
    projectConfig,
    plexusProjectConfig: pharoFiles.plexusProjectConfig,
    codex,
    git: result.git,
  };
}

export function importDevNexusPharoProject(
  options: ImportDevNexusPharoProjectOptions,
): ImportDevNexusPharoProjectResult {
  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const sourceRoot = path.resolve(options.root);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new NexusProjectError(
      `Project source root must be an existing directory: ${sourceRoot}`,
    );
  }
  const existingProjectConfig = loadProjectConfigIfExists(sourceRoot);
  const projectName =
    existingProjectConfig?.name ?? options.name ?? path.basename(sourceRoot);
  const projectId = existingProjectConfig?.id ?? slugify(projectName);
  const projectRoot = existingProjectConfig
    ? sourceRoot
    : path.resolve(
        options.projectRoot ??
          defaultImportedProjectRoot(homeConfig, projectName, sourceRoot),
      );
  assertNormalProjectDoesNotUseControlProject(
    homeConfig,
    projectId,
    projectRoot,
    "import",
  );
  const result = importNexusProjectInRegistry({
    homePath,
    registry: homeConfig,
    root: options.root,
    ...(options.projectRoot !== undefined ? { projectRoot: options.projectRoot } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
    extensions: devNexusPharoProjectExtensionEntry(),
    scaffoldExtensions: [devNexusPharoExtension],
  });
  const pharoFiles = devNexusPharoProjectFilesFromExtensionResult(
    result.scaffold.extensionResults[devNexusPharoExtension.id],
  );
  const projectConfig = saveProjectConfigWithDevNexusPharoPlugin(
    result.projectRoot,
    result.projectConfig,
  );
  const codex = initCodexWorkspace({
    homePath,
    workspacePath: result.projectRoot,
    config: homeConfig,
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    plexusProjectConfigPath: pharoFiles.plexusProjectConfigPath,
    worktreesRoot: result.worktreesRoot,
    agentsPath: pharoFiles.agentsPath,
    suggestedFirstPromptPath: pharoFiles.suggestedFirstPromptPath,
    codexConfigPath: codex.configPath,
    projectConfig,
    plexusProjectConfig: pharoFiles.plexusProjectConfig,
    codex,
    git: result.git,
  };
}
