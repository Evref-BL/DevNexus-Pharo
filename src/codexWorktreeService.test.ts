import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexConfigPath } from "./codexConfig.js";
import { initPharoNexusHome } from "./config.js";
import {
  createPharoNexusProject,
  importPharoNexusProject,
  type GitCommandResult,
  type GitRunner,
} from "./projectService.js";
import {
  CodexWorktreeServiceError,
  prepareCodexWorktree,
} from "./codexWorktreeService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function fakeProjectGitRunner(
  options: { branch?: string; remoteUrl?: string | null } = {},
): GitRunner {
  return (args: readonly string[]): GitCommandResult => {
    const argsArray = [...args];
    if (argsArray[0] === "clone") {
      fs.mkdirSync(argsArray[2], { recursive: true });
    }
    if (argsArray.includes("rev-parse")) {
      return { args: argsArray, stdout: "true\n", stderr: "", exitCode: 0 };
    }
    if (argsArray.includes("remote.origin.url")) {
      return {
        args: argsArray,
        stdout: options.remoteUrl ? `${options.remoteUrl}\n` : "",
        stderr: "",
        exitCode: options.remoteUrl ? 0 : 1,
      };
    }
    if (argsArray.includes("symbolic-ref")) {
      return {
        args: argsArray,
        stdout: `${options.branch ?? "main"}\n`,
        stderr: "",
        exitCode: 0,
      };
    }

    return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
  };
}

function fakeWorktreeGitRunner(
  calls: Array<{ args: string[]; cwd?: string }>,
): GitRunner {
  return (args: readonly string[], cwd?: string): GitCommandResult => {
    const argsArray = [...args];
    calls.push({ args: argsArray, cwd });
    if (argsArray[0] === "worktree" && argsArray[1] === "add") {
      fs.mkdirSync(argsArray[4], { recursive: true });
      fs.writeFileSync(path.join(argsArray[4], ".git"), "gitdir: fake\n", "utf8");
    }

    return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("Codex worktree service", () => {
  it("prepares a Codex worktree under the managed project worktrees root", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Ready");
    createPharoNexusProject({
      homePath,
      name: "Ready",
      root: projectRoot,
      gitInit: true,
      gitRunner: fakeProjectGitRunner(),
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = prepareCodexWorktree({
      homePath,
      project: "ready",
      branchName: "codex/fcd-123",
      gitRunner: fakeWorktreeGitRunner(calls),
    });

    const expectedWorktreePath = path.join(
      projectRoot,
      "worktrees",
      "codex-fcd-123",
    );
    expect(result).toMatchObject({
      homePath,
      projectRoot,
      sourceRoot: projectRoot,
      worktreePath: expectedWorktreePath,
      branchName: "codex/fcd-123",
      baseRef: null,
    });
    expect(calls).toEqual([
      {
        cwd: projectRoot,
        args: ["worktree", "add", "-b", "codex/fcd-123", expectedWorktreePath],
      },
    ]);
    expect(fs.existsSync(path.join(expectedWorktreePath, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(codexConfigPath(expectedWorktreePath))).toBe(true);
    expect(result.copiedFiles).toContain(path.join(expectedWorktreePath, "AGENTS.md"));
    expect(result.copiedFiles).toContain(path.join(expectedWorktreePath, ".codex"));
  });

  it("uses an imported source checkout as the Git worktree source", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const sourceRoot = path.join(makeTempDir("pharo-nexus-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    const projectRoot = path.join(homePath, "projects", "Imported");
    importPharoNexusProject({
      homePath,
      root: sourceRoot,
      name: "Imported",
      gitRunner: fakeProjectGitRunner({
        branch: "main",
        remoteUrl: "https://github.com/example/imported.git",
      }),
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    const result = prepareCodexWorktree({
      homePath,
      project: "imported",
      workItem: { id: "FCD-42" },
      baseRef: "main",
      gitRunner: fakeWorktreeGitRunner(calls),
      now: () => "2026-05-15T10:30:00.000Z",
    });

    expect(result).toMatchObject({
      projectRoot,
      sourceRoot,
      branchName: "codex/imported/fcd-42",
      baseRef: "main",
    });
    expect(calls).toEqual([
      {
        cwd: sourceRoot,
        args: [
          "worktree",
          "add",
          "-b",
          "codex/imported/fcd-42",
          path.join(projectRoot, "worktrees", "codex-imported-fcd-42"),
          "main",
        ],
      },
    ]);
  });

  it("rejects unsafe branch names before running Git", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Unsafe");
    createPharoNexusProject({
      homePath,
      name: "Unsafe",
      root: projectRoot,
      gitInit: true,
      gitRunner: fakeProjectGitRunner(),
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];

    expect(() =>
      prepareCodexWorktree({
        homePath,
        project: "unsafe",
        branchName: "../bad",
        gitRunner: fakeWorktreeGitRunner(calls),
      }),
    ).toThrow(CodexWorktreeServiceError);
    expect(calls).toEqual([]);
  });
});
