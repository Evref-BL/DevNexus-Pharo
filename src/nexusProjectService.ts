import fs from "node:fs";
import path from "node:path";
import {
  assertFileDoesNotExist,
  assertGitRepository,
  assertNonEmptyString,
  buildNexusProjectStatus,
  buildNexusProjectStatusForPath,
  defaultImportedProjectRoot,
  defaultProjectGitRunner,
  defaultSourceCheckoutDirectoryName,
  detectDefaultBranch,
  detectOriginUrl,
  directoryExistsAndIsNonEmpty,
  ensureUniqueProject,
  findNexusProjectReference,
  findNexusProjectReferenceById,
  findNexusProjectReferenceByPath,
  loadProjectConfigIfExists,
  NexusProjectError,
  optionalNonEmptyString,
  pathForProjectConfig,
  projectRootFromInput,
  resolveProjectSourceRoot,
  runProjectGitCommand,
  safeProjectDirectoryName,
  samePath,
  scaffoldNexusProject,
  slugify,
  upsertNexusProjectReference,
  type NexusExtension,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
  type WorkTrackingConfig,
} from "dev-nexus";
import {
  loadHomeConfig,
  loadProjectConfig,
  nexusProjectWorktreesDirectoryName,
  projectConfigPath,
  projectWorktreesRootPath,
  resolveNexusHome,
  saveHomeConfig,
  saveProjectConfig,
  type NexusProjectExtensionsConfig,
  type NexusHomeConfig,
  type NexusProjectConfig,
  type NexusProjectReference,
} from "./config.js";

const defaultGitRunner = defaultProjectGitRunner;
const runGitCommand = runProjectGitCommand;
const safeDirectoryName = safeProjectDirectoryName;

export type GitCommandResult = ProjectGitCommandResult;
export type GitRunner = ProjectGitRunner;

export {
  assertFileDoesNotExist,
  assertGitRepository,
  assertNonEmptyString,
  buildNexusProjectStatus,
  buildNexusProjectStatusForPath,
  defaultImportedProjectRoot,
  defaultGitRunner,
  defaultSourceCheckoutDirectoryName,
  detectDefaultBranch,
  detectOriginUrl,
  directoryExistsAndIsNonEmpty,
  ensureUniqueProject,
  findNexusProjectReference,
  findNexusProjectReferenceById,
  findNexusProjectReferenceByPath,
  loadProjectConfigIfExists,
  NexusProjectError,
  optionalNonEmptyString,
  pathForProjectConfig,
  projectRootFromInput,
  resolveProjectSourceRoot,
  runGitCommand,
  safeDirectoryName,
  samePath,
  slugify,
  upsertNexusProjectReference,
};

export interface CreateNexusProjectOptions {
  homePath: string;
  name: string;
  root?: string;
  from?: string;
  gitInit?: boolean;
  vibeKanbanProjectId?: string;
  gitRunner?: GitRunner;
}

export interface ImportNexusProjectOptions {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
  vibeKanbanProjectId?: string;
  gitRunner?: GitRunner;
}

export interface CreateNexusProjectResult {
  homePath: string;
  projectRoot: string;
  projectConfigPath: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  git: {
    operation: "clone" | "init";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: GitCommandResult[];
  };
}

export interface ImportNexusProjectResult {
  homePath: string;
  projectRoot: string;
  projectConfigPath: string;
  worktreesRoot: string;
  projectConfig: NexusProjectConfig;
  git: {
    operation: "import";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: GitCommandResult[];
  };
}

export interface NexusProjectStatus {
  id: string;
  name: string;
  projectRoot: string;
  repo: NexusProjectConfig["repo"] | null;
  workTracking: WorkTrackingConfig | null;
  vibeKanbanProjectId: string | null;
  vibeKanbanRepoId: string | null;
  projectConfigPath: string;
  projectConfigExists: boolean;
  plexusProjectConfigPath: string | null;
  plexusProjectConfigExists: boolean;
  worktreesRoot: string;
  worktreesRootExists: boolean;
}

export interface ListNexusProjectsOptions {
  homePath: string;
}

export interface ListNexusProjectsResult {
  homePath: string;
  projects: NexusProjectStatus[];
}

export interface GetNexusProjectStatusOptions {
  homePath: string;
  project: string;
}

export interface GetNexusProjectStatusResult {
  homePath: string;
  project: NexusProjectStatus;
}

export interface LinkNexusProjectTrackerOptions {
  homePath: string;
  project: string;
  trackerProjectId: string;
}

export type ConfigureNexusProjectTrackerProvider =
  | "local"
  | "github"
  | "gitlab"
  | "jira";

export interface ConfigureNexusProjectTrackerOptions {
  homePath: string;
  project: string;
  provider: ConfigureNexusProjectTrackerProvider;
  host?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  repositoryId?: string;
  projectKey?: string;
  issueType?: string;
  storePath?: string;
}

export interface ConfigureNexusProjectTrackerResult {
  homePath: string;
  project: NexusProjectStatus;
  projectConfigPath: string;
  plexusProjectConfigPath: string | null;
  projectConfig: NexusProjectConfig;
  workTracking: WorkTrackingConfig;
}

export interface LinkNexusProjectTrackerResult {
  homePath: string;
  vibeKanbanProjectId: string;
  vibeKanbanRepoId: string | null;
  project: NexusProjectStatus;
  projectConfigPath: string;
  plexusProjectConfigPath: string | null;
  plexusProjectConfig: unknown | null;
}

export interface NexusProjectStatusExtensionContribution {
  plexusProjectConfigPath?: string | null;
  plexusProjectConfigExists?: boolean;
}

export interface NexusProjectTrackerLinkExtensionContribution {
  plexusProjectConfigPath?: string | null;
  plexusProjectConfig?: unknown | null;
}

export type NexusProjectServiceExtension = NexusExtension<
  NexusProjectConfig,
  unknown,
  NexusProjectStatusExtensionContribution | undefined,
  NexusProjectTrackerLinkExtensionContribution | undefined
>;

const nexusProjectServiceExtensions: NexusProjectServiceExtension[] = [];

export function registerNexusProjectExtension(
  extension: NexusProjectServiceExtension,
): void {
  const existingIndex = nexusProjectServiceExtensions.findIndex(
    (registered) => registered.id === extension.id,
  );

  if (existingIndex >= 0) {
    nexusProjectServiceExtensions[existingIndex] = extension;
    return;
  }

  nexusProjectServiceExtensions.push(extension);
}

export function registeredNexusProjectExtensions(): readonly NexusProjectServiceExtension[] {
  return nexusProjectServiceExtensions;
}

function projectStatusExtensionContribution(
  projectRoot: string,
  projectConfig: NexusProjectConfig | undefined,
): Required<NexusProjectStatusExtensionContribution> {
  const contribution: Required<NexusProjectStatusExtensionContribution> = {
    plexusProjectConfigPath: null,
    plexusProjectConfigExists: false,
  };
  if (!projectConfig) {
    return contribution;
  }

  for (const extension of nexusProjectServiceExtensions) {
    const result = extension.projectStatus?.({
      projectRoot,
      projectConfig,
    });
    if (!result) {
      continue;
    }

    if (result.plexusProjectConfigPath !== undefined) {
      contribution.plexusProjectConfigPath = result.plexusProjectConfigPath;
    }
    if (result.plexusProjectConfigExists !== undefined) {
      contribution.plexusProjectConfigExists = result.plexusProjectConfigExists;
    }
  }

  return contribution;
}

function projectTrackerLinkExtensionContribution(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  trackerProjectId: string,
): Required<NexusProjectTrackerLinkExtensionContribution> {
  const contribution: Required<NexusProjectTrackerLinkExtensionContribution> = {
    plexusProjectConfigPath: null,
    plexusProjectConfig: null,
  };

  for (const extension of nexusProjectServiceExtensions) {
    const result = extension.linkProjectTracker?.({
      projectRoot,
      projectConfig,
      trackerProjectId,
    });
    if (!result) {
      continue;
    }

    if (result.plexusProjectConfigPath !== undefined) {
      contribution.plexusProjectConfigPath = result.plexusProjectConfigPath;
    }
    if (result.plexusProjectConfig !== undefined) {
      contribution.plexusProjectConfig = result.plexusProjectConfig;
    }
  }

  return contribution;
}

export function statusForProjectReference(
  reference: NexusProjectReference,
): NexusProjectStatus {
  const projectRoot = path.resolve(reference.projectRoot);
  const config = loadProjectConfigIfExists(projectRoot);
  const baseStatus = buildNexusProjectStatus(reference, {
    projectConfig: config,
  });
  const statusContribution = projectStatusExtensionContribution(
    projectRoot,
    config,
  );

  return {
    ...baseStatus,
    plexusProjectConfigPath: statusContribution.plexusProjectConfigPath,
    plexusProjectConfigExists: statusContribution.plexusProjectConfigExists,
  };
}

function statusForProjectPath(projectRoot: string): NexusProjectStatus {
  const baseStatus = buildNexusProjectStatusForPath(projectRoot);
  return statusForProjectReference({
    id: baseStatus.id,
    name: baseStatus.name,
    projectRoot: baseStatus.projectRoot,
    ...(baseStatus.vibeKanbanProjectId
      ? { vibeKanbanProjectId: baseStatus.vibeKanbanProjectId }
      : {}),
    ...(baseStatus.vibeKanbanRepoId
      ? { vibeKanbanRepoId: baseStatus.vibeKanbanRepoId }
      : {}),
  });
}

export function buildProjectConfig(
  name: string,
  projectId: string,
  from: string | undefined,
  defaultBranch: string | null,
  vibeKanbanProjectId: string | null = null,
  sourceRoot?: string | null,
  forceGit = false,
  extensions?: NexusProjectExtensionsConfig,
): NexusProjectConfig {
  return {
    version: 1,
    id: projectId,
    name,
    home: null,
    repo: {
      kind: from || sourceRoot || forceGit ? "git" : "local",
      remoteUrl: from ?? null,
      defaultBranch,
      ...(sourceRoot ? { sourceRoot } : {}),
    },
    worktreesRoot: nexusProjectWorktreesDirectoryName,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId,
    },
    ...(extensions ? { extensions } : {}),
  };
}

function buildConfiguredWorkTracking(
  options: ConfigureNexusProjectTrackerOptions,
): WorkTrackingConfig {
  if (options.provider === "local") {
    const storePath = optionalNonEmptyString(options.storePath, "storePath");
    return {
      provider: "local",
      ...(storePath !== undefined ? { storePath } : {}),
    };
  }

  if (options.provider === "github") {
    const owner = optionalNonEmptyString(
      options.repositoryOwner,
      "repositoryOwner",
    );
    const name = optionalNonEmptyString(options.repositoryName, "repositoryName");
    if (!owner) {
      throw new NexusProjectError(
        "repositoryOwner is required for github tracker configuration",
      );
    }
    if (!name) {
      throw new NexusProjectError(
        "repositoryName is required for github tracker configuration",
      );
    }

    const host = optionalNonEmptyString(options.host, "host");
    return {
      provider: "github",
      ...(host !== undefined ? { host } : {}),
      repository: {
        owner,
        name,
      },
    };
  }

  if (options.provider === "gitlab") {
    const id = optionalNonEmptyString(options.repositoryId, "repositoryId");
    if (!id) {
      throw new NexusProjectError(
        "repositoryId is required for gitlab tracker configuration",
      );
    }

    const host = optionalNonEmptyString(options.host, "host");
    return {
      provider: "gitlab",
      ...(host !== undefined ? { host } : {}),
      repository: {
        id,
      },
    };
  }

  if (options.provider === "jira") {
    const host = optionalNonEmptyString(options.host, "host");
    const projectKey = optionalNonEmptyString(options.projectKey, "projectKey");
    const issueType = optionalNonEmptyString(options.issueType, "issueType");
    if (!host) {
      throw new NexusProjectError(
        "host is required for jira tracker configuration",
      );
    }
    if (!projectKey) {
      throw new NexusProjectError(
        "projectKey is required for jira tracker configuration",
      );
    }

    return {
      provider: "jira",
      host,
      projectKey,
      ...(issueType !== undefined ? { issueType } : {}),
    };
  }

  throw new NexusProjectError(
    `Unsupported tracker provider: ${options.provider}`,
  );
}

export function upsertProjectReference(
  config: NexusHomeConfig,
  projectRoot: string,
  projectConfig: NexusProjectConfig,
  vibeKanbanProjectId: string | null,
  vibeKanbanRepoId?: string | null,
): NexusProjectReference {
  return upsertNexusProjectReference(config, projectRoot, projectConfig, {
    vibeKanbanProjectId,
    vibeKanbanRepoId,
  });
}

export function createNexusProject(
  options: CreateNexusProjectOptions,
): CreateNexusProjectResult {
  assertNonEmptyString(options.name, "name");
  const vibeKanbanProjectId =
    optionalNonEmptyString(options.vibeKanbanProjectId, "vibeKanbanProjectId") ??
    null;
  if (options.from && options.gitInit) {
    throw new NexusProjectError("--from and --git-init are mutually exclusive");
  }

  const homePath = resolveNexusHome(options.homePath);
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
  );
  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);

  assertFileDoesNotExist(devNexusProjectConfigPath);
  saveProjectConfig(projectRoot, projectConfig);
  scaffoldNexusProject({
    homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
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
    worktreesRoot,
    projectConfig,
    git: {
      operation: creatingFromRemote ? "clone" : "init",
      remoteUrl: options.from ?? null,
      defaultBranch,
      commands: gitCommands,
    },
  };
}

export function importNexusProject(
  options: ImportNexusProjectOptions,
): ImportNexusProjectResult {
  const homePath = resolveNexusHome(options.homePath);
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
  const projectName =
    existingProjectConfig?.name ?? options.name ?? path.basename(sourceRoot);
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
    existingProjectConfig ??
    buildProjectConfig(
      projectName,
      projectId,
      remoteUrl ?? undefined,
      defaultBranch,
      vibeKanbanProjectId,
      pathForProjectConfig(projectRoot, sourceRoot),
      true,
    );
  if (existingProjectConfig && vibeKanbanProjectId) {
    projectConfig.kanban = {
      ...projectConfig.kanban,
      projectId: vibeKanbanProjectId,
    };
  }

  const devNexusProjectConfigPath = projectConfigPath(projectRoot);
  if (!existingProjectConfig || vibeKanbanProjectId) {
    saveProjectConfig(projectRoot, projectConfig);
  }

  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  scaffoldNexusProject({
    homePath,
    projectRoot,
    worktreesRoot,
    projectConfig,
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
    worktreesRoot,
    projectConfig,
    git: {
      operation: "import",
      remoteUrl,
      defaultBranch,
      commands: gitCommands,
    },
  };
}

export function listNexusProjects(
  options: ListNexusProjectsOptions,
): ListNexusProjectsResult {
  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);

  return {
    homePath,
    projects: homeConfig.projects.map(statusForProjectReference),
  };
}

export function getNexusProjectStatus(
  options: GetNexusProjectStatusOptions,
): GetNexusProjectStatusResult {
  assertNonEmptyString(options.project, "project");

  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const projectSelector = options.project.trim();
  const reference =
    findNexusProjectReferenceById(homeConfig, projectSelector) ??
    findNexusProjectReferenceByPath(homeConfig, projectSelector);
  let project: NexusProjectStatus;
  if (reference) {
    project = statusForProjectReference(reference);
  } else {
    const projectRoot = projectRootFromInput(projectSelector);
    try {
      project = statusForProjectPath(projectRoot);
    } catch (error) {
      if (error instanceof NexusProjectError) {
        throw new NexusProjectError(
          `No registered project matched "${projectSelector}". ` +
            `Path fallback checked "${projectRoot}" and failed: ${error.message}`,
        );
      }

      throw error;
    }
  }

  return {
    homePath,
    project,
  };
}

export function linkNexusProjectTracker(
  options: LinkNexusProjectTrackerOptions,
): LinkNexusProjectTrackerResult {
  assertNonEmptyString(options.project, "project");
  const vibeKanbanProjectId = optionalNonEmptyString(
    options.trackerProjectId,
    "trackerProjectId",
  );
  if (!vibeKanbanProjectId) {
    throw new NexusProjectError("trackerProjectId must be a non-empty string");
  }

  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const existingReference = findNexusProjectReference(homeConfig, options.project);
  const projectRoot = existingReference
    ? path.resolve(existingReference.projectRoot)
    : projectRootFromInput(options.project);
  const projectConfig = loadProjectConfig(projectRoot);
  const updatedProjectConfig: NexusProjectConfig = {
    ...projectConfig,
    kanban: {
      ...projectConfig.kanban,
      projectId: vibeKanbanProjectId,
    },
  };
  const projectConfigFilePath = saveProjectConfig(projectRoot, updatedProjectConfig);
  const trackerLinkContribution = projectTrackerLinkExtensionContribution(
    projectRoot,
    updatedProjectConfig,
    vibeKanbanProjectId,
  );

  const reference = upsertProjectReference(
    homeConfig,
    projectRoot,
    updatedProjectConfig,
    vibeKanbanProjectId,
  );
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    vibeKanbanProjectId,
    vibeKanbanRepoId: reference.vibeKanbanRepoId ?? null,
    project: statusForProjectReference(reference),
    projectConfigPath: projectConfigFilePath,
    plexusProjectConfigPath: trackerLinkContribution.plexusProjectConfigPath,
    plexusProjectConfig: trackerLinkContribution.plexusProjectConfig,
  };
}

export function configureNexusProjectTracker(
  options: ConfigureNexusProjectTrackerOptions,
): ConfigureNexusProjectTrackerResult {
  assertNonEmptyString(options.project, "project");
  assertNonEmptyString(options.provider, "provider");

  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const existingReference = findNexusProjectReference(homeConfig, options.project);
  const projectRoot = existingReference
    ? path.resolve(existingReference.projectRoot)
    : projectRootFromInput(options.project);
  const projectConfig = loadProjectConfig(projectRoot);
  const workTracking = buildConfiguredWorkTracking(options);
  const updatedProjectConfig: NexusProjectConfig = {
    ...projectConfig,
    workTracking,
  };
  const projectConfigFilePath = saveProjectConfig(projectRoot, updatedProjectConfig);
  const reference = upsertProjectReference(
    homeConfig,
    projectRoot,
    updatedProjectConfig,
    null,
  );
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    project: statusForProjectReference(reference),
    projectConfigPath: projectConfigFilePath,
    plexusProjectConfigPath: projectStatusExtensionContribution(
      projectRoot,
      updatedProjectConfig,
    ).plexusProjectConfigPath,
    projectConfig: updatedProjectConfig,
    workTracking,
  };
}

