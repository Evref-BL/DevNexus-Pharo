import fs from "node:fs";
import path from "node:path";
import {
  initCodexWorkspace,
  type InitCodexWorkspaceResult,
} from "./codexConfig.js";
import {
  loadHomeConfig,
  loadProjectConfig,
  resolveNexusHome,
  saveProjectConfig,
  saveHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  buildVibeKanbanWorkspaceSetupScript,
  createNexusProjectInRegistry,
  createVibeWorkTrackerProvider,
  importNexusProjectInRegistry,
  updateVibeKanbanProject,
  type EnsureVibeKanbanBoardResult,
  type NexusProjectContext,
  type RegisterVibeKanbanProjectResult,
  type UpdateVibeKanbanProjectResult,
} from "dev-nexus";
import {
  assertNonEmptyString,
  defaultImportedProjectRoot,
  getNexusProjectStatus,
  linkNexusProjectTracker,
  loadProjectConfigIfExists,
  NexusProjectError,
  registerNexusProjectExtension,
  resolveProjectSourceRoot,
  safeDirectoryName,
  samePath,
  slugify,
  statusForProjectReference,
  upsertProjectReference,
  type GitCommandResult,
  type GitRunner,
  type LinkNexusProjectTrackerResult,
} from "./nexusProjectService.js";
import {
  devNexusPharoExtension,
  devNexusPharoProjectExtensionEntry,
  devNexusPharoProjectFilesFromExtensionResult,
  projectUsesDevNexusPharoExtension,
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
  vibeKanbanProjectId?: string;
  gitRunner?: GitRunner;
}

export interface ImportDevNexusPharoProjectOptions {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
  vibeKanbanProjectId?: string;
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

export interface SyncDevNexusPharoProjectTrackerOptions {
  homePath: string;
  project: string;
  host?: string;
  port?: number;
  fetch?: typeof fetch;
}

export interface SyncDevNexusPharoProjectTrackerResult
  extends LinkNexusProjectTrackerResult {
  plexusProjectConfigPath: string;
  plexusProjectConfig: PlexusProjectConfig;
  vibeKanbanRepoId: string;
  vibeKanbanRepo: RegisterVibeKanbanProjectResult;
  vibeKanbanRepoSetup: UpdateVibeKanbanProjectResult;
  vibeKanbanBoard: EnsureVibeKanbanBoardResult;
  vibeKanban: {
    repo: RegisterVibeKanbanProjectResult;
    repoSetup: UpdateVibeKanbanProjectResult;
    board: EnsureVibeKanbanBoardResult;
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
    ...(options.vibeKanbanProjectId !== undefined
      ? { vibeKanbanProjectId: options.vibeKanbanProjectId }
      : {}),
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
    ...(options.vibeKanbanProjectId !== undefined
      ? { vibeKanbanProjectId: options.vibeKanbanProjectId }
      : {}),
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

export async function syncDevNexusPharoProjectTracker(
  options: SyncDevNexusPharoProjectTrackerOptions,
): Promise<SyncDevNexusPharoProjectTrackerResult> {
  assertNonEmptyString(options.project, "project");

  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const status = getNexusProjectStatus({
    homePath,
    project: options.project,
  }).project;
  const initialProjectConfig = loadProjectConfig(status.projectRoot);
  if (!projectUsesDevNexusPharoExtension(initialProjectConfig)) {
    throw new NexusProjectError(
      "project sync-tracker requires a DevNexus-Pharo-managed project",
    );
  }
  const sourceRoot = resolveProjectSourceRoot(
    status.projectRoot,
    initialProjectConfig,
  );
  const legacyVibeKanbanProjectId =
    initialProjectConfig.kanban?.projectId ?? null;
  const setupScript = buildVibeKanbanWorkspaceSetupScript(
    status.projectRoot,
    sourceRoot,
  );
  const vibeKanbanPort = options.port ?? homeConfig.ports.vibeKanban;
  const vibeProvider = createVibeWorkTrackerProvider({
    host: options.host,
    port: vibeKanbanPort,
    fetch: options.fetch,
    config: {
      provider: "vibe-kanban",
      projectId: legacyVibeKanbanProjectId,
    },
  });
  const trackerContext: NexusProjectContext = {
    homePath,
    projectRoot: status.projectRoot,
    projectId: initialProjectConfig.id,
    projectName: status.name,
    sourceRoot,
    workTracking: {
      provider: "vibe-kanban",
      projectId: legacyVibeKanbanProjectId,
    },
  };
  const vibeKanbanProject = await vibeProvider.ensureProject(trackerContext);
  const vibeKanban = vibeKanbanProject.vibeKanbanRepo;
  const vibeKanbanRepoSetup = await updateVibeKanbanProject({
    host: options.host,
    port: vibeKanbanPort,
    fetch: options.fetch,
    projectId: vibeKanbanProject.id,
    setupScript,
  });
  const vibeKanbanBoardRef = await vibeProvider.ensureBoard(trackerContext);
  const vibeKanbanBoard = vibeKanbanBoardRef.vibeKanbanBoard;
  const linked = linkNexusProjectTracker({
    homePath,
    project: status.projectRoot,
    trackerProjectId: vibeKanbanBoardRef.id,
  });
  if (!linked.plexusProjectConfigPath || !linked.plexusProjectConfig) {
    throw new NexusProjectError(
      "project sync-tracker requires a DevNexus-Pharo-managed project",
    );
  }
  const plexusProjectConfig = linked.plexusProjectConfig as PlexusProjectConfig;
  const updatedHomeConfig = loadHomeConfig(homePath);
  const projectConfig = loadProjectConfig(status.projectRoot);
  const reference = upsertProjectReference(
    updatedHomeConfig,
    status.projectRoot,
    projectConfig,
    vibeKanbanBoardRef.id,
    vibeKanbanProject.id,
  );
  saveHomeConfig(homePath, updatedHomeConfig);

  return {
    ...linked,
    plexusProjectConfigPath: linked.plexusProjectConfigPath,
    plexusProjectConfig,
    vibeKanbanProjectId: vibeKanbanBoardRef.id,
    vibeKanbanRepoId: vibeKanbanProject.id,
    project: statusForProjectReference(reference),
    vibeKanbanRepo: vibeKanban,
    vibeKanbanRepoSetup,
    vibeKanbanBoard,
    vibeKanban: {
      repo: vibeKanban,
      repoSetup: vibeKanbanRepoSetup,
      board: vibeKanbanBoard,
    },
  };
}
