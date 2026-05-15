import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { codexConfigPath } from "./codexConfig.js";
import {
  loadProjectConfig,
  pharoNexusGeneratedDirectoryName,
  projectWorktreesRootPath,
  resolvePharoNexusHome,
  type PharoNexusProjectConfig,
} from "./config.js";
import {
  getPharoNexusProjectStatus,
  type GitCommandResult,
  type GitRunner,
} from "./projectService.js";
import type { WorkItemRef } from "./workTrackingTypes.js";

export const codexWorktreeMetadataFileName = "codex-worktrees.json";
export const codexWorktreeMetadataStoreVersion = 1;

export interface PrepareCodexWorktreeOptions {
  homePath: string;
  project: string;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string;
  workItem?: WorkItemRef;
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface PrepareCodexWorktreeResult {
  homePath: string;
  metadataPath: string;
  metadataRecord: CodexWorktreeRecord;
  projectRoot: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  copiedFiles: string[];
  skippedFiles: string[];
  excludedEntries: string[];
  git: {
    commands: GitCommandResult[];
  };
}

export interface CodexWorktreeRecord {
  id: string;
  projectId: string;
  projectRoot: string;
  sourceRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: WorkItemRef | null;
  createdAt: string;
  copiedFiles: string[];
  skippedFiles: string[];
  excludedEntries: string[];
}

export interface CodexWorktreeMetadataStore {
  version: typeof codexWorktreeMetadataStoreVersion;
  updatedAt: string;
  worktrees: CodexWorktreeRecord[];
}

export class CodexWorktreeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexWorktreeServiceError";
  }
}

export function prepareCodexWorktree(
  options: PrepareCodexWorktreeOptions,
): PrepareCodexWorktreeResult {
  const homePath = resolvePharoNexusHome(options.homePath);
  const status = getPharoNexusProjectStatus({
    homePath,
    project: options.project,
  }).project;
  const projectRoot = path.resolve(status.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const sourceRoot = resolveProjectSourceRoot(projectRoot, projectConfig);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  const branchName = resolveBranchName(status.id, options);
  const worktreeName = options.worktreeName ?? safeDirectoryName(branchName);
  const worktreePath = path.join(worktreesRoot, worktreeName);

  assertSafeWorktreePath(worktreesRoot, worktreePath);
  if (fs.existsSync(worktreePath)) {
    throw new CodexWorktreeServiceError(
      `Worktree path already exists: ${worktreePath}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const commands: GitCommandResult[] = [];
  fs.mkdirSync(worktreesRoot, { recursive: true });
  runGitCommand(
    gitRunner,
    commands,
    [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      ...(options.baseRef ? [options.baseRef] : []),
    ],
    sourceRoot,
  );

  const copiedFiles = copyCodexWorktreeSupportFiles(projectRoot, worktreePath);
  const excludedEntries = ensureSupportFileExcludes(
    gitRunner,
    commands,
    worktreePath,
  );
  const createdAt = nowString(options.now);
  const metadataPath = codexWorktreeMetadataStorePath(homePath);
  const metadataRecord: CodexWorktreeRecord = {
    id: `${status.id}:${branchName}`,
    projectId: status.id,
    projectRoot,
    sourceRoot,
    worktreePath,
    branchName,
    baseRef: options.baseRef ?? null,
    workItem: options.workItem ?? null,
    createdAt,
    copiedFiles: copiedFiles.copied,
    skippedFiles: copiedFiles.skipped,
    excludedEntries,
  };
  saveCodexWorktreeMetadataRecord(metadataPath, metadataRecord, createdAt);

  return {
    homePath,
    metadataPath,
    metadataRecord,
    projectRoot,
    sourceRoot,
    worktreesRoot,
    worktreePath,
    branchName,
    baseRef: options.baseRef ?? null,
    copiedFiles: copiedFiles.copied,
    skippedFiles: copiedFiles.skipped,
    excludedEntries,
    git: {
      commands,
    },
  };
}

export function codexWorktreeMetadataStorePath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    pharoNexusGeneratedDirectoryName,
    codexWorktreeMetadataFileName,
  );
}

function resolveProjectSourceRoot(
  projectRoot: string,
  projectConfig: PharoNexusProjectConfig,
): string {
  const sourceRoot = projectConfig.repo.sourceRoot;
  if (!sourceRoot) {
    return path.resolve(projectRoot);
  }

  return path.isAbsolute(sourceRoot)
    ? path.resolve(sourceRoot)
    : path.resolve(projectRoot, sourceRoot);
}

function resolveBranchName(
  projectId: string,
  options: Pick<PrepareCodexWorktreeOptions, "branchName" | "workItem" | "now">,
): string {
  if (options.branchName?.trim()) {
    return normalizeBranchName(options.branchName);
  }

  const workItemId =
    options.workItem?.id ??
    options.workItem?.externalRef?.itemKey ??
    options.workItem?.externalRef?.itemId ??
    timestampSuffix(options.now);

  return normalizeBranchName(`codex/${projectId}/${safeBranchSegment(workItemId)}`);
}

function timestampSuffix(optionsNow: PrepareCodexWorktreeOptions["now"]): string {
  return nowString(optionsNow).replace(/[^0-9A-Za-z]+/g, "").slice(0, 14) || "worktree";
}

function nowString(optionsNow: PrepareCodexWorktreeOptions["now"]): string {
  const value = optionsNow?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function normalizeBranchName(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.length === 0) {
    throw new CodexWorktreeServiceError("branchName must be non-empty");
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    /[\u0000-\u001F ~^:?*[\\]/u.test(trimmed)
  ) {
    throw new CodexWorktreeServiceError(`Invalid branchName: ${value}`);
  }

  return trimmed;
}

function safeBranchSegment(value: string): string {
  return safeDirectoryName(value).replaceAll(".", "-");
}

function safeDirectoryName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!sanitized) {
    throw new CodexWorktreeServiceError(
      "Worktree name must contain at least one filesystem-safe character",
    );
  }

  return sanitized;
}

function assertSafeWorktreePath(worktreesRoot: string, worktreePath: string): void {
  const resolvedRoot = path.resolve(worktreesRoot);
  const resolvedTarget = path.resolve(worktreePath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CodexWorktreeServiceError(
      `Worktree path must be inside worktrees root: ${resolvedTarget}`,
    );
  }
}

function copyCodexWorktreeSupportFiles(
  projectRoot: string,
  worktreePath: string,
): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];
  copyFileIfMissing(
    path.join(projectRoot, "AGENTS.md"),
    path.join(worktreePath, "AGENTS.md"),
    copied,
    skipped,
  );
  copyDirectoryIfMissing(
    path.dirname(codexConfigPath(projectRoot)),
    path.dirname(codexConfigPath(worktreePath)),
    copied,
    skipped,
  );

  return { copied, skipped };
}

function copyFileIfMissing(
  source: string,
  target: string,
  copied: string[],
  skipped: string[],
): void {
  if (!fs.existsSync(source)) {
    skipped.push(source);
    return;
  }
  if (fs.existsSync(target)) {
    skipped.push(target);
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied.push(target);
}

function copyDirectoryIfMissing(
  source: string,
  target: string,
  copied: string[],
  skipped: string[],
): void {
  if (!fs.existsSync(source)) {
    skipped.push(source);
    return;
  }
  if (fs.existsSync(target)) {
    skipped.push(target);
    return;
  }

  fs.cpSync(source, target, { recursive: true });
  copied.push(target);
}

function ensureSupportFileExcludes(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  worktreePath: string,
): string[] {
  const entries = [
    fs.existsSync(path.join(worktreePath, "AGENTS.md")) ? "AGENTS.md" : undefined,
    fs.existsSync(path.dirname(codexConfigPath(worktreePath))) ? ".codex/" : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (entries.length === 0) {
    return [];
  }

  const excludePathResult = runGitCommand(
    gitRunner,
    commands,
    ["rev-parse", "--git-path", "info/exclude"],
    worktreePath,
  );
  const excludePath = excludePathResult.stdout.trim();
  if (!excludePath) {
    throw new CodexWorktreeServiceError(
      "git rev-parse --git-path info/exclude returned an empty path",
    );
  }

  const resolvedExcludePath = path.isAbsolute(excludePath)
    ? path.resolve(excludePath)
    : path.resolve(worktreePath, excludePath);
  fs.mkdirSync(path.dirname(resolvedExcludePath), { recursive: true });
  const existingText = fs.existsSync(resolvedExcludePath)
    ? fs.readFileSync(resolvedExcludePath, "utf8")
    : "";
  const existing = existingText.split(/\r?\n/u);
  const appended = entries.filter((entry) => !existing.includes(entry));
  if (appended.length > 0) {
    const prefix =
      existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(resolvedExcludePath, `${prefix}${appended.join("\n")}\n`, "utf8");
  }

  return entries;
}

function saveCodexWorktreeMetadataRecord(
  metadataPath: string,
  record: CodexWorktreeRecord,
  updatedAt: string,
): void {
  const store = loadCodexWorktreeMetadataStore(metadataPath, updatedAt);
  const existingIndex = store.worktrees.findIndex(
    (candidate) => candidate.id === record.id,
  );
  const updatedStore: CodexWorktreeMetadataStore = {
    ...store,
    updatedAt,
    worktrees:
      existingIndex >= 0
        ? store.worktrees.map((candidate, index) =>
            index === existingIndex ? record : candidate,
          )
        : [...store.worktrees, record],
  };
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(updatedStore, null, 2)}\n`,
    "utf8",
  );
}

function loadCodexWorktreeMetadataStore(
  metadataPath: string,
  updatedAt: string,
): CodexWorktreeMetadataStore {
  if (!fs.existsSync(metadataPath)) {
    return {
      version: codexWorktreeMetadataStoreVersion,
      updatedAt,
      worktrees: [],
    };
  }

  const raw = JSON.parse(fs.readFileSync(metadataPath, "utf8").replace(/^\uFEFF/u, ""));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata store must be an object: ${metadataPath}`,
    );
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== codexWorktreeMetadataStoreVersion) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata store version must be ${codexWorktreeMetadataStoreVersion}`,
    );
  }
  if (!Array.isArray(record.worktrees)) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata store worktrees must be an array: ${metadataPath}`,
    );
  }

  return {
    version: codexWorktreeMetadataStoreVersion,
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : updatedAt,
    worktrees: record.worktrees as CodexWorktreeRecord[],
  };
}

function defaultGitRunner(
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new CodexWorktreeServiceError(
      `Failed to run git ${args.join(" ")}: ${result.error.message}`,
    );
  }

  return {
    args: [...args],
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };
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
    throw new CodexWorktreeServiceError(
      `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  return result;
}
