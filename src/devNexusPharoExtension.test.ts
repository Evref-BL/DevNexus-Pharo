import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPlexusPharoImageProfile,
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
const mcpPharoSkillSourceCommit = "8ba98ede78404d6a1e3937a8a759022f90c33bde";
const mcpPharoDomainSkillIds = [
  "pharo-ci-repro",
  "pharo-image-git-handoff",
  "pharo-project-load",
  "pharo-version-compat",
];

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
  it("publishes the default AGENTS template used by packaged project setup", () => {
    const packageRoot = path.resolve(path.dirname(import.meta.dirname));
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { files?: string[] };

    expect(fs.existsSync(path.join(packageRoot, "AGENTS.md"))).toBe(true);
    expect(packageJson.files).toEqual(expect.arrayContaining(["AGENTS.md"]));
  });

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
      id: "pharo-project",
      name: "Pharo Project",
      images: [],
      imageExecution: defaultPlexusImageExecutionPolicy,
      runtime: {
        gateway: {
          mode: "project-local",
          host: "127.0.0.1",
          port: expect.any(Number),
          agentMcpPath: "/mcp",
          routeControlMcpPath: "/control-mcp",
        },
      },
    });
    expect(files.plexusProjectConfigPath).toBe(
      path.join(projectRoot, plexusProjectConfigFileName),
    );
    expect(fs.existsSync(files.agentsPath)).toBe(true);
    expect(fs.readFileSync(files.suggestedFirstPromptPath, "utf8")).toContain(
      `Inspect the source checkout at ${sourceRoot}.`,
    );
    expect(files.plexusProjectConfig).toEqual({
      id: "pharo-project",
      name: "Pharo Project",
      images: [],
      imageExecution: defaultPlexusImageExecutionPolicy,
      runtime: {
        gateway: {
          mode: "project-local",
          host: "127.0.0.1",
          port: expect.any(Number),
          agentMcpPath: "/mcp",
          routeControlMcpPath: "/control-mcp",
        },
      },
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

  it("builds a setup-owned default Pharo image profile without enabling images by default", () => {
    expect(
      buildPlexusPharoImageProfile("DevNexus MCP-Pharo", {
        loadScript: "pharo/load-mcp.st",
      }),
    ).toEqual({
      id: "dev",
      imageName: "DevNexus-MCP-Pharo-{workspaceId}-dev",
      active: true,
      mcp: {
        loadScript: "pharo/load-mcp.st",
      },
      create: {
        kind: "template",
        profileId: "pharo-13-default",
        templateName: "Pharo 13.0 - 64bit",
        templateCategory: "Official",
      },
      git: {
        transport: "https",
      },
    });
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

  it("teaches Pharo workers to use per-task disposable images for mutable work", () => {
    const skillsById = new Map(
      devNexusPharoSkillPack.map((skill) => [skill.manifest.id, skill]),
    );

    expect(skillsById.get("pharo-launcher-lifecycle")?.files["SKILL.md"]).toContain(
      "fresh disposable image per issue, branch, chat, or experiment",
    );
    expect(skillsById.get("pharo-launcher-lifecycle")?.files["SKILL.md"]).toContain(
      "never share one writable image across parallel chats",
    );
    expect(skillsById.get("mcp-pharo-execution")?.files["SKILL.md"]).toContain(
      "disposable image scoped to the current issue, branch, chat, or experiment",
    );
    expect(skillsById.get("mcp-pharo-execution")?.files["SKILL.md"]).toContain(
      "if ownership is unclear, create a new image before writes",
    );
  });

  it("bundles MCP-Pharo domain skills with copied upstream provenance", () => {
    const skillsById = new Map(
      devNexusPharoSkillPack.map((skill) => [skill.manifest.id, skill]),
    );

    expect(mcpPharoDomainSkillIds.map((skillId) => skillsById.get(skillId)?.manifest))
      .toMatchObject([
        {
          id: "pharo-ci-repro",
          description: expect.stringContaining("Recreate Pharo smalltalkCI"),
        },
        {
          id: "pharo-image-git-handoff",
          description: expect.stringContaining("Turn image-side Pharo changes"),
        },
        {
          id: "pharo-project-load",
          description: expect.stringContaining("Load Pharo projects into an image"),
        },
        {
          id: "pharo-version-compat",
          description: expect.stringContaining("Use PharoCompatibility"),
        },
      ]);

    for (const skillId of mcpPharoDomainSkillIds) {
      const skill = skillsById.get(skillId);
      expect(skill?.manifest).toMatchObject({
        id: skillId,
        version: "0.1.0",
        supportedAgents: ["codex"],
        materialization: "copy",
        sourceControl: "support",
        source: {
          type: "git",
          commit: mcpPharoSkillSourceCommit,
        },
      });
      expect(skill?.manifest.source.uri).toContain("github.com/Evref-BL/MCP");
      expect(skill?.manifest.source.uri).toContain(`user/skills/${skillId}`);
      expect(skill?.files["SKILL.md"]).toContain(`name: ${skillId}`);
    }

    const ciSkill = skillsById.get("pharo-ci-repro");
    expect(ciSkill?.files["references/pharo-smalltalkci.md"]).toContain(
      "Pharo smalltalkCI Log Reading Notes",
    );
    expect(ciSkill?.files["scripts/run-smalltalkci-docker.sh"]).toContain(
      "docker run --rm --platform linux/amd64",
    );
  });

  it("contributes PLexus status only for DevNexus-Pharo projects", () => {
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-project-"), "Project");
    const plexusPath = path.join(projectRoot, plexusProjectConfigFileName);
    const unmanagedConfig = projectConfig();

    expect(
      devNexusPharoExtension.projectStatus?.({
        projectRoot,
        projectConfig: unmanagedConfig,
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
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(plexusPath, "{}", "utf8");
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
