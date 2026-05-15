import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { codexConfigPath } from "./codexConfig.js";
import { initPharoNexusHome } from "./config.js";
import {
  type GitCommandResult,
  type GitRunner,
} from "./nexusProjectService.js";
import {
  createPharoNexusProject,
  importPharoNexusProject,
} from "./pharoNexusProjectService.js";
import {
  archiveCodexWorktree,
  CodexWorktreeServiceError,
  codexWorktreeMetadataStorePath,
  getCodexWorktreeStatus,
  listCodexWorktrees,
  prepareCodexWorktree,
  recordCodexWorktreeExecution,
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
    }
    if (argsArray[0] === "worktree" && argsArray[1] === "remove") {
      fs.rmSync(argsArray[2], { recursive: true, force: true });
    }
    if (
      argsArray[0] === "rev-parse" &&
      argsArray[1] === "--git-path" &&
      argsArray[2] === "info/exclude"
    ) {
      return {
        args: argsArray,
        stdout: `${path.join(cwd ?? "", ".git", "info", "exclude")}\n`,
        stderr: "",
        exitCode: 0,
      };
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
      {
        cwd: expectedWorktreePath,
        args: ["rev-parse", "--git-path", "info/exclude"],
      },
    ]);
    expect(fs.existsSync(path.join(expectedWorktreePath, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(codexConfigPath(expectedWorktreePath))).toBe(true);
    expect(result.copiedFiles).toContain(path.join(expectedWorktreePath, "AGENTS.md"));
    expect(result.copiedFiles).toContain(path.join(expectedWorktreePath, ".codex"));
    expect(result.excludedEntries).toEqual(["AGENTS.md", ".codex/"]);
    expect(
      fs.readFileSync(path.join(expectedWorktreePath, ".git", "info", "exclude"), "utf8"),
    ).toContain("AGENTS.md\n.codex/");
    expect(result.metadataPath).toBe(codexWorktreeMetadataStorePath(homePath));
    expect(JSON.parse(fs.readFileSync(result.metadataPath, "utf8"))).toMatchObject({
      version: 1,
      worktrees: [
        {
          id: "ready:codex/fcd-123",
          state: "active",
          projectId: "ready",
          branchName: "codex/fcd-123",
          worktreePath: expectedWorktreePath,
          excludedEntries: ["AGENTS.md", ".codex/"],
          execution: {
            commitIds: [],
            verification: [],
            publicationDecision: null,
            updatedAt: null,
          },
        },
      ],
    });
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
      {
        cwd: path.join(projectRoot, "worktrees", "codex-imported-fcd-42"),
        args: ["rev-parse", "--git-path", "info/exclude"],
      },
    ]);
    expect(result.metadataRecord).toMatchObject({
      id: "imported:codex/imported/fcd-42",
      projectId: "imported",
      sourceRoot,
      workItem: {
        id: "FCD-42",
      },
    });
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

  it("archives worktree metadata without removing the worktree by default", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Archived");
    createPharoNexusProject({
      homePath,
      name: "Archived",
      root: projectRoot,
      gitInit: true,
      gitRunner: fakeProjectGitRunner(),
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const prepared = prepareCodexWorktree({
      homePath,
      project: "archived",
      branchName: "codex/archive-only",
      gitRunner: fakeWorktreeGitRunner(calls),
      now: () => "2026-05-15T10:40:00.000Z",
    });

    const archived = archiveCodexWorktree({
      homePath,
      id: prepared.metadataRecord.id,
      gitRunner: fakeWorktreeGitRunner(calls),
      now: () => "2026-05-15T10:45:00.000Z",
    });

    expect(archived).toMatchObject({
      removedWorktree: false,
      metadataRecord: {
        id: "archived:codex/archive-only",
        state: "archived",
        archivedAt: "2026-05-15T10:45:00.000Z",
        removedAt: null,
      },
    });
    expect(fs.existsSync(prepared.worktreePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(prepared.metadataPath, "utf8"))).toMatchObject({
      worktrees: [
        {
          id: "archived:codex/archive-only",
          state: "archived",
          archivedAt: "2026-05-15T10:45:00.000Z",
          removedAt: null,
        },
      ],
    });
  });

  it("can remove the Git worktree while archiving metadata", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Removed");
    createPharoNexusProject({
      homePath,
      name: "Removed",
      root: projectRoot,
      gitInit: true,
      gitRunner: fakeProjectGitRunner(),
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const prepared = prepareCodexWorktree({
      homePath,
      project: "removed",
      branchName: "codex/remove",
      gitRunner: fakeWorktreeGitRunner(calls),
    });

    const archived = archiveCodexWorktree({
      homePath,
      id: prepared.metadataRecord.id,
      removeWorktree: true,
      gitRunner: fakeWorktreeGitRunner(calls),
      now: () => "2026-05-15T10:50:00.000Z",
    });

    expect(archived).toMatchObject({
      removedWorktree: true,
      metadataRecord: {
        state: "archived",
        removedAt: "2026-05-15T10:50:00.000Z",
      },
    });
    expect(calls.at(-1)).toEqual({
      cwd: projectRoot,
      args: ["worktree", "remove", prepared.worktreePath],
    });
    expect(fs.existsSync(prepared.worktreePath)).toBe(false);
  });

  it("lists and reports recorded Codex worktree status", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Listed");
    createPharoNexusProject({
      homePath,
      name: "Listed",
      root: projectRoot,
      gitInit: true,
      gitRunner: fakeProjectGitRunner(),
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const first = prepareCodexWorktree({
      homePath,
      project: "listed",
      branchName: "codex/one",
      gitRunner: fakeWorktreeGitRunner(calls),
    });
    const second = prepareCodexWorktree({
      homePath,
      project: "listed",
      branchName: "codex/two",
      gitRunner: fakeWorktreeGitRunner(calls),
    });
    archiveCodexWorktree({
      homePath,
      id: second.metadataRecord.id,
      removeWorktree: true,
      gitRunner: fakeWorktreeGitRunner(calls),
      now: () => "2026-05-15T11:00:00.000Z",
    });

    expect(listCodexWorktrees({ homePath, project: "listed" })).toMatchObject({
      homePath,
      metadataPath: codexWorktreeMetadataStorePath(homePath),
      worktrees: [
        {
          metadataRecord: {
            id: "listed:codex/one",
            state: "active",
          },
          projectRootExists: true,
          sourceRootExists: true,
          worktreeExists: true,
        },
        {
          metadataRecord: {
            id: "listed:codex/two",
            state: "archived",
          },
          projectRootExists: true,
          sourceRootExists: true,
          worktreeExists: false,
        },
      ],
    });
    expect(listCodexWorktrees({ homePath, state: "active" })).toMatchObject({
      worktrees: [
        {
          metadataRecord: {
            id: first.metadataRecord.id,
          },
        },
      ],
    });
    expect(getCodexWorktreeStatus({
      homePath,
      id: second.metadataRecord.id,
    })).toMatchObject({
      worktree: {
        metadataRecord: {
          id: second.metadataRecord.id,
          state: "archived",
          removedAt: "2026-05-15T11:00:00.000Z",
        },
        worktreeExists: false,
      },
    });
  });

  it("records execution metadata against a Codex worktree", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Executed");
    createPharoNexusProject({
      homePath,
      name: "Executed",
      root: projectRoot,
      gitInit: true,
      gitRunner: fakeProjectGitRunner(),
    });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const prepared = prepareCodexWorktree({
      homePath,
      project: "executed",
      branchName: "codex/execution",
      gitRunner: fakeWorktreeGitRunner(calls),
    });

    const recorded = recordCodexWorktreeExecution({
      homePath,
      id: prepared.metadataRecord.id,
      commitIds: ["abc123", "def456", "abc123"],
      verification: {
        command: "npm test",
        status: "passed",
        summary: "164 tests passed",
      },
      publicationDecision: {
        type: "review_handoff",
        prUrl: "https://example.test/pr/1",
        reason: "Needs review before integration",
      },
      now: () => "2026-05-15T11:20:00.000Z",
    });

    expect(recorded).toMatchObject({
      metadataRecord: {
        id: "executed:codex/execution",
        execution: {
          commitIds: ["abc123", "def456"],
          verification: [
            {
              command: "npm test",
              status: "passed",
              summary: "164 tests passed",
              recordedAt: "2026-05-15T11:20:00.000Z",
            },
          ],
          publicationDecision: {
            type: "review_handoff",
            prUrl: "https://example.test/pr/1",
            reason: "Needs review before integration",
            decidedAt: "2026-05-15T11:20:00.000Z",
          },
          updatedAt: "2026-05-15T11:20:00.000Z",
        },
      },
    });
    expect(getCodexWorktreeStatus({
      homePath,
      id: prepared.metadataRecord.id,
    })).toMatchObject({
      worktree: {
        metadataRecord: {
          execution: {
            commitIds: ["abc123", "def456"],
            verification: [
              {
                command: "npm test",
              },
            ],
            publicationDecision: {
              type: "review_handoff",
            },
          },
        },
      },
    });
  });
});
