import fs from "node:fs";
import path from "node:path";
import {
  initCodexWorkspace,
  type InitCodexWorkspaceResult,
} from "./codexConfig.js";
import {
  loadHomeConfig,
  loadProjectConfig,
  projectConfigPath,
  projectWorktreesRootPath,
  resolvePharoNexusHome,
  saveHomeConfig,
  saveProjectConfig,
  type NexusProjectConfig,
} from "./config.js";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";
import {
  assertFileDoesNotExist,
  assertGitRepository,
  assertNonEmptyString,
  buildProjectConfig,
  buildVibeKanbanWorkspaceSetupScript,
  defaultGitRunner,
  defaultImportedProjectRoot,
  defaultSourceCheckoutDirectoryName,
  detectDefaultBranch,
  detectOriginUrl,
  directoryExistsAndIsNonEmpty,
  ensureUniqueProject,
  getNexusProjectStatus,
  linkNexusProjectTracker,
  loadProjectConfigIfExists,
  NexusProjectError,
  optionalNonEmptyString,
  pathForProjectConfig,
  registerNexusProjectExtension,
  resolveProjectSourceRoot,
  runGitCommand,
  safeDirectoryName,
  slugify,
  statusForProjectReference,
  upsertProjectReference,
  type GitCommandResult,
  type GitRunner,
  type LinkNexusProjectTrackerResult,
} from "./nexusProjectService.js";
import {
  pharoNexusExtension,
  pharoNexusProjectExtensionEntry,
  pharoNexusProjectFilesFromExtensionResult,
  projectPlexusConfigPath,
  projectUsesPharoNexusExtension,
  type PlexusProjectConfig,
} from "./pharoNexusExtension.js";
import {
  type EnsureVibeKanbanBoardResult,
} from "./vibeKanbanBoardAdapter.js";
import {
  updateVibeKanbanProject,
  type RegisterVibeKanbanProjectResult,
  type UpdateVibeKanbanProjectResult,
} from "./vibeKanbanProjectAdapter.js";
import { createVibeWorkTrackerProvider } from "./workTrackingVibeProvider.js";
import type { NexusProjectContext } from "./workTrackingTypes.js";

registerNexusProjectExtension(pharoNexusExtension);

export interface CreatePharoNexusProjectOptions {
  homePath: string;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
  vibeKanbanProjectId?: string;
  gitRunner?: GitRunner;
}

export interface ImportPharoNexusProjectOptions {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
  vibeKanbanProjectId?: string;
  gitRunner?: GitRunner;
}

export interface CreatePharoNexusProjectResult {
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

export interface ImportPharoNexusProjectResult {
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

export interface SyncPharoNexusProjectTrackerOptions {
  homePath: string;
  project: string;
  host?: string;
  port?: number;
  fetch?: typeof fetch;
}

export interface SyncPharoNexusProjectTrackerResult
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

export function createPharoNexusProject(
  options: CreatePharoNexusProjectOptions,
): CreatePharoNexusProjectResult {
  const pharoNexusExtensions = pharoNexusProjectExtensionEntry();
  assertNonEmptyString(options.name, "name");
  const vibeKanbanProjectId =
    optionalNonEmptyString(options.vibeKanbanProjectId, "vibeKanbanProjectId") ??
    null;
  if (options.from && options.gitInit) {
    throw new NexusProjectError("--from and --git-init are mutually exclusive");
  }

  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const projectId = slugify(options.name);
  const projectRoot = path.resolve(
    options.root ?? path.join(homeConfig.paths.projectsRoot, safeDirectoryName(options.name)),
  );
  ensureUniqueProject(homeConfig, projectId, projectRoot);

  const creatingFromRemote = Boolean(options.from);
  if (directoryExistsAndIsNonEmpty(projectRoot)) {
    throw new NexusProjectError(
      `Project root already exists and is not empty: ${projectRoot}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const gitCommands: GitCommandResult[] = [];
  let sourceRoot: string | null = null;
  if (creatingFromRemote) {
    fs.mkdirSync(projectRoot, { recursive: true });
    runGitCommand(gitRunner, gitCommands, ["init", projectRoot]);
    sourceRoot = path.join(projectRoot, defaultSourceCheckoutDirectoryName);
    runGitCommand(gitRunner, gitCommands, ["clone", options.from as string, sourceRoot]);
  } else {
    fs.mkdirSync(projectRoot, { recursive: true });
    runGitCommand(gitRunner, gitCommands, ["init", projectRoot]);
  }

  const defaultBranch = detectDefaultBranch(
    gitRunner,
    gitCommands,
    sourceRoot ?? projectRoot,
  );
  const projectConfig = buildProjectConfig(
    options.name,
    projectId,
    options.from,
    defaultBranch,
    vibeKanbanProjectId,
    sourceRoot ? pathForProjectConfig(projectRoot, sourceRoot) : null,
    false,
    pharoNexusExtensions,
  );
  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  const plexusConfigPath = projectPlexusConfigPath(projectRoot, projectConfig);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);

  assertFileDoesNotExist(devNexusProjectConfigPath);
  assertFileDoesNotExist(plexusConfigPath);
  saveProjectConfig(projectRoot, projectConfig);
  const scaffold = scaffoldNexusProject({
    homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
    extensions: [pharoNexusExtension],
  });
  const pharoFiles = pharoNexusProjectFilesFromExtensionResult(
    scaffold.extensionResults[pharoNexusExtension.id],
  );
  const codex = initCodexWorkspace({
    homePath,
    workspacePath: projectRoot,
    config: homeConfig,
  });

  homeConfig.projects.push({
    id: projectId,
    name: options.name,
    projectRoot: projectRoot,
    ...(vibeKanbanProjectId ? { vibeKanbanProjectId } : {}),
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot,
    projectConfigPath: devNexusProjectConfigPath,
    plexusProjectConfigPath: pharoFiles.plexusProjectConfigPath,
    worktreesRoot,
    agentsPath: pharoFiles.agentsPath,
    suggestedFirstPromptPath: pharoFiles.suggestedFirstPromptPath,
    codexConfigPath: codex.configPath,
    projectConfig,
    plexusProjectConfig: pharoFiles.plexusProjectConfig,
    codex,
    git: {
      operation: creatingFromRemote ? "clone" : "init",
      remoteUrl: options.from ?? null,
      defaultBranch,
      commands: gitCommands,
    },
  };
}

export function importPharoNexusProject(
  options: ImportPharoNexusProjectOptions,
): ImportPharoNexusProjectResult {
  const pharoNexusExtensions = pharoNexusProjectExtensionEntry();
  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const vibeKanbanProjectId =
    optionalNonEmptyString(options.vibeKanbanProjectId, "vibeKanbanProjectId") ??
    null;
  const sourceRoot = path.resolve(options.root);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new NexusProjectError(
      `Project source root must be an existing directory: ${sourceRoot}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const gitCommands: GitCommandResult[] = [];
  assertGitRepository(gitRunner, gitCommands, sourceRoot);
  const remoteUrl = detectOriginUrl(gitRunner, gitCommands, sourceRoot);
  const defaultBranch = detectDefaultBranch(gitRunner, gitCommands, sourceRoot);
  const existingProjectConfig = loadProjectConfigIfExists(sourceRoot);
  const projectName = existingProjectConfig?.name ?? options.name ?? path.basename(sourceRoot);
  const projectId = existingProjectConfig?.id ?? slugify(projectName);
  const projectRoot = existingProjectConfig
    ? sourceRoot
    : path.resolve(
        options.projectRoot ??
          defaultImportedProjectRoot(homeConfig, projectName, sourceRoot),
      );
  ensureUniqueProject(homeConfig, projectId, projectRoot);
  if (!existingProjectConfig && directoryExistsAndIsNonEmpty(projectRoot)) {
    throw new NexusProjectError(
      `Project root already exists and is not empty: ${projectRoot}`,
    );
  }
  if (!existingProjectConfig) {
    fs.mkdirSync(projectRoot, { recursive: true });
    runGitCommand(gitRunner, gitCommands, ["init", projectRoot]);
  }

  const projectConfig =
    existingProjectConfig
      ? {
          ...existingProjectConfig,
          extensions: {
            ...existingProjectConfig.extensions,
            ...pharoNexusExtensions,
          },
        }
      : buildProjectConfig(
          projectName,
          projectId,
          remoteUrl ?? undefined,
          defaultBranch,
          vibeKanbanProjectId,
          pathForProjectConfig(projectRoot, sourceRoot),
          true,
          pharoNexusExtensions,
        );
  if (existingProjectConfig && vibeKanbanProjectId) {
    projectConfig.kanban = {
      ...projectConfig.kanban,
      projectId: vibeKanbanProjectId,
    };
  }

  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  if (
    !existingProjectConfig ||
    vibeKanbanProjectId ||
    !projectUsesPharoNexusExtension(existingProjectConfig)
  ) {
    saveProjectConfig(projectRoot, projectConfig);
  }

  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  const scaffold = scaffoldNexusProject({
    homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
    extensions: [pharoNexusExtension],
  });
  const pharoFiles = pharoNexusProjectFilesFromExtensionResult(
    scaffold.extensionResults[pharoNexusExtension.id],
  );
  const codex = initCodexWorkspace({
    homePath,
    workspacePath: projectRoot,
    config: homeConfig,
  });

  homeConfig.projects.push({
    id: projectConfig.id,
    name: projectConfig.name,
    projectRoot: projectRoot,
    ...(projectConfig.kanban.projectId
      ? { vibeKanbanProjectId: projectConfig.kanban.projectId }
      : {}),
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot,
    projectConfigPath: devNexusProjectConfigPath,
    plexusProjectConfigPath: pharoFiles.plexusProjectConfigPath,
    worktreesRoot,
    agentsPath: pharoFiles.agentsPath,
    suggestedFirstPromptPath: pharoFiles.suggestedFirstPromptPath,
    codexConfigPath: codex.configPath,
    projectConfig,
    plexusProjectConfig: pharoFiles.plexusProjectConfig,
    codex,
    git: {
      operation: "import",
      remoteUrl,
      defaultBranch,
      commands: gitCommands,
    },
  };
}

export async function syncPharoNexusProjectTracker(
  options: SyncPharoNexusProjectTrackerOptions,
): Promise<SyncPharoNexusProjectTrackerResult> {
  assertNonEmptyString(options.project, "project");

  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const status = getNexusProjectStatus({
    homePath,
    project: options.project,
  }).project;
  const initialProjectConfig = loadProjectConfig(status.projectRoot);
  if (!projectUsesPharoNexusExtension(initialProjectConfig)) {
    throw new NexusProjectError(
      "project sync-tracker requires a PharoNexus-managed project",
    );
  }
  const sourceRoot = resolveProjectSourceRoot(
    status.projectRoot,
    initialProjectConfig,
  );
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
      projectId: initialProjectConfig.kanban.projectId,
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
      projectId: initialProjectConfig.kanban.projectId,
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
      "project sync-tracker requires a PharoNexus-managed project",
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
