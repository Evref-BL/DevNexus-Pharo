import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  controlProjectConfigPath,
  controlProjectRootPath,
  controlProjectWorktreesRootPath,
  createControlProjectConfig,
  initPharoNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  pharoNexusProjectConfigFileName,
  plexusProjectConfigFileName,
  projectPlexusConfigPath,
  projectWorktreesRootPath,
  validateProjectConfig,
} from "./config.js";
import {
  createPharoNexusProject,
  importPharoNexusProject,
  PharoNexusProjectError,
  type GitCommandResult,
  type GitRunner,
} from "./projectService.js";

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

function fakeGitRunner(
  calls: string[][],
  options: { branch?: string; remoteUrl?: string | null } = {},
): GitRunner {
  return (args: readonly string[]): GitCommandResult => {
    const argsArray = [...args];
    calls.push(argsArray);

    if (argsArray[0] === "clone") {
      fs.mkdirSync(argsArray[2], { recursive: true });
    }

    if (argsArray.includes("rev-parse")) {
      return {
        args: argsArray,
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      };
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

    return {
      args: argsArray,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  };
}

describe("PharoNexus focused project lifecycle contracts", () => {
  it("creates the default control project during init", () => {
    const homePath = makeTempDir("pharo-nexus-home-");

    const result = initPharoNexusHome({ homePath });

    expect(result.controlProjectPath).toBe(controlProjectRootPath(homePath));
    expect(result.controlProjectConfigPath).toBe(controlProjectConfigPath(homePath));
    expect(fs.existsSync(controlProjectWorktreesRootPath(homePath))).toBe(true);
    expect(loadProjectConfig(controlProjectRootPath(homePath))).toEqual(
      createControlProjectConfig(),
    );
  });

  it("validates the project config schema and fills legacy defaults", () => {
    expect(
      validateProjectConfig({
        version: 1,
        id: "validated",
        name: "Validated",
        kanban: {
          provider: "vibe-kanban",
        },
      }),
    ).toEqual({
      version: 1,
      id: "validated",
      name: "Validated",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      plexusProjectConfig: plexusProjectConfigFileName,
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });

    expect(() =>
      validateProjectConfig({
        version: 1,
        id: "invalid",
        name: "Invalid",
        repo: {
          kind: "svn",
        },
        kanban: {
          provider: "vibe-kanban",
        },
      }),
    ).toThrow("repo.kind must be local or git");
  });

  it("creates a project from scratch with git init", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectsRoot = path.join(homePath, "projects-root");
    const gitCalls: string[][] = [];
    initPharoNexusHome({ homePath, projectsRoot });

    const result = createPharoNexusProject({
      homePath,
      name: "Scratch Project",
      gitInit: true,
      gitRunner: fakeGitRunner(gitCalls, { branch: "main" }),
    });

    expect(result.projectRoot).toBe(path.join(projectsRoot, "Scratch-Project"));
    expect(result.git.operation).toBe("init");
    expect(gitCalls[0]).toEqual(["init", result.projectRoot]);
    expect(loadProjectConfig(result.projectRoot)).toMatchObject({
      id: "scratch-project",
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
    });
    expect(fs.existsSync(result.worktreesRoot)).toBe(true);
  });

  it("imports an existing Git repository", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const sourceRoot = path.join(makeTempDir("pharo-nexus-source-"), "Imported");
    const gitCalls: string[][] = [];
    fs.mkdirSync(sourceRoot, { recursive: true });
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "Imported");

    const result = importPharoNexusProject({
      homePath,
      root: sourceRoot,
      name: "Imported",
      gitRunner: fakeGitRunner(gitCalls, {
        branch: "main",
        remoteUrl: "https://github.com/example/imported.git",
      }),
    });

    expect(gitCalls).toEqual([
      ["-C", sourceRoot, "rev-parse", "--is-inside-work-tree"],
      ["-C", sourceRoot, "config", "--get", "remote.origin.url"],
      ["-C", sourceRoot, "symbolic-ref", "--short", "HEAD"],
      ["init", projectRoot],
    ]);
    expect(result.projectConfig).toMatchObject({
      id: "imported",
      repo: {
        kind: "git",
        remoteUrl: "https://github.com/example/imported.git",
        defaultBranch: "main",
        sourceRoot,
      },
    });
    expect(fs.existsSync(path.join(projectRoot, pharoNexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, pharoNexusProjectConfigFileName))).toBe(false);
  });

  it("rejects duplicate project ids before running git", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const gitCalls: string[][] = [];
    initPharoNexusHome({ homePath });
    createPharoNexusProject({
      homePath,
      name: "Duplicate",
      gitRunner: fakeGitRunner(gitCalls),
    });
    gitCalls.length = 0;

    expect(() =>
      createPharoNexusProject({
        homePath,
        name: "Duplicate",
        root: path.join(makeTempDir("pharo-nexus-projects-"), "Duplicate2"),
        gitRunner: fakeGitRunner(gitCalls),
      }),
    ).toThrow(PharoNexusProjectError);
    expect(gitCalls).toEqual([]);
  });

  it("resolves project-local paths from the project directory", () => {
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Resolved");
    const config = validateProjectConfig({
      version: 1,
      id: "resolved",
      name: "Resolved",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: null,
      },
      plexusProjectConfig: path.join("config", "plexus.project.json"),
      worktreesRoot: path.join(".nexus", "worktrees"),
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });

    expect(projectPlexusConfigPath(projectRoot, config)).toBe(
      path.join(projectRoot, "config", "plexus.project.json"),
    );
    expect(projectWorktreesRootPath(projectRoot, config)).toBe(
      path.join(projectRoot, ".nexus", "worktrees"),
    );
  });

  it("generates the PLexus project config alongside the PharoNexus project config", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "PlexusGenerated");
    initPharoNexusHome({ homePath });

    const result = createPharoNexusProject({
      homePath,
      name: "PlexusGenerated",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(result.plexusProjectConfigPath).toBe(
      path.join(projectRoot, plexusProjectConfigFileName),
    );
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toEqual({
      name: "PlexusGenerated",
      kanban: {
        provider: "vibe-kanban",
        projectId: "plexus-generated",
      },
      images: [],
    });
  });

  it("updates the home project registry for created and imported projects", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const importedRoot = path.join(makeTempDir("pharo-nexus-projects-"), "ImportedRegistry");
    fs.mkdirSync(importedRoot, { recursive: true });
    initPharoNexusHome({ homePath });
    const importedProjectRoot = path.join(homePath, "projects", "ImportedRegistry");
    const created = createPharoNexusProject({
      homePath,
      name: "CreatedRegistry",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });
    importPharoNexusProject({
      homePath,
      root: importedRoot,
      name: "ImportedRegistry",
      gitRunner: fakeGitRunner([], {
        branch: "dev",
        remoteUrl: "https://github.com/example/imported-registry.git",
      }),
    });

    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "created-registry",
        name: "CreatedRegistry",
        projectRoot: created.projectRoot,
      },
      {
        id: "imported-registry",
        name: "ImportedRegistry",
        projectRoot: importedProjectRoot,
      },
    ]);
  });
});
