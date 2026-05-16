import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultPlexusImageExecutionPolicy,
  devNexusPharoExtension,
  devNexusPharoSkillPack,
  devNexusPharoProjectFilesFromExtensionResult,
  projectPlexusImageExecutionPolicy,
  resolvePlexusImageExecutionPolicy,
} from "./devNexusPharoExtension.js";
import { scaffoldNexusProject } from "dev-nexus";
import {
  nexusProjectWorktreesDirectoryName,
  type NexusProjectConfig,
} from "./config.js";
import {
  devNexusPharoProjectExtensionConfigKey,
  plexusProjectConfigFileName,
} from "./devNexusPharoExtension.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function projectConfig(overrides: Partial<NexusProjectConfig> = {}): NexusProjectConfig {
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
    worktreesRoot: nexusProjectWorktreesDirectoryName,
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

describe("DevNexus-Pharo extension", () => {
  it("owns Pharo and PLexus project files", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-project-"), "Project");
    const sourceRoot = path.join(projectRoot, "git");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const config = projectConfig();
    fs.mkdirSync(sourceRoot, { recursive: true });

    const scaffold = scaffoldNexusProject({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig: config,
      extensions: [devNexusPharoExtension],
    });
    const files = devNexusPharoProjectFilesFromExtensionResult(
      scaffold.extensionResults[devNexusPharoExtension.id],
    );

    expect(JSON.parse(fs.readFileSync(files.plexusProjectConfigPath, "utf8"))).toEqual({
      name: "Pharo Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-pharo-project",
      },
      images: [],
      imageExecution: defaultPlexusImageExecutionPolicy,
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
      imageExecution: defaultPlexusImageExecutionPolicy,
    });
  });

  it("reads PLexus metadata paths from DevNexus-Pharo extension config", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-project-"), "Project");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const config = projectConfig({
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {
          plexusProjectConfig: path.join("config", "plexus.project.json"),
        },
      },
    });

    const scaffold = scaffoldNexusProject({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig: config,
      extensions: [devNexusPharoExtension],
    });
    const files = devNexusPharoProjectFilesFromExtensionResult(
      scaffold.extensionResults[devNexusPharoExtension.id],
    );

    expect(files.plexusProjectConfigPath).toBe(
      path.join(projectRoot, "config", "plexus.project.json"),
    );
    expect(fs.existsSync(files.plexusProjectConfigPath)).toBe(true);
  });

  it("resolves safe image execution policy before PLexus launch work", () => {
    expect(resolvePlexusImageExecutionPolicy(undefined)).toEqual(
      defaultPlexusImageExecutionPolicy,
    );
    expect(
      projectPlexusImageExecutionPolicy({
        extensions: {
          [devNexusPharoProjectExtensionConfigKey]: {
            imageExecution: {
              mode: "docker",
              docker: {
                image: "ghcr.io/example/pharo-runner:test",
                network: "bridge",
              },
            },
          },
        },
      }),
    ).toEqual({
      mode: "docker",
      requireDisposableImage: true,
      requireCleanupPlan: true,
      docker: {
        image: "ghcr.io/example/pharo-runner:test",
        network: "bridge",
        autoRemove: true,
        mountProjectReadOnly: true,
      },
    });
    expect(() =>
      resolvePlexusImageExecutionPolicy({
        mode: "docker",
        docker: {},
      }),
    ).toThrow(/docker\.image is required/);
  });

  it("writes configured Docker image execution policy into PLexus metadata", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-project-"), "Project");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const config = projectConfig({
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {
          imageExecution: {
            mode: "docker",
            requireDisposableImage: true,
            requireCleanupPlan: true,
            docker: {
              image: "ghcr.io/example/pharo-runner:test",
              network: "none",
              autoRemove: true,
              mountProjectReadOnly: true,
            },
          },
        },
      },
    });

    const scaffold = scaffoldNexusProject({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig: config,
      extensions: [devNexusPharoExtension],
    });
    const files = devNexusPharoProjectFilesFromExtensionResult(
      scaffold.extensionResults[devNexusPharoExtension.id],
    );

    expect(JSON.parse(fs.readFileSync(files.plexusProjectConfigPath, "utf8"))).toMatchObject({
      imageExecution: {
        mode: "docker",
        requireDisposableImage: true,
        requireCleanupPlan: true,
        docker: {
          image: "ghcr.io/example/pharo-runner:test",
          network: "none",
          autoRemove: true,
          mountProjectReadOnly: true,
        },
      },
    });
  });

  it("adds DevNexus-Pharo specialization skills only for marked projects", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-project-"), "Project");
    const worktreesRoot = path.join(projectRoot, "worktrees");
    const config = projectConfig({
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
    });

    const scaffold = scaffoldNexusProject({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig: config,
      extensions: [devNexusPharoExtension],
    });

    expect(scaffold.skills.installed.map((skill) => skill.id)).toEqual(
      expect.arrayContaining([
        "diagnose",
        ...devNexusPharoSkillPack.map((skill) => skill.manifest.id),
      ]),
    );
    expect(
      fs.existsSync(
        path.join(
          projectRoot,
          ".dev-nexus",
          "skills",
          "dev-nexus-pharo-workflow",
          "SKILL.md",
        ),
      ),
    ).toBe(true);

    const unmanaged = scaffoldNexusProject({
      homePath,
      projectRoot: path.join(makeTempDir("dev-nexus-pharo-project-"), "Plain"),
      worktreesRoot: path.join(makeTempDir("dev-nexus-pharo-worktrees-"), "worktrees"),
      projectConfig: projectConfig(),
      extensions: [devNexusPharoExtension],
    });

    expect(unmanaged.skills.installed.map((skill) => skill.id)).not.toContain(
      "dev-nexus-pharo-workflow",
    );
  });

  it("contributes PLexus status and tracker linking only for DevNexus-Pharo projects", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-project-"), "Project");
    const plexusPath = path.join(projectRoot, plexusProjectConfigFileName);
    const unmanagedConfig = projectConfig();

    expect(
      devNexusPharoExtension.projectStatus?.({
        projectRoot,
        projectConfig: unmanagedConfig,
      }),
    ).toBeUndefined();
    expect(
      devNexusPharoExtension.linkProjectTracker?.({
        projectRoot,
        projectConfig: unmanagedConfig,
        trackerProjectId: "vk-ignored",
      }),
    ).toBeUndefined();

    const managedConfig = projectConfig({
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
    });
    expect(
      devNexusPharoExtension.projectStatus?.({
        projectRoot,
        projectConfig: managedConfig,
      }),
    ).toEqual({
      plexusProjectConfigPath: plexusPath,
      plexusProjectConfigExists: false,
    });

    const linked = devNexusPharoExtension.linkProjectTracker?.({
      projectRoot,
      projectConfig: managedConfig,
      trackerProjectId: "vk-linked",
    });

    expect(linked).toEqual({
      plexusProjectConfigPath: plexusPath,
      plexusProjectConfig: {
        name: "Pharo Project",
        kanban: {
          provider: "vibe-kanban",
          projectId: "vk-linked",
        },
        images: [],
        imageExecution: defaultPlexusImageExecutionPolicy,
      },
    });
    expect(JSON.parse(fs.readFileSync(plexusPath, "utf8"))).toEqual(
      linked?.plexusProjectConfig,
    );
    expect(
      devNexusPharoExtension.projectStatus?.({
        projectRoot,
        projectConfig: managedConfig,
      }),
    ).toEqual({
      plexusProjectConfigPath: plexusPath,
      plexusProjectConfigExists: true,
    });
  });
});
