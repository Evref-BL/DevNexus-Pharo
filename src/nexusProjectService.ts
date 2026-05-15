import path from "node:path";
import {
  assertFileDoesNotExist,
  assertGitRepository,
  assertNonEmptyString,
  buildProjectConfig,
  buildNexusProjectStatus,
  buildNexusProjectStatusForPath,
  configureNexusProjectTrackerInRegistry,
  createNexusProjectInRegistry,
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
  importNexusProjectInRegistry,
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
  type ConfigureNexusProjectTrackerProvider,
  type NexusExtension,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
  type WorkTrackingConfig,
} from "dev-nexus";
import {
  loadHomeConfig,
  loadProjectConfig,
  resolveNexusHome,
  saveHomeConfig,
  saveProjectConfig,
  type NexusHomeConfig,
  type NexusProjectConfig,
  type NexusProjectReference,
} from "./config.js";

const defaultGitRunner = defaultProjectGitRunner;
const runGitCommand = runProjectGitCommand;
const safeDirectoryName = safeProjectDirectoryName;

export type GitCommandResult = ProjectGitCommandResult;
export type GitRunner = ProjectGitRunner;
export type { ConfigureNexusProjectTrackerProvider };

export {
  assertFileDoesNotExist,
  assertGitRepository,
  assertNonEmptyString,
  buildProjectConfig,
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
  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
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
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    worktreesRoot: result.worktreesRoot,
    projectConfig: result.projectConfig,
    git: result.git,
  };
}

export function importNexusProject(
  options: ImportNexusProjectOptions,
): ImportNexusProjectResult {
  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
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
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    worktreesRoot: result.worktreesRoot,
    projectConfig: result.projectConfig,
    git: result.git,
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
  const result = configureNexusProjectTrackerInRegistry({
    registry: homeConfig,
    project: options.project,
    provider: options.provider,
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.repositoryOwner !== undefined
      ? { repositoryOwner: options.repositoryOwner }
      : {}),
    ...(options.repositoryName !== undefined
      ? { repositoryName: options.repositoryName }
      : {}),
    ...(options.repositoryId !== undefined
      ? { repositoryId: options.repositoryId }
      : {}),
    ...(options.projectKey !== undefined ? { projectKey: options.projectKey } : {}),
    ...(options.issueType !== undefined ? { issueType: options.issueType } : {}),
    ...(options.storePath !== undefined ? { storePath: options.storePath } : {}),
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    project: statusForProjectReference(result.reference),
    projectConfigPath: result.projectConfigPath,
    plexusProjectConfigPath: projectStatusExtensionContribution(
      result.projectRoot,
      result.projectConfig,
    ).plexusProjectConfigPath,
    projectConfig: result.projectConfig,
    workTracking: result.workTracking,
  };
}

