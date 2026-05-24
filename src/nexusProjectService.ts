import {
  assertFileDoesNotExist,
  assertGitRepository,
  assertNonEmptyString,
  buildProjectConfig,
  buildNexusProjectStatus,
  buildNexusProjectStatusForPath,
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
  type NexusExtension,
  type NexusProjectHomeStore,
  type NexusProjectStatusBase,
  type ProjectGitCommandResult,
  type ProjectGitRunner,
  type WorkTrackingConfig,
} from "dev-nexus";
import {
  loadProjectConfigIfExists,
  loadHomeConfig,
  resolveNexusHome,
  saveHomeConfig,
  type NexusHomeConfig,
  type NexusProjectConfig,
  type NexusProjectReference,
} from "./config.js";

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
  gitRunner?: GitRunner;
}

export interface ImportNexusProjectOptions {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
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
  defaultTrackerId: NexusProjectStatusBase["defaultTrackerId"];
  workTrackers: NexusProjectStatusBase["workTrackers"];
  workTracking: WorkTrackingConfig | null;
  workTrackingCapabilities: NexusProjectStatusBase["workTrackingCapabilities"];
  workTrackingCapabilityReport: NexusProjectStatusBase["workTrackingCapabilityReport"];
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

export interface NexusProjectStatusExtensionContribution {
  plexusProjectConfigPath?: string | null;
  plexusProjectConfigExists?: boolean;
}

export type NexusProjectServiceExtension = NexusExtension<
  NexusProjectConfig,
  unknown,
  NexusProjectStatusExtensionContribution | undefined
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
    id: baseStatus.id,
    name: baseStatus.name,
    projectRoot: baseStatus.projectRoot,
    repo: baseStatus.repo,
    components: baseStatus.components,
    defaultTrackerId: baseStatus.defaultTrackerId,
    workTrackers: baseStatus.workTrackers,
    workTracking: baseStatus.workTracking,
    workTrackingCapabilities: baseStatus.workTrackingCapabilities,
    workTrackingCapabilityReport: baseStatus.workTrackingCapabilityReport,
    projectConfigPath: baseStatus.projectConfigPath,
    projectConfigExists: baseStatus.projectConfigExists,
    worktreesRoot: baseStatus.worktreesRoot,
    worktreesRootExists: baseStatus.worktreesRootExists,
    plexusProjectConfigPath: statusContribution.plexusProjectConfigPath,
    plexusProjectConfigExists: statusContribution.plexusProjectConfigExists,
  };
}

export function upsertProjectReference(
  config: NexusHomeConfig,
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): NexusProjectReference {
  return upsertNexusProjectReference(config, projectRoot, projectConfig);
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
