import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  pharoNexusExtension,
  pharoNexusProjectFilesFromExtensionResult,
} from "./pharoNexusExtension.js";
import { scaffoldNexusProject } from "./nexusProjectScaffold.js";
import {
  pharoNexusProjectWorktreesDirectoryName,
  type PharoNexusProjectConfig,
} from "./config.js";
import {
  pharoNexusProjectExtensionConfigKey,
  plexusProjectConfigFileName,
} from "./pharoNexusExtension.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(overrides: Partial<PharoNexusProjectConfig> = {}): PharoNexusProjectConfig {
  return {
    version: 1,
    id: "pharo-project",
    name: "Pharo Project",
    home: null,
    repo: {
      kind: "git",
      remoteUrl: "https://github.com/example/pharo-project.git",
      defaultBranch: "main",
      sourceRoot: "git",
    },
    worktreesRoot: pharoNexusProjectWorktreesDirectoryName,
    kanban: {
      provider: "vibe-kanban",
      projectId: "vk-pharo-project",
    },
    ...overrides,
  };
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("PharoNexus extension", () => {
  it("owns Pharo and PLexus project files", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-project-"), "Project");
    const sourceRoot = path.join(projectRoot, "git");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const config = projectConfig();
    fs.mkdirSync(sourceRoot, { recursive: true });

    const scaffold = scaffoldNexusProject({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig: config,
      extensions: [pharoNexusExtension],
    });
    const files = pharoNexusProjectFilesFromExtensionResult(
      scaffold.extensionResults[pharoNexusExtension.id],
    );

    expect(JSON.parse(fs.readFileSync(files.plexusProjectConfigPath, "utf8"))).toEqual({
      name: "Pharo Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-pharo-project",
      },
      images: [],
    });
    expect(files.plexusProjectConfigPath).toBe(
      path.join(projectRoot, plexusProjectConfigFileName),
    );
    expect(fs.existsSync(files.agentsPath)).toBe(true);
    expect(fs.readFileSync(files.suggestedFirstPromptPath, "utf8")).toContain(
      `Inspect the source checkout at ${sourceRoot}.`,
    );
    expect(files.plexusProjectConfig).toEqual({
      name: "Pharo Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-pharo-project",
      },
      images: [],
    });
  });

  it("reads PLexus metadata paths from PharoNexus extension config", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-project-"), "Project");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const config = projectConfig({
      extensions: {
        [pharoNexusProjectExtensionConfigKey]: {
          plexusProjectConfig: path.join("config", "plexus.project.json"),
        },
      },
    });

    const scaffold = scaffoldNexusProject({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig: config,
      extensions: [pharoNexusExtension],
    });
    const files = pharoNexusProjectFilesFromExtensionResult(
      scaffold.extensionResults[pharoNexusExtension.id],
    );

    expect(files.plexusProjectConfigPath).toBe(
      path.join(projectRoot, "config", "plexus.project.json"),
    );
    expect(fs.existsSync(files.plexusProjectConfigPath)).toBe(true);
  });
});
