import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  initCodexWorkspace,
  type InitCodexWorkspaceResult,
} from "./codexConfig.js";
import {
  loadHomeConfig,
  loadProjectConfig,
  pharoNexusProjectConfigFileName,
  pharoNexusProjectWorktreesDirectoryName,
  plexusProjectConfigFileName,
  projectConfigPath,
  projectPlexusConfigPath,
  projectWorktreesRootPath,
  resolvePharoNexusHome,
  saveHomeConfig,
  saveProjectConfig,
  type PharoNexusHomeConfig,
  type PharoNexusProjectConfig,
  type PharoNexusProjectReference,
} from "./config.js";
import {
  ensureVibeKanbanBoard,
  type EnsureVibeKanbanBoardResult,
} from "./vibeKanbanBoardAdapter.js";
import {
  registerVibeKanbanProject,
  type RegisterVibeKanbanProjectResult,
} from "./vibeKanbanProjectAdapter.js";

export interface PlexusProjectConfig {
  name: string;
  kanban: {
    provider: "vibe-kanban";
    projectId: string;
  };
  images: unknown[];
}

export interface GitCommandResult {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GitRunner = (args: readonly string[], cwd?: string) => GitCommandResult;

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
  codexConfigPath: string;
  projectConfig: PharoNexusProjectConfig;
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
  codexConfigPath: string;
  projectConfig: PharoNexusProjectConfig;
  plexusProjectConfig: PlexusProjectConfig;
  codex: InitCodexWorkspaceResult;
  git: {
    operation: "import";
    remoteUrl: string | null;
    defaultBranch: string | null;
    commands: GitCommandResult[];
  };
}

export interface PharoNexusProjectStatus {
  id: string;
  name: string;
  projectRoot: string;
  repo: PharoNexusProjectConfig["repo"] | null;
  vibeKanbanProjectId: string | null;
  vibeKanbanRepoId: string | null;
  projectConfigPath: string;
  projectConfigExists: boolean;
  plexusProjectConfigPath: string;
  plexusProjectConfigExists: boolean;
  worktreesRoot: string;
  worktreesRootExists: boolean;
}

export interface ListPharoNexusProjectsOptions {
  homePath: string;
}

export interface ListPharoNexusProjectsResult {
  homePath: string;
  projects: PharoNexusProjectStatus[];
}

export interface GetPharoNexusProjectStatusOptions {
  homePath: string;
  project: string;
}

export interface GetPharoNexusProjectStatusResult {
  homePath: string;
  project: PharoNexusProjectStatus;
}

export interface LinkPharoNexusProjectKanbanOptions {
  homePath: string;
  project: string;
  vibeKanbanProjectId: string;
}

export interface LinkPharoNexusProjectKanbanResult {
  homePath: string;
  vibeKanbanProjectId: string;
  vibeKanbanRepoId: string | null;
  project: PharoNexusProjectStatus;
  projectConfigPath: string;
  plexusProjectConfigPath: string;
  plexusProjectConfig: PlexusProjectConfig;
}

export interface SyncPharoNexusProjectKanbanOptions {
  homePath: string;
  project: string;
  host?: string;
  port?: number;
  fetch?: typeof fetch;
}

export interface SyncPharoNexusProjectKanbanResult
  extends LinkPharoNexusProjectKanbanResult {
  vibeKanbanRepoId: string;
  vibeKanbanRepo: RegisterVibeKanbanProjectResult;
  vibeKanbanBoard: EnsureVibeKanbanBoardResult;
  vibeKanban: {
    repo: RegisterVibeKanbanProjectResult;
    board: EnsureVibeKanbanBoardResult;
  };
}

export class PharoNexusProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PharoNexusProjectError";
  }
}

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new PharoNexusProjectError(`${name} must be a non-empty string`);
  }
}

function optionalNonEmptyString(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertNonEmptyString(value, name);
  return value.trim();
}

function slugify(value: string): string {
  const withWordBreaks = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
  const slug = withWordBreaks
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new PharoNexusProjectError(
      "Project name must contain at least one filesystem-safe character",
    );
  }

  return slug;
}

function safeDirectoryName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || slugify(value);
}

function directoryExistsAndIsNonEmpty(directoryPath: string): boolean {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }

  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    throw new PharoNexusProjectError(
      `Project root exists and is not a directory: ${directoryPath}`,
    );
  }

  return fs.readdirSync(directoryPath).length > 0;
}

function assertFileDoesNotExist(filePath: string): void {
  if (fs.existsSync(filePath)) {
    throw new PharoNexusProjectError(`Refusing to overwrite existing file: ${filePath}`);
  }
}

const defaultSourceCheckoutDirectoryName = "git";

function packageRootPath(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function defaultAgentsTemplatePath(): string {
  return path.join(packageRootPath(), "AGENTS.md");
}

function projectAgentsPath(projectRoot: string): string {
  return path.join(projectRoot, "AGENTS.md");
}

function installDefaultAgentsFile(projectRoot: string): string {
  const agentsPath = projectAgentsPath(projectRoot);
  if (fs.existsSync(agentsPath)) {
    return agentsPath;
  }

  const templatePath = defaultAgentsTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw new PharoNexusProjectError(
      `Default AGENTS.md template is missing: ${templatePath}`,
    );
  }

  fs.copyFileSync(templatePath, agentsPath);
  return agentsPath;
}

function defaultGitRunner(args: readonly string[], cwd?: string): GitCommandResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new PharoNexusProjectError(
      `Failed to run git ${args.join(" ")}: ${result.error.message}`,
    );
  }

  const commandResult: GitCommandResult = {
    args: [...args],
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };

  if (result.status !== 0) {
    throw new PharoNexusProjectError(
      `git ${args.join(" ")} failed with exit code ${result.status}: ${
        commandResult.stderr.trim() || commandResult.stdout.trim()
      }`,
    );
  }

  return commandResult;
}

function runGitCommand(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = gitRunner(args, cwd);
  commands.push(result);

  if (result.exitCode !== 0) {
    throw new PharoNexusProjectError(
      `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  return result;
}

function tryGitCommand(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  args: readonly string[],
  cwd?: string,
): GitCommandResult | undefined {
  try {
    return runGitCommand(gitRunner, commands, args, cwd);
  } catch {
    return undefined;
  }
}

function detectDefaultBranch(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  projectRoot: string,
): string | null {
  const result = tryGitCommand(
    gitRunner,
    commands,
    ["-C", projectRoot, "symbolic-ref", "--short", "HEAD"],
  );
  const branch = result?.stdout.trim();

  return branch && branch !== "HEAD" ? branch : null;
}

function assertGitRepository(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  projectRoot: string,
): void {
  const result = runGitCommand(
    gitRunner,
    commands,
    ["-C", projectRoot, "rev-parse", "--is-inside-work-tree"],
  );

  if (result.stdout.trim() !== "true") {
    throw new PharoNexusProjectError(
      `Path is not inside a Git work tree: ${projectRoot}`,
    );
  }
}

function detectOriginUrl(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  projectRoot: string,
): string | null {
  const result = tryGitCommand(
    gitRunner,
    commands,
    ["-C", projectRoot, "config", "--get", "remote.origin.url"],
  );
  const remoteUrl = result?.stdout.trim();

  return remoteUrl || null;
}

function ensureUniqueProject(
  config: PharoNexusHomeConfig,
  projectId: string,
  projectRoot: string,
): void {
  const normalizedRoot = path.resolve(projectRoot).toLowerCase();
  const duplicate = config.projects.find(
    (project) =>
      project.id === projectId ||
      path.resolve(project.plexusProjectRoot).toLowerCase() === normalizedRoot,
  );

  if (duplicate) {
    throw new PharoNexusProjectError(
      `Project is already registered: ${duplicate.id}`,
    );
  }
}

function normalizedPathForCompare(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function samePath(left: string, right: string): boolean {
  return normalizedPathForCompare(left) === normalizedPathForCompare(right);
}

function pathForProjectConfig(projectRoot: string, targetPath: string): string {
  const relative = path.relative(projectRoot, targetPath);
  if (
    relative &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  ) {
    return relative;
  }

  return path.resolve(targetPath);
}

function defaultImportedProjectRoot(
  homeConfig: PharoNexusHomeConfig,
  projectName: string,
  sourceRoot: string,
): string {
  const directoryName = safeDirectoryName(projectName);
  const candidate = path.join(homeConfig.paths.projectsRoot, directoryName);
  return samePath(candidate, sourceRoot)
    ? path.join(homeConfig.paths.projectsRoot, `${directoryName}-PharoNexus`)
    : candidate;
}

function loadProjectConfigIfExists(
  projectRoot: string,
): PharoNexusProjectConfig | undefined {
  if (!fs.existsSync(projectConfigPath(projectRoot))) {
    return undefined;
  }

  return loadProjectConfig(projectRoot);
}

function projectRootFromInput(input: string): string {
  const resolved = path.resolve(input);
  return path.basename(resolved) === pharoNexusProjectConfigFileName
    ? path.dirname(resolved)
    : resolved;
}

function statusForProjectReference(
  reference: PharoNexusProjectReference,
): PharoNexusProjectStatus {
  const projectRoot = path.resolve(reference.plexusProjectRoot);
  const config = loadProjectConfigIfExists(projectRoot);
  const resolvedProjectConfigPath = projectConfigPath(projectRoot);
  const resolvedPlexusProjectConfigPath = projectPlexusConfigPath(
    projectRoot,
    config,
  );
  const resolvedWorktreesRoot = projectWorktreesRootPath(projectRoot, config);

  return {
    id: config?.id ?? reference.id,
    name: config?.name ?? reference.name,
    projectRoot,
    repo: config?.repo ?? null,
    vibeKanbanProjectId:
      config?.kanban.projectId ?? reference.vibeKanbanProjectId ?? null,
    vibeKanbanRepoId: reference.vibeKanbanRepoId ?? null,
    projectConfigPath: resolvedProjectConfigPath,
    projectConfigExists: Boolean(config),
    plexusProjectConfigPath: resolvedPlexusProjectConfigPath,
    plexusProjectConfigExists: fs.existsSync(resolvedPlexusProjectConfigPath),
    worktreesRoot: resolvedWorktreesRoot,
    worktreesRootExists: fs.existsSync(resolvedWorktreesRoot),
  };
}

function statusForProjectPath(projectRoot: string): PharoNexusProjectStatus {
  const config = loadProjectConfigIfExists(projectRoot);
  if (!config) {
    throw new PharoNexusProjectError(
      `PharoNexus project is not initialized: ${projectConfigPath(projectRoot)}`,
    );
  }

  return statusForProjectReference({
    id: config.id,
    name: config.name,
    plexusProjectRoot: projectRoot,
    ...(config.kanban.projectId
      ? { vibeKanbanProjectId: config.kanban.projectId }
      : {}),
  });
}

function findProjectReference(
  config: PharoNexusHomeConfig,
  idOrPath: string,
): PharoNexusProjectReference | undefined {
  const byId = config.projects.find((project) => project.id === idOrPath);
  if (byId) {
    return byId;
  }

  const projectRoot = projectRootFromInput(idOrPath);
  return config.projects.find((project) =>
    samePath(project.plexusProjectRoot, projectRoot),
  );
}

function saveJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")) as T;
}

function buildProjectConfig(
  name: string,
  projectId: string,
  from: string | undefined,
  defaultBranch: string | null,
  vibeKanbanProjectId: string | null = null,
  sourceRoot?: string | null,
  forceGit = false,
): PharoNexusProjectConfig {
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
    plexusProjectConfig: plexusProjectConfigFileName,
    worktreesRoot: pharoNexusProjectWorktreesDirectoryName,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId,
    },
  };
}

function buildPlexusProjectConfig(
  name: string,
  projectId: string,
  vibeKanbanProjectId: string | null = null,
): PlexusProjectConfig {
  return {
    name,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId ?? projectId,
    },
    images: [],
  };
}

function updatePlexusProjectKanban(
  plexusConfigPath: string,
  projectName: string,
  projectId: string,
  vibeKanbanProjectId: string,
): PlexusProjectConfig {
  const existing = fs.existsSync(plexusConfigPath)
    ? readJsonFile<Record<string, unknown>>(plexusConfigPath)
    : buildPlexusProjectConfig(projectName, projectId, vibeKanbanProjectId);
  const existingKanban =
    existing.kanban && typeof existing.kanban === "object" && !Array.isArray(existing.kanban)
      ? (existing.kanban as Record<string, unknown>)
      : {};
  const updated = {
    ...existing,
    name: typeof existing.name === "string" ? existing.name : projectName,
    kanban: {
      ...existingKanban,
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId,
    },
    images: Array.isArray(existing.images) ? existing.images : [],
  } as unknown as PlexusProjectConfig;

  saveJsonFile(plexusConfigPath, updated);
  return updated;
}

function upsertProjectReference(
  config: PharoNexusHomeConfig,
  projectRoot: string,
  projectConfig: PharoNexusProjectConfig,
  vibeKanbanProjectId: string | null,
  vibeKanbanRepoId?: string | null,
): PharoNexusProjectReference {
  const existingIndex = config.projects.findIndex((project) =>
    samePath(project.plexusProjectRoot, projectRoot),
  );
  const existing =
    existingIndex >= 0 ? config.projects[existingIndex] : undefined;
  const resolvedVibeKanbanProjectId =
    vibeKanbanProjectId ?? projectConfig.kanban.projectId ?? existing?.vibeKanbanProjectId ?? null;
  const resolvedVibeKanbanRepoId =
    vibeKanbanRepoId ?? existing?.vibeKanbanRepoId ?? null;
  const reference: PharoNexusProjectReference = {
    id: projectConfig.id,
    name: projectConfig.name,
    plexusProjectRoot: projectRoot,
    ...(resolvedVibeKanbanProjectId
      ? { vibeKanbanProjectId: resolvedVibeKanbanProjectId }
      : {}),
    ...(resolvedVibeKanbanRepoId
      ? { vibeKanbanRepoId: resolvedVibeKanbanRepoId }
      : {}),
  };

  if (existingIndex >= 0) {
    config.projects[existingIndex] = reference;
    return reference;
  }

  const duplicateId = config.projects.find(
    (project) => project.id === projectConfig.id,
  );
  if (duplicateId) {
    throw new PharoNexusProjectError(
      `Project id is already registered at another root: ${duplicateId.id}`,
    );
  }

  ensureUniqueProject(config, projectConfig.id, projectRoot);
  config.projects.push(reference);
  return reference;
}

export function createPharoNexusProject(
  options: CreatePharoNexusProjectOptions,
): CreatePharoNexusProjectResult {
  assertNonEmptyString(options.name, "name");
  const vibeKanbanProjectId =
    optionalNonEmptyString(options.vibeKanbanProjectId, "vibeKanbanProjectId") ??
    null;
  if (options.from && options.gitInit) {
    throw new PharoNexusProjectError("--from and --git-init are mutually exclusive");
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
    throw new PharoNexusProjectError(
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
  const plexusProjectConfig = buildPlexusProjectConfig(
    options.name,
    projectId,
    vibeKanbanProjectId,
  );
  const pharoNexusProjectConfigPath = projectConfigPath(projectRoot);
  const plexusConfigPath = projectPlexusConfigPath(projectRoot, projectConfig);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);

  assertFileDoesNotExist(pharoNexusProjectConfigPath);
  assertFileDoesNotExist(plexusConfigPath);
  saveProjectConfig(projectRoot, projectConfig);
  saveJsonFile(plexusConfigPath, plexusProjectConfig);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const codex = initCodexWorkspace({
    homePath,
    workspacePath: projectRoot,
    config: homeConfig,
  });
  const agentsPath = installDefaultAgentsFile(projectRoot);

  homeConfig.projects.push({
    id: projectId,
    name: options.name,
    plexusProjectRoot: projectRoot,
    ...(vibeKanbanProjectId ? { vibeKanbanProjectId } : {}),
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot,
    projectConfigPath: pharoNexusProjectConfigPath,
    plexusProjectConfigPath: plexusConfigPath,
    worktreesRoot,
    agentsPath,
    codexConfigPath: codex.configPath,
    projectConfig,
    plexusProjectConfig,
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
  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const vibeKanbanProjectId =
    optionalNonEmptyString(options.vibeKanbanProjectId, "vibeKanbanProjectId") ??
    null;
  const sourceRoot = path.resolve(options.root);
  if (!fs.existsSync(sourceRoot) || !fs.statSync(sourceRoot).isDirectory()) {
    throw new PharoNexusProjectError(
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
    throw new PharoNexusProjectError(
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

  const pharoNexusProjectConfigPath = projectConfigPath(projectRoot);
  if (!existingProjectConfig || vibeKanbanProjectId) {
    saveProjectConfig(projectRoot, projectConfig);
  }

  const plexusConfigPath = projectPlexusConfigPath(projectRoot, projectConfig);
  let plexusProjectConfig = fs.existsSync(plexusConfigPath)
    ? readJsonFile<PlexusProjectConfig>(plexusConfigPath)
    : buildPlexusProjectConfig(
        projectConfig.name,
        projectConfig.id,
        projectConfig.kanban.projectId,
      );
  if (!fs.existsSync(plexusConfigPath)) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
  } else if (vibeKanbanProjectId) {
    plexusProjectConfig = updatePlexusProjectKanban(
      plexusConfigPath,
      projectConfig.name,
      projectConfig.id,
      vibeKanbanProjectId,
    );
  }

  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  fs.mkdirSync(worktreesRoot, { recursive: true });
  const codex = initCodexWorkspace({
    homePath,
    workspacePath: projectRoot,
    config: homeConfig,
  });
  const agentsPath = installDefaultAgentsFile(projectRoot);

  homeConfig.projects.push({
    id: projectConfig.id,
    name: projectConfig.name,
    plexusProjectRoot: projectRoot,
    ...(projectConfig.kanban.projectId
      ? { vibeKanbanProjectId: projectConfig.kanban.projectId }
      : {}),
  });
  saveHomeConfig(homePath, homeConfig);

  return {
    homePath,
    projectRoot,
    projectConfigPath: pharoNexusProjectConfigPath,
    plexusProjectConfigPath: plexusConfigPath,
    worktreesRoot,
    agentsPath,
    codexConfigPath: codex.configPath,
    projectConfig,
    plexusProjectConfig,
    codex,
    git: {
      operation: "import",
      remoteUrl,
      defaultBranch,
      commands: gitCommands,
    },
  };
}

export function listPharoNexusProjects(
  options: ListPharoNexusProjectsOptions,
): ListPharoNexusProjectsResult {
  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);

  return {
    homePath,
    projects: homeConfig.projects.map(statusForProjectReference),
  };
}

export function getPharoNexusProjectStatus(
  options: GetPharoNexusProjectStatusOptions,
): GetPharoNexusProjectStatusResult {
  assertNonEmptyString(options.project, "project");

  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const reference = findProjectReference(homeConfig, options.project);
  const project = reference
    ? statusForProjectReference(reference)
    : statusForProjectPath(projectRootFromInput(options.project));

  return {
    homePath,
    project,
  };
}

export function linkPharoNexusProjectKanban(
  options: LinkPharoNexusProjectKanbanOptions,
): LinkPharoNexusProjectKanbanResult {
  assertNonEmptyString(options.project, "project");
  const vibeKanbanProjectId = optionalNonEmptyString(
    options.vibeKanbanProjectId,
    "vibeKanbanProjectId",
  );
  if (!vibeKanbanProjectId) {
    throw new PharoNexusProjectError("vibeKanbanProjectId must be a non-empty string");
  }

  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const existingReference = findProjectReference(homeConfig, options.project);
  const projectRoot = existingReference
    ? path.resolve(existingReference.plexusProjectRoot)
    : projectRootFromInput(options.project);
  const projectConfig = loadProjectConfig(projectRoot);
  const updatedProjectConfig: PharoNexusProjectConfig = {
    ...projectConfig,
    kanban: {
      ...projectConfig.kanban,
      projectId: vibeKanbanProjectId,
    },
  };
  const projectConfigFilePath = saveProjectConfig(projectRoot, updatedProjectConfig);
  const plexusConfigPath = projectPlexusConfigPath(projectRoot, updatedProjectConfig);
  const plexusProjectConfig = updatePlexusProjectKanban(
    plexusConfigPath,
    updatedProjectConfig.name,
    updatedProjectConfig.id,
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
    plexusProjectConfigPath: plexusConfigPath,
    plexusProjectConfig,
  };
}

export async function syncPharoNexusProjectKanban(
  options: SyncPharoNexusProjectKanbanOptions,
): Promise<SyncPharoNexusProjectKanbanResult> {
  assertNonEmptyString(options.project, "project");

  const homePath = resolvePharoNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const status = getPharoNexusProjectStatus({
    homePath,
    project: options.project,
  }).project;
  const vibeKanban = await registerVibeKanbanProject({
    host: options.host,
    port: options.port ?? homeConfig.ports.vibeKanban,
    fetch: options.fetch,
    projectRoot: status.projectRoot,
    name: status.name,
  });
  const vibeKanbanBoard = await ensureVibeKanbanBoard({
    host: options.host,
    port: options.port ?? homeConfig.ports.vibeKanban,
    fetch: options.fetch,
    name: status.name,
  });
  const linked = linkPharoNexusProjectKanban({
    homePath,
    project: status.projectRoot,
    vibeKanbanProjectId: vibeKanbanBoard.boardId,
  });
  const updatedHomeConfig = loadHomeConfig(homePath);
  const projectConfig = loadProjectConfig(status.projectRoot);
  const reference = upsertProjectReference(
    updatedHomeConfig,
    status.projectRoot,
    projectConfig,
    vibeKanbanBoard.boardId,
    vibeKanban.projectId,
  );
  saveHomeConfig(homePath, updatedHomeConfig);

  return {
    ...linked,
    vibeKanbanProjectId: vibeKanbanBoard.boardId,
    vibeKanbanRepoId: vibeKanban.projectId,
    project: statusForProjectReference(reference),
    vibeKanbanRepo: vibeKanban,
    vibeKanbanBoard,
    vibeKanban: {
      repo: vibeKanban,
      board: vibeKanbanBoard,
    },
  };
}
