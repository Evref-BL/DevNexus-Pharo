import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCodexWorktreeGuide } from "./codexWorktreeGuide.js";
import { initNexusHome } from "./config.js";
import {
  type GitCommandResult,
  type GitRunner,
} from "./nexusProjectService.js";
import { createPharoNexusProject } from "./pharoNexusProjectService.js";
import { prepareCodexWorktree } from "./codexWorktreeService.js";

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

function fakeGitRunner(args: readonly string[], cwd?: string): GitCommandResult {
  const argsArray = [...args];
  if (argsArray[0] === "worktree" && argsArray[1] === "add") {
    fs.mkdirSync(argsArray[4], { recursive: true });
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
  if (argsArray.includes("rev-parse")) {
    return { args: argsArray, stdout: "true\n", stderr: "", exitCode: 0 };
  }
  if (argsArray.includes("symbolic-ref")) {
    return { args: argsArray, stdout: "main\n", stderr: "", exitCode: 0 };
  }

  return { args: argsArray, stdout: "", stderr: "", exitCode: 0 };
}

describe("Codex worktree guide", () => {
  it("builds read-only direct Codex workflow guidance for an existing worktree", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Guide");
    createPharoNexusProject({
      homePath,
      name: "Guide",
      root: projectRoot,
      gitInit: true,
      gitRunner: fakeGitRunner as GitRunner,
    });
    const prepared = prepareCodexWorktree({
      homePath,
      project: "guide",
      branchName: "codex/guide",
      workItem: { id: "local-1" },
      gitRunner: fakeGitRunner as GitRunner,
    });

    const guide = buildCodexWorktreeGuide({
      homePath,
      id: prepared.metadataRecord.id,
      commentWorkItem: true,
      removeWorktree: true,
      publicationDecision: "review_handoff",
    });

    expect(guide).toMatchObject({
      homePath,
      id: "guide:codex/guide",
      project: "guide",
      workItemId: "local-1",
      worktree: {
        metadataRecord: {
          id: "guide:codex/guide",
        },
        worktreeExists: true,
      },
    });
    expect(guide.steps.map((step) => step.title)).toEqual([
      "Prepare worktree",
      "Run Codex directly",
      "Record execution metadata",
      "Publish or block deliberately",
      "Archive worktree",
    ]);
    expect(guide.steps[0].command).toContain("--comment-work-item");
    expect(guide.steps[1].command).toContain(prepared.worktreePath);
    expect(guide.steps[2].command).toContain("codex worktree record");
    expect(guide.steps[4].command).toContain("--remove-worktree");
    expect(guide.notes.join("\n")).toContain("does not use Vibe workspaces");
  });
});
