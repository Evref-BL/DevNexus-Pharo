import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";
import type { NexusExtension } from "./nexusExtension.js";
import {
  loadHomeConfig,
  loadProjectConfig,
  devNexusProjectConfigFileName,
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
import type {
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export interface GitCommandResult {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GitRunner = (args: readonly string[], cwd?: string) => GitCommandResult;

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

export class NexusProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NexusProjectError";
  }
}

export function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new NexusProjectError(`${name} must be a non-empty string`);
  }
}

export function optionalNonEmptyString(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  assertNonEmptyString(value, name);
  return value.trim();
}

export function slugify(value: string): string {
  const withWordBreaks = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2");
  const slug = withWordBreaks
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new NexusProjectError(
      "Project name must contain at least one filesystem-safe character",
    );
  }

  return slug;
}

export function safeDirectoryName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || slugify(value);
}

export function directoryExistsAndIsNonEmpty(directoryPath: string): boolean {
  if (!fs.existsSync(directoryPath)) {
    return false;
  }

  const stat = fs.statSync(directoryPath);
  if (!stat.isDirectory()) {
    throw new NexusProjectError(
      `Project root exists and is not a directory: ${directoryPath}`,
    );
  }

  return fs.readdirSync(directoryPath).length > 0;
}

export function assertFileDoesNotExist(filePath: string): void {
  if (fs.existsSync(filePath)) {
    throw new NexusProjectError(`Refusing to overwrite existing file: ${filePath}`);
  }
}

export const defaultSourceCheckoutDirectoryName = "git";

export function resolveProjectSourceRoot(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  const sourceRoot = projectConfig.repo.sourceRoot;
  if (!sourceRoot) {
    return path.resolve(projectRoot);
  }

  return path.isAbsolute(sourceRoot)
    ? path.resolve(sourceRoot)
    : path.resolve(projectRoot, sourceRoot);
}

function powershellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function buildWindowsVibeKanbanWorkspaceSetupScript(
  managedRoot: string,
  sourceRoot: string,
): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    `$managedRoot = ${powershellSingleQuoted(path.resolve(managedRoot))}`,
    `$sourceRoot = ${powershellSingleQuoted(path.resolve(sourceRoot))}`,
    "$workspaceRoot = (Get-Location).Path",
    "",
    "function Add-GitInfoExclude([string] $entry) {",
    "  $excludePath = git rev-parse --git-path info/exclude",
    "  if (-not (Test-Path -LiteralPath $excludePath)) {",
    "    New-Item -ItemType File -Path $excludePath -Force | Out-Null",
    "  }",
    "  $existing = Get-Content -LiteralPath $excludePath -ErrorAction SilentlyContinue",
    "  if ($existing -notcontains $entry) {",
    "    Add-Content -LiteralPath $excludePath -Value $entry",
    "  }",
    "}",
    "",
    "$agentsSource = Join-Path $managedRoot 'AGENTS.md'",
    "$agentsTarget = Join-Path $workspaceRoot 'AGENTS.md'",
    "if ((Test-Path -LiteralPath $agentsSource) -and -not (Test-Path -LiteralPath $agentsTarget)) {",
    "  Copy-Item -LiteralPath $agentsSource -Destination $agentsTarget -Force",
    "  Add-GitInfoExclude 'AGENTS.md'",
    "}",
    "",
    "$codexSource = Join-Path $managedRoot '.codex'",
    "$codexTarget = Join-Path $workspaceRoot '.codex'",
    "if ((Test-Path -LiteralPath $codexSource) -and -not (Test-Path -LiteralPath (Join-Path $codexTarget 'config.toml'))) {",
    "  New-Item -ItemType Directory -Path $codexTarget -Force | Out-Null",
    "  Copy-Item -Path (Join-Path $codexSource '*') -Destination $codexTarget -Recurse -Force",
    "  Add-GitInfoExclude '.codex/'",
    "}",
    "",
    "$sourceNodeModules = Join-Path $sourceRoot 'node_modules'",
    "$workspaceNodeModules = Join-Path $workspaceRoot 'node_modules'",
    "if ((Test-Path -LiteralPath $sourceNodeModules) -and -not (Test-Path -LiteralPath $workspaceNodeModules)) {",
    "  New-Item -ItemType Junction -Path $workspaceNodeModules -Target $sourceNodeModules | Out-Null",
    "  Add-GitInfoExclude 'node_modules/'",
    "} elseif (-not (Test-Path -LiteralPath $sourceNodeModules)) {",
    "  Write-Host \"Source checkout has no node_modules at $sourceNodeModules; skipping dependency junction.\"",
    "}",
    "",
    "Write-Host 'Vibe workspace setup complete for PharoNexus-managed project.'",
  ].join("\n");
}

function shellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function buildPosixVibeKanbanWorkspaceSetupScript(
  managedRoot: string,
  sourceRoot: string,
): string {
  return [
    "set -eu",
    `managed_root=${shellSingleQuoted(path.resolve(managedRoot))}`,
    `source_root=${shellSingleQuoted(path.resolve(sourceRoot))}`,
    "workspace_root=$(pwd)",
    "",
    "add_git_info_exclude() {",
    "  entry=$1",
    "  exclude_path=$(git rev-parse --git-path info/exclude)",
    "  mkdir -p \"$(dirname \"$exclude_path\")\"",
    "  touch \"$exclude_path\"",
    "  if ! grep -Fxq \"$entry\" \"$exclude_path\"; then",
    "    printf '%s\\n' \"$entry\" >> \"$exclude_path\"",
    "  fi",
    "}",
    "",
    "if [ -f \"$managed_root/AGENTS.md\" ] && [ ! -e \"$workspace_root/AGENTS.md\" ]; then",
    "  cp \"$managed_root/AGENTS.md\" \"$workspace_root/AGENTS.md\"",
    "  add_git_info_exclude 'AGENTS.md'",
    "fi",
    "",
    "if [ -d \"$managed_root/.codex\" ] && [ ! -f \"$workspace_root/.codex/config.toml\" ]; then",
    "  mkdir -p \"$workspace_root/.codex\"",
    "  cp -R \"$managed_root/.codex/.\" \"$workspace_root/.codex/\"",
    "  add_git_info_exclude '.codex/'",
    "fi",
    "",
    "if [ -d \"$source_root/node_modules\" ] && [ ! -e \"$workspace_root/node_modules\" ]; then",
    "  ln -s \"$source_root/node_modules\" \"$workspace_root/node_modules\"",
    "  add_git_info_exclude 'node_modules/'",
    "elif [ ! -d \"$source_root/node_modules\" ]; then",
    "  printf '%s\\n' \"Source checkout has no node_modules at $source_root/node_modules; skipping dependency link.\"",
    "fi",
    "",
    "printf '%s\\n' 'Vibe workspace setup complete for PharoNexus-managed project.'",
  ].join("\n");
}

export function buildVibeKanbanWorkspaceSetupScript(
  managedRoot: string,
  sourceRoot: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32"
    ? buildWindowsVibeKanbanWorkspaceSetupScript(managedRoot, sourceRoot)
    : buildPosixVibeKanbanWorkspaceSetupScript(managedRoot, sourceRoot);
}

export function defaultGitRunner(args: readonly string[], cwd?: string): GitCommandResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new NexusProjectError(
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
    throw new NexusProjectError(
      `git ${args.join(" ")} failed with exit code ${result.status}: ${
        commandResult.stderr.trim() || commandResult.stdout.trim()
      }`,
    );
  }

  return commandResult;
}

export function runGitCommand(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = gitRunner(args, cwd);
  commands.push(result);

  if (result.exitCode !== 0) {
    throw new NexusProjectError(
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

export function detectDefaultBranch(
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

export function assertGitRepository(
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
    throw new NexusProjectError(
      `Path is not inside a Git work tree: ${projectRoot}`,
    );
  }
}

export function detectOriginUrl(
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

export function ensureUniqueProject(
  config: NexusHomeConfig,
  projectId: string,
  projectRoot: string,
): void {
  const normalizedRoot = path.resolve(projectRoot).toLowerCase();
  const duplicate = config.projects.find(
    (project) =>
      project.id === projectId ||
      path.resolve(project.projectRoot).toLowerCase() === normalizedRoot,
  );

  if (duplicate) {
    throw new NexusProjectError(
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

export function pathForProjectConfig(projectRoot: string, targetPath: string): string {
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

export function defaultImportedProjectRoot(
  homeConfig: NexusHomeConfig,
  projectName: string,
  sourceRoot: string,
): string {
  const directoryName = safeDirectoryName(projectName);
  const candidate = path.join(homeConfig.paths.projectsRoot, directoryName);
  return samePath(candidate, sourceRoot)
    ? path.join(homeConfig.paths.projectsRoot, `${directoryName}-PharoNexus`)
    : candidate;
}

export function loadProjectConfigIfExists(
  projectRoot: string,
): NexusProjectConfig | undefined {
  if (!fs.existsSync(projectConfigPath(projectRoot))) {
    return undefined;
  }

  return loadProjectConfig(projectRoot);
}

function projectRootFromInput(input: string): string {
  const resolved = path.resolve(input);
  return path.basename(resolved) === devNexusProjectConfigFileName
    ? path.dirname(resolved)
    : resolved;
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
  const resolvedProjectConfigPath = projectConfigPath(projectRoot);
  const statusContribution = projectStatusExtensionContribution(
    projectRoot,
    config,
  );
  const resolvedWorktreesRoot = projectWorktreesRootPath(projectRoot, config);

  return {
    id: config?.id ?? reference.id,
    name: config?.name ?? reference.name,
    projectRoot,
    repo: config?.repo ?? null,
    workTracking: config?.workTracking ?? null,
    vibeKanbanProjectId:
      config?.kanban.projectId ?? reference.vibeKanbanProjectId ?? null,
    vibeKanbanRepoId: reference.vibeKanbanRepoId ?? null,
    projectConfigPath: resolvedProjectConfigPath,
    projectConfigExists: Boolean(config),
    plexusProjectConfigPath: statusContribution.plexusProjectConfigPath,
    plexusProjectConfigExists: statusContribution.plexusProjectConfigExists,
    worktreesRoot: resolvedWorktreesRoot,
    worktreesRootExists: fs.existsSync(resolvedWorktreesRoot),
  };
}

function statusForProjectPath(projectRoot: string): NexusProjectStatus {
  const config = loadProjectConfigIfExists(projectRoot);
  if (!config) {
    throw new NexusProjectError(
      `PharoNexus project is not initialized: ${projectConfigPath(projectRoot)}`,
    );
  }

  return statusForProjectReference({
    id: config.id,
    name: config.name,
    projectRoot: projectRoot,
    ...(config.kanban.projectId
      ? { vibeKanbanProjectId: config.kanban.projectId }
      : {}),
  });
}

function findProjectReferenceById(
  config: NexusHomeConfig,
  id: string,
): NexusProjectReference | undefined {
  return (
    config.projects.find((project) => project.id === id) ??
    config.projects.find(
      (project) =>
        loadProjectConfigIfExists(path.resolve(project.projectRoot))?.id === id,
    )
  );
}

function findProjectReferenceByPath(
  config: NexusHomeConfig,
  projectPath: string,
): NexusProjectReference | undefined {
  const projectRoot = projectRootFromInput(projectPath);
  return config.projects.find((project) =>
    samePath(project.projectRoot, projectRoot),
  );
}

function findProjectReference(
  config: NexusHomeConfig,
  idOrPath: string,
): NexusProjectReference | undefined {
  return (
    findProjectReferenceById(config, idOrPath) ??
    findProjectReferenceByPath(config, idOrPath)
  );
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
  const existingIndex = config.projects.findIndex((project) =>
    samePath(project.projectRoot, projectRoot),
  );
  const existing =
    existingIndex >= 0 ? config.projects[existingIndex] : undefined;
  const resolvedVibeKanbanProjectId =
    vibeKanbanProjectId ?? projectConfig.kanban.projectId ?? existing?.vibeKanbanProjectId ?? null;
  const resolvedVibeKanbanRepoId =
    vibeKanbanRepoId ?? existing?.vibeKanbanRepoId ?? null;
  const reference: NexusProjectReference = {
    id: projectConfig.id,
    name: projectConfig.name,
    projectRoot: projectRoot,
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
    throw new NexusProjectError(
      `Project id is already registered at another root: ${duplicateId.id}`,
    );
  }

  ensureUniqueProject(config, projectConfig.id, projectRoot);
  config.projects.push(reference);
  return reference;
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
    findProjectReferenceById(homeConfig, projectSelector) ??
    findProjectReferenceByPath(homeConfig, projectSelector);
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
  const existingReference = findProjectReference(homeConfig, options.project);
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
  const existingReference = findProjectReference(homeConfig, options.project);
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

