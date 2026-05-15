import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitCommandResult {
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export type GitRunner = (
  args: readonly string[],
  cwd?: string,
) => GitCommandResult;

export interface PrepareGitWorktreeOptions {
  sourceRoot: string;
  worktreesRoot: string;
  branchName: string;
  worktreeName?: string;
  baseRef?: string | null;
  gitRunner?: GitRunner;
}

export interface PrepareGitWorktreeResult {
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  git: {
    commands: GitCommandResult[];
  };
}

export interface RemoveGitWorktreeOptions {
  sourceRoot: string;
  worktreePath: string;
  gitRunner?: GitRunner;
}

export interface RemoveGitWorktreeResult {
  sourceRoot: string;
  worktreePath: string;
  git: {
    commands: GitCommandResult[];
  };
}

export class GitWorktreeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitWorktreeServiceError";
  }
}

export function prepareGitWorktree(
  options: PrepareGitWorktreeOptions,
): PrepareGitWorktreeResult {
  const sourceRoot = path.resolve(options.sourceRoot);
  const worktreesRoot = path.resolve(options.worktreesRoot);
  const branchName = normalizeBranchName(options.branchName);
  const worktreeName = options.worktreeName ?? safeDirectoryName(branchName);
  const worktreePath = path.join(worktreesRoot, worktreeName);
  assertSafeWorktreePath(worktreesRoot, worktreePath);
  if (fs.existsSync(worktreePath)) {
    throw new GitWorktreeServiceError(
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

  return {
    sourceRoot,
    worktreesRoot,
    worktreePath,
    branchName,
    baseRef: options.baseRef ?? null,
    git: {
      commands,
    },
  };
}

export function removeGitWorktree(
  options: RemoveGitWorktreeOptions,
): RemoveGitWorktreeResult {
  const sourceRoot = path.resolve(options.sourceRoot);
  const worktreePath = path.resolve(options.worktreePath);
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const commands: GitCommandResult[] = [];
  runGitCommand(
    gitRunner,
    commands,
    ["worktree", "remove", worktreePath],
    sourceRoot,
  );

  return {
    sourceRoot,
    worktreePath,
    git: {
      commands,
    },
  };
}

export function normalizeBranchName(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.length === 0) {
    throw new GitWorktreeServiceError("branchName must be non-empty");
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    /[\u0000-\u001F ~^:?*[\\]/u.test(trimmed)
  ) {
    throw new GitWorktreeServiceError(`Invalid branchName: ${value}`);
  }

  return trimmed;
}

export function safeDirectoryName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!sanitized) {
    throw new GitWorktreeServiceError(
      "Worktree name must contain at least one filesystem-safe character",
    );
  }

  return sanitized;
}

export function assertSafeWorktreePath(
  worktreesRoot: string,
  worktreePath: string,
): void {
  const resolvedRoot = path.resolve(worktreesRoot);
  const resolvedTarget = path.resolve(worktreePath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new GitWorktreeServiceError(
      `Worktree path must be inside worktrees root: ${resolvedTarget}`,
    );
  }
}

export function defaultGitRunner(
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
    throw new GitWorktreeServiceError(
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

export function runGitCommand(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = gitRunner(args, cwd);
  commands.push(result);

  if (result.exitCode !== 0) {
    throw new GitWorktreeServiceError(
      `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  return result;
}
