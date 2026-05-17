import {
  assertFileDoesNotExist,
  assertGitRepository,
  assertNonEmptyString,
  buildProjectConfig,
  buildNexusProjectStatus,
  buildNexusProjectStatusForPath,
  configureNexusProjectTracker as configureNexusProjectTrackerFromHome,
  createNexusProject as createNexusProjectFromHome,
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
  getNexusProjectStatus as getNexusProjectStatusFromHome,
  importNexusProject as importNexusProjectFromHome,
  loadProjectConfigIfExists,
  linkNexusProjectTrackerInRegistry,
  listNexusProjects as listNexusProjectsFromHome,
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
  statusForNexusProjectReference,
  upsertNexusProjectReference,
  type ConfigureNexusProjectTrackerProvider,
  type NexusExtension,
  type NexusProjectHomeStore,
  type NexusProjectStatusBase,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
  type WorkTrackingConfig,
} from "dev-nexus";
import {
  loadHomeConfig,
  resolveNexusHome,
  saveHomeConfig,
  type NexusHomeConfig,
  type NexusProjectConfig,
  type NexusProjectReference,
} from "./config.js";
import {
  legacyTrackerWrapperDeprecation,
  type LegacyTrackerWrapperDeprecation,
} from "./trackerDeprecation.js";

const defaultGitRunner = defaultProjectGitRunner;
const runGitCommand = runProjectGitCommand;
const safeDirectoryName = safeProjectDirectoryName;

const nexusProjectHomeStore: NexusProjectHomeStore = {
  resolveHomePath: resolveNexusHome,
  loadHomeConfig: (homePath) => loadHomeConfig(homePath),
  saveHomeConfig: (homePath, registry) =>
    saveHomeConfig(homePath, registry as NexusHomeConfig),
};

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
  components: NexusProjectStatusBase["components"];
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
  deprecation: LegacyTrackerWrapperDeprecation;
}

export interface LinkNexusProjectTrackerResult {
  homePath: string;
  vibeKanbanProjectId: string;
  vibeKanbanRepoId: string | null;
  project: NexusProjectStatus;
  projectConfigPath: string;
  plexusProjectConfigPath: string | null;
  plexusProjectConfig: unknown | null;
  deprecation: LegacyTrackerWrapperDeprecation;
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
  const baseStatus = statusForNexusProjectReference(reference);
  return statusForProjectStatusBase(baseStatus);
}

function statusForProjectStatusBase(
  baseStatus: NexusProjectStatusBase,
): NexusProjectStatus {
  const config = loadProjectConfigIfExists(baseStatus.projectRoot);
  const statusContribution = projectStatusExtensionContribution(
    baseStatus.projectRoot,
    config,
  );

  return {
    ...baseStatus,
    plexusProjectConfigPath: statusContribution.plexusProjectConfigPath,
    plexusProjectConfigExists: statusContribution.plexusProjectConfigExists,
  };
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
  const result = createNexusProjectFromHome({
    homePath: options.homePath,
    homeStore: nexusProjectHomeStore,
    name: options.name,
    ...(options.root !== undefined ? { root: options.root } : {}),
    ...(options.from !== undefined ? { from: options.from } : {}),
    ...(options.gitInit !== undefined ? { gitInit: options.gitInit } : {}),
    ...(options.vibeKanbanProjectId !== undefined
      ? { vibeKanbanProjectId: options.vibeKanbanProjectId }
      : {}),
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
  });

  return {
    homePath: result.homePath,
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
  const result = importNexusProjectFromHome({
    homePath: options.homePath,
    homeStore: nexusProjectHomeStore,
    root: options.root,
    ...(options.projectRoot !== undefined ? { projectRoot: options.projectRoot } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.vibeKanbanProjectId !== undefined
      ? { vibeKanbanProjectId: options.vibeKanbanProjectId }
      : {}),
    ...(options.gitRunner ? { gitRunner: options.gitRunner } : {}),
  });

  return {
    homePath: result.homePath,
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
  const result = listNexusProjectsFromHome({
    homePath: options.homePath,
    homeStore: nexusProjectHomeStore,
  });

  return {
    homePath: result.homePath,
    projects: result.projects.map(statusForProjectStatusBase),
  };
}

export function getNexusProjectStatus(
  options: GetNexusProjectStatusOptions,
): GetNexusProjectStatusResult {
  const result = getNexusProjectStatusFromHome({
    homePath: options.homePath,
    homeStore: nexusProjectHomeStore,
    project: options.project,
  });

  return {
    homePath: result.homePath,
    project: statusForProjectStatusBase(result.project),
  };
}

/**
 * @deprecated Generic tracker linking belongs to DevNexus core. This wrapper is
 * retained only for DevNexus-Pharo legacy compatibility.
 */
export function linkNexusProjectTracker(
  options: LinkNexusProjectTrackerOptions,
): LinkNexusProjectTrackerResult {
  assertNonEmptyString(options.project, "project");

  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const linked = linkNexusProjectTrackerInRegistry({
    registry: homeConfig,
    project: options.project,
    trackerProjectId: options.trackerProjectId,
  });
  const trackerLinkContribution = projectTrackerLinkExtensionContribution(
    linked.projectRoot,
    linked.projectConfig,
    linked.vibeKanbanProjectId,
  );
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    vibeKanbanProjectId: linked.vibeKanbanProjectId,
    vibeKanbanRepoId: linked.vibeKanbanRepoId,
    project: statusForProjectReference(linked.reference),
    projectConfigPath: linked.projectConfigPath,
    plexusProjectConfigPath: trackerLinkContribution.plexusProjectConfigPath,
    plexusProjectConfig: trackerLinkContribution.plexusProjectConfig,
    deprecation: legacyTrackerWrapperDeprecation("link-tracker"),
  };
}

/**
 * @deprecated Generic tracker configuration belongs to DevNexus core. This
 * wrapper is retained only for DevNexus-Pharo legacy compatibility.
 */
export function configureNexusProjectTracker(
  options: ConfigureNexusProjectTrackerOptions,
): ConfigureNexusProjectTrackerResult {
  const result = configureNexusProjectTrackerFromHome({
    homePath: options.homePath,
    homeStore: nexusProjectHomeStore,
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

  return {
    homePath: result.homePath,
    project: statusForProjectStatusBase(result.project),
    projectConfigPath: result.projectConfigPath,
    plexusProjectConfigPath: projectStatusExtensionContribution(
      result.projectRoot,
      result.projectConfig,
    ).plexusProjectConfigPath,
    projectConfig: result.projectConfig,
    workTracking: result.workTracking,
    deprecation: legacyTrackerWrapperDeprecation("configure-tracker"),
  };
}

