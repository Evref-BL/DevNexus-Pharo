import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitWorktreeServiceError,
  type GitCommandResult,
  type GitRunner,
  normalizeBranchName,
  prepareGitWorktree,
  removeGitWorktree,
  safeDirectoryName,
} from "./gitWorktreeService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fakeGitRunner(calls: Array<{ args: string[]; cwd?: string }>): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      fs.mkdirSync(argsArray[4], { recursive: true });
    }
    if (argsArray[0] === "worktree" && argsArray[1] === "remove") {
      fs.rmSync(argsArray[2], { recursive: true, force: true });
    }

    return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("git worktree service", () => {
  it("prepares a branch-backed worktree under the worktrees root", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = prepareGitWorktree({
      sourceRoot,
      worktreesRoot,
      branchName: "codex/demo/FCD-1",
      baseRef: "main",
      gitRunner: fakeGitRunner(calls),
    });

    const expectedWorktreePath = path.join(
      worktreesRoot,
      "codex-demo-fcd-1",
    );
    expect(result).toMatchObject({
      sourceRoot,
      worktreesRoot,
      worktreePath: expectedWorktreePath,
      branchName: "codex/demo/FCD-1",
      baseRef: "main",
    });
    expect(calls).toEqual([
      {
        cwd: sourceRoot,
        args: [
          "worktree",
          "add",
          "-b",
          "codex/demo/FCD-1",
          expectedWorktreePath,
          "main",
        ],
      },
    ]);
  });

  it("uses an explicit worktree name and removes worktrees", () => {
    const sourceRoot = path.join(makeTempDir("dev-nexus-source-"), "Source");
    const worktreesRoot = path.join(makeTempDir("dev-nexus-worktrees-"), "worktrees");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner = fakeGitRunner(calls);

    const prepared = prepareGitWorktree({
      sourceRoot,
      worktreesRoot,
      branchName: "feature/one",
      worktreeName: "explicit-name",
      gitRunner,
    });
    const removed = removeGitWorktree({
      sourceRoot,
      worktreePath: prepared.worktreePath,
      gitRunner,
    });

    expect(prepared.worktreePath).toBe(path.join(worktreesRoot, "explicit-name"));
    expect(removed.git.commands.at(-1)).toMatchObject({
      args: ["worktree", "remove", prepared.worktreePath],
    });
    expect(fs.existsSync(prepared.worktreePath)).toBe(false);
  });

  it("normalizes names and rejects unsafe branch or worktree paths", () => {
    expect(normalizeBranchName(" feature\\one ")).toBe("feature/one");
    expect(safeDirectoryName("Feature/FCD 42")).toBe("feature-fcd-42");
    expect(() => normalizeBranchName("../bad")).toThrow(
      GitWorktreeServiceError,
    );

    const sourceRoot = makeTempDir("dev-nexus-source-");
    const worktreesRoot = makeTempDir("dev-nexus-worktrees-");
    expect(() =>
      prepareGitWorktree({
        sourceRoot,
        worktreesRoot,
        branchName: "feature/one",
        worktreeName: "..",
        gitRunner: fakeGitRunner([]),
      }),
    ).toThrow(/inside worktrees root/);
  });
});
