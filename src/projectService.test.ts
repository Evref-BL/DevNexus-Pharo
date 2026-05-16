import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexConfigPath } from "./codexConfig.js";
import {
  initNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  devNexusPharoControlProjectId,
  devNexusProjectConfigFileName,
  saveProjectConfig,
} from "./config.js";
import {
  defaultPlexusImageExecutionPolicy,
  devNexusPharoProjectExtensionConfigKey,
  plexusProjectConfigFileName,
} from "./devNexusPharoExtension.js";
import {
  createNexusProject,
  configureNexusProjectTracker,
  getNexusProjectStatus,
  importNexusProject,
  linkNexusProjectTracker,
  listNexusProjects,
  NexusProjectError,
  type GitCommandResult,
  type GitRunner,
} from "./nexusProjectService.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
  syncDevNexusPharoProjectTracker,
} from "./devNexusPharoProjectService.js";
import {
  devNexusPharoPluginId,
  devNexusPharoPluginName,
} from "./devNexusPharoPlugin.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function defaultAgentsContent(): string {
  return fs.readFileSync(
    path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), "AGENTS.md"),
    "utf8",
  );
}

function devNexusPharoPluginConfigExpectation() {
  return expect.objectContaining({
    id: devNexusPharoPluginId,
    name: devNexusPharoPluginName,
  });
}

function expectDevNexusPharoPluginConfig(config: {
  plugins?: Array<{ id: string; name?: string }>;
}): void {
  expect(config.plugins).toContainEqual(devNexusPharoPluginConfigExpectation());
  expect(config.plugins?.filter((plugin) => plugin.id === devNexusPharoPluginId))
    .toHaveLength(1);
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

describe("DevNexus-Pharo project service", () => {
  it("creates a new git-initialized project under the configured projects root", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectsRoot = path.join(homePath, "custom-projects");
    initNexusHome({ homePath, projectsRoot });
    const gitCalls: string[][] = [];

    const result = createDevNexusPharoProject({
      homePath,
      name: "MyProject",
      gitInit: true,
      gitRunner: fakeGitRunner(gitCalls, { branch: "main" }),
    });

    expect(result).toMatchObject({
      homePath,
      projectRoot: path.join(projectsRoot, "MyProject"),
      projectConfigPath: path.join(
        projectsRoot,
        "MyProject",
        devNexusProjectConfigFileName,
      ),
      plexusProjectConfigPath: path.join(
        projectsRoot,
        "MyProject",
        plexusProjectConfigFileName,
      ),
      worktreesRoot: path.join(projectsRoot, "MyProject", "worktrees"),
      agentsPath: path.join(projectsRoot, "MyProject", "AGENTS.md"),
      suggestedFirstPromptPath: path.join(
        projectsRoot,
        "MyProject",
        "suggestedFirstPrompt.md",
      ),
      codexConfigPath: path.join(projectsRoot, "MyProject", ".codex", "config.toml"),
      git: {
        operation: "init",
        remoteUrl: null,
        defaultBranch: "main",
      },
    });
    expect(gitCalls).toEqual([
      ["init", path.join(projectsRoot, "MyProject")],
      [
        "-C",
        path.join(projectsRoot, "MyProject"),
        "symbolic-ref",
        "--short",
        "HEAD",
      ],
    ]);
    const persistedProjectConfig = loadProjectConfig(result.projectRoot);
    expect(result.projectConfig).toEqual(persistedProjectConfig);
    expect(persistedProjectConfig).toEqual({
      version: 1,
      id: "my-project",
      name: "MyProject",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      components: [
        {
          id: "primary",
          name: "MyProject",
          kind: "local",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "main",
          sourceRoot: ".",
          relationships: [],
        },
      ],
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
      plugins: [devNexusPharoPluginConfigExpectation()],
    });
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toEqual({
      name: "MyProject",
      kanban: {
        provider: "vibe-kanban",
        projectId: "my-project",
      },
      images: [],
      imageExecution: defaultPlexusImageExecutionPolicy,
    });
    expect(fs.existsSync(result.worktreesRoot)).toBe(true);
    expect(
      fs.existsSync(
        path.join(result.projectRoot, ".dev-nexus", "skills", "diagnose", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          result.projectRoot,
          ".dev-nexus",
          "skills",
          "dev-nexus-pharo-workflow",
          "SKILL.md",
        ),
      ),
    ).toBe(true);
    expect(fs.readFileSync(result.agentsPath, "utf8")).toBe(defaultAgentsContent());
    expect(result.codexConfigPath).toBe(codexConfigPath(result.projectRoot));
    const codexConfig = fs.readFileSync(result.codexConfigPath, "utf8");
    expect(codexConfig).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(codexConfig).toContain("[mcp_servers.plexus]");
    expect(codexConfig).toContain("[mcp_servers.vibe_kanban]");
    expect(codexConfig).toContain("[mcp_servers.pharo]");
    expect(codexConfig.match(/default_tools_approval_mode = "approve"/gu)).toHaveLength(4);
    const suggestedFirstPrompt = fs.readFileSync(
      result.suggestedFirstPromptPath,
      "utf8",
    );
    expect(suggestedFirstPrompt).toContain(
      "This is a Codex and DevNexus-Pharo project for MyProject.",
    );
    expect(suggestedFirstPrompt).toContain(".dev-nexus");
    expect(suggestedFirstPrompt).toContain("DevNexus-Pharo skills: dev-nexus-pharo-workflow");
    expect(suggestedFirstPrompt).toContain("Kanban project id: (not known yet)");
    expect(suggestedFirstPrompt).toContain("Record durable local context in NOTES.md");
    expect(suggestedFirstPrompt).toContain(
      "commit them in the relevant source repository",
    );
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "my-project",
        name: "MyProject",
        projectRoot: result.projectRoot,
      },
    ]);
  });

  it("creates a generic DevNexus project without DevNexus-Pharo extension files", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectsRoot = path.join(homePath, "custom-projects");
    initNexusHome({ homePath, projectsRoot });
    const gitCalls: string[][] = [];

    const result = createNexusProject({
      homePath,
      name: "PlainTool",
      gitRunner: fakeGitRunner(gitCalls, { branch: "main" }),
    });

    expect(result).toMatchObject({
      homePath,
      projectRoot: path.join(projectsRoot, "PlainTool"),
      projectConfigPath: path.join(
        projectsRoot,
        "PlainTool",
        devNexusProjectConfigFileName,
      ),
      worktreesRoot: path.join(projectsRoot, "PlainTool", "worktrees"),
      projectConfig: {
        id: "plain-tool",
        name: "PlainTool",
      },
      git: {
        operation: "init",
        remoteUrl: null,
        defaultBranch: "main",
      },
    });
    expect(fs.existsSync(path.join(result.projectRoot, plexusProjectConfigFileName))).toBe(
      false,
    );
    expect(result.projectConfig.extensions).toBeUndefined();
    expect(result.projectConfig.plugins).toBeUndefined();
    expect(fs.existsSync(path.join(result.projectRoot, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(codexConfigPath(result.projectRoot))).toBe(false);
    expect(
      fs.existsSync(
        path.join(result.projectRoot, ".dev-nexus", "skills", "diagnose", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(
          result.projectRoot,
          ".dev-nexus",
          "skills",
          "dev-nexus-pharo-workflow",
          "SKILL.md",
        ),
      ),
    ).toBe(false);
    expect(getNexusProjectStatus({ homePath, project: "plain-tool" }).project)
      .toMatchObject({
        id: "plain-tool",
        plexusProjectConfigPath: null,
        plexusProjectConfigExists: false,
      });
  });

  it("creates a managed project root and clones a remote source under it", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "RemoteProject");
    const gitCalls: string[][] = [];

    const result = createDevNexusPharoProject({
      homePath,
      name: "RemoteProject",
      root: projectRoot,
      from: "https://github.com/example/remote-project.git",
      gitRunner: fakeGitRunner(gitCalls, { branch: "trunk" }),
    });

    expect(gitCalls[0]).toEqual(["init", projectRoot]);
    expect(gitCalls[1]).toEqual([
      "clone",
      "https://github.com/example/remote-project.git",
      path.join(projectRoot, "git"),
    ]);
    expect(fs.existsSync(path.join(projectRoot, devNexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "git", devNexusProjectConfigFileName))).toBe(
      false,
    );
    expect(result.projectConfig.repo).toEqual({
      kind: "git",
      remoteUrl: "https://github.com/example/remote-project.git",
      defaultBranch: "trunk",
      sourceRoot: "git",
    });
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "remote-project",
        name: "RemoteProject",
        projectRoot: projectRoot,
      },
    ]);
  });

  it("stores a Vibe Kanban project id during project creation", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "LinkedAtCreate");

    const result = createDevNexusPharoProject({
      homePath,
      name: "LinkedAtCreate",
      root: projectRoot,
      gitInit: true,
      vibeKanbanProjectId: "vk-project-1",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(result.projectConfig.kanban.projectId).toBe("vk-project-1");
    expect(fs.readFileSync(result.suggestedFirstPromptPath, "utf8")).toContain(
      "Kanban project id: vk-project-1",
    );
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toMatchObject({
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-project-1",
      },
    });
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "linked-at-create",
        name: "LinkedAtCreate",
        projectRoot: projectRoot,
        vibeKanbanProjectId: "vk-project-1",
      },
    ]);
  });

  it("lists registered projects with repo and resolved path details", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Listed");
    createDevNexusPharoProject({
      homePath,
      name: "Listed",
      root: projectRoot,
      from: "https://github.com/example/listed.git",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(listNexusProjects({ homePath })).toEqual({
      homePath,
      projects: [
        {
          id: "listed",
          name: "Listed",
          projectRoot,
          repo: {
            kind: "git",
            remoteUrl: "https://github.com/example/listed.git",
            defaultBranch: "main",
            sourceRoot: "git",
          },
          components: [
            {
              id: "primary",
              name: "Listed",
              kind: "git",
              role: "primary",
              remoteUrl: "https://github.com/example/listed.git",
              defaultBranch: "main",
              sourceRoot: path.join(projectRoot, "git"),
              sourceRootExists: true,
              worktreesRoot: path.join(projectRoot, "worktrees", "primary"),
              worktreesRootExists: true,
              workTracking: null,
              workTrackingCapabilities: null,
              workTrackingCapabilityReport: null,
              verification: null,
              publication: null,
              relationships: [],
            },
          ],
          workTracking: null,
          vibeKanbanProjectId: null,
          vibeKanbanRepoId: null,
          projectConfigPath: path.join(projectRoot, devNexusProjectConfigFileName),
          projectConfigExists: true,
          plexusProjectConfigPath: path.join(projectRoot, plexusProjectConfigFileName),
          plexusProjectConfigExists: true,
          worktreesRoot: path.join(projectRoot, "worktrees"),
          worktreesRootExists: true,
        },
      ],
    });
  });

  it("reports project status by id or project path", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Status");
    createDevNexusPharoProject({
      homePath,
      name: "Status",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const byId = getNexusProjectStatus({
      homePath,
      project: "status",
    });
    const byPath = getNexusProjectStatus({
      homePath,
      project: projectRoot,
    });
    const byConfigPath = getNexusProjectStatus({
      homePath,
      project: path.join(projectRoot, devNexusProjectConfigFileName),
    });

    expect(byId.project).toEqual(byPath.project);
    expect(byPath.project).toEqual(byConfigPath.project);
    expect(byId.project).toMatchObject({
      id: "status",
      name: "Status",
      projectRoot,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      vibeKanbanProjectId: null,
      vibeKanbanRepoId: null,
    });
  });

  it("resolves a registered project id before path fallback", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Launcher");
    createDevNexusPharoProject({
      homePath,
      name: "Pharo Launcher MCP",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(projectRoot.startsWith(process.cwd())).toBe(false);
    const result = getNexusProjectStatus({
      homePath,
      project: "pharo-launcher-mcp",
    });

    expect(result.project).toMatchObject({
      id: "pharo-launcher-mcp",
      name: "Pharo Launcher MCP",
      projectRoot,
    });
  });

  it("reports unmatched id/path clearly before path initialization failure details", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });

    expect(() =>
      getNexusProjectStatus({
        homePath,
        project: "pharo-launcher-mcp",
      }),
    ).toThrow(
      `No registered project matched "pharo-launcher-mcp". ` +
        `Path fallback checked "${path.resolve("pharo-launcher-mcp")}" and failed: ` +
        `DevNexus project is not initialized: ${path.join(
          path.resolve("pharo-launcher-mcp"),
          devNexusProjectConfigFileName,
        )}`,
    );
  });

  it("links an existing DevNexus-Pharo project to a Vibe Kanban project id", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Linkable");
    createDevNexusPharoProject({
      homePath,
      name: "Linkable",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = linkNexusProjectTracker({
      homePath,
      project: "linkable",
      trackerProjectId: "vk-linkable",
    });

    expect(result.project.vibeKanbanProjectId).toBe("vk-linkable");
    expect(loadProjectConfig(projectRoot).kanban.projectId).toBe("vk-linkable");
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toMatchObject({
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-linkable",
      },
    });
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "linkable",
        name: "Linkable",
        projectRoot: projectRoot,
        vibeKanbanProjectId: "vk-linkable",
      },
    ]);
  });

  it("links an initialized project by path even when it is not registered yet", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Unregistered");
    initNexusHome({ homePath });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, devNexusProjectConfigFileName),
      JSON.stringify(
        {
          version: 1,
          id: "unregistered",
          name: "Unregistered",
          home: null,
          repo: {
            kind: "local",
            remoteUrl: null,
            defaultBranch: "main",
          },
          worktreesRoot: "worktrees",
          kanban: {
            provider: "vibe-kanban",
            projectId: null,
          },
          extensions: {
            [devNexusPharoProjectExtensionConfigKey]: {},
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    linkNexusProjectTracker({
      homePath,
      project: projectRoot,
      trackerProjectId: "vk-unregistered",
    });

    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "unregistered",
        name: "Unregistered",
        projectRoot: projectRoot,
        vibeKanbanProjectId: "vk-unregistered",
      },
    ]);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(projectRoot, plexusProjectConfigFileName), "utf8"),
      ),
    ).toMatchObject({
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-unregistered",
      },
    });
  });

  it("configures GitHub work tracking without changing PLexus Kanban metadata", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "GitHubTracked");
    createDevNexusPharoProject({
      homePath,
      name: "GitHubTracked",
      root: projectRoot,
      vibeKanbanProjectId: "vk-existing",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = configureNexusProjectTracker({
      homePath,
      project: projectRoot,
      provider: "github",
      host: "github.enterprise.test",
      repositoryOwner: "example",
      repositoryName: "project",
    });

    expect(result.workTracking).toEqual({
      provider: "github",
      host: "github.enterprise.test",
      repository: {
        owner: "example",
        name: "project",
      },
    });
    expect(loadProjectConfig(projectRoot).workTracking).toEqual(result.workTracking);
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toMatchObject({
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-existing",
      },
    });
    expect(result.project).toMatchObject({
      id: "git-hub-tracked",
      workTracking: result.workTracking,
      vibeKanbanProjectId: "vk-existing",
    });
  });

  it("configures GitLab work tracking without changing PLexus Kanban metadata", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "GitLabTracked");
    createDevNexusPharoProject({
      homePath,
      name: "GitLabTracked",
      root: projectRoot,
      vibeKanbanProjectId: "vk-existing",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = configureNexusProjectTracker({
      homePath,
      project: projectRoot,
      provider: "gitlab",
      host: "gitlab.enterprise.test",
      repositoryId: "example/project",
    });

    expect(result.workTracking).toEqual({
      provider: "gitlab",
      host: "gitlab.enterprise.test",
      repository: {
        id: "example/project",
      },
    });
    expect(loadProjectConfig(projectRoot).workTracking).toEqual(result.workTracking);
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toMatchObject({
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-existing",
      },
    });
  });

  it("configures Jira work tracking without changing PLexus Kanban metadata", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "JiraTracked");
    createDevNexusPharoProject({
      homePath,
      name: "JiraTracked",
      root: projectRoot,
      vibeKanbanProjectId: "vk-existing",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = configureNexusProjectTracker({
      homePath,
      project: projectRoot,
      provider: "jira",
      host: "example.atlassian.net",
      projectKey: "FCD",
      issueType: "Bug",
    });

    expect(result.workTracking).toEqual({
      provider: "jira",
      host: "example.atlassian.net",
      projectKey: "FCD",
      issueType: "Bug",
    });
    expect(loadProjectConfig(projectRoot).workTracking).toEqual(result.workTracking);
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toMatchObject({
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-existing",
      },
    });
  });

  it("configures local work tracking for an initialized path and registers it", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "LocalTracked");
    initNexusHome({ homePath });
    fs.mkdirSync(projectRoot, { recursive: true });
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "local-tracked",
      name: "LocalTracked",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });

    const result = configureNexusProjectTracker({
      homePath,
      project: projectRoot,
      provider: "local",
      storePath: ".tracker/items.json",
    });

    expect(result.workTracking).toEqual({
      provider: "local",
      storePath: ".tracker/items.json",
    });
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "local-tracked",
        name: "LocalTracked",
        projectRoot: projectRoot,
      },
    ]);
  });

  it("syncs a project to Vibe Kanban and stores the repo and board ids", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath, vibeKanbanPort: 3200 });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Synced");
    createDevNexusPharoProject({
      homePath,
      name: "Synced",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });
    const fetchMock = vi.fn(
      async (input: string | URL | Request, _init?: RequestInit) => {
        const url = String(input);
        if (url === "http://127.0.0.1:3200/api/repos") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "repo-synced",
                path: projectRoot,
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://127.0.0.1:3200/api/repos/repo-synced") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "repo-synced",
                path: projectRoot,
                setup_script: JSON.parse(String(_init?.body)).setup_script,
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://127.0.0.1:3200/api/info") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                shared_api_base: "http://vibe.test",
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://127.0.0.1:3200/api/auth/token") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                access_token: "token",
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://vibe.test/v1/organizations") {
          return new Response(
            JSON.stringify({
              organizations: [
                {
                  id: "org-1",
                  name: "Personal",
                  is_personal: true,
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === "http://vibe.test/v1/fallback/projects?organization_id=org-1") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  id: "board-synced",
                  organization_id: "org-1",
                  name: "Synced",
                },
              ],
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected Vibe Kanban request: ${url}`);
      },
    );

    const result = await syncDevNexusPharoProjectTracker({
      homePath,
      project: "synced",
      fetch: fetchMock,
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:3200/api/repos",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      path: projectRoot,
      display_name: "Synced",
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "http://127.0.0.1:3200/api/repos/repo-synced",
    );
    const setupPayload = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(setupPayload.setup_script).toContain(projectRoot);
    expect(setupPayload.setup_script).toContain("AGENTS.md");
    expect(setupPayload.setup_script).toContain(".codex");
    expect(setupPayload.setup_script).toContain("node_modules");
    expect(result).toMatchObject({
      vibeKanbanProjectId: "board-synced",
      vibeKanbanRepoId: "repo-synced",
      project: {
        id: "synced",
        vibeKanbanProjectId: "board-synced",
        vibeKanbanRepoId: "repo-synced",
      },
      vibeKanbanRepo: {
        projectId: "repo-synced",
      },
      vibeKanbanRepoSetup: {
        projectId: "repo-synced",
      },
      vibeKanbanBoard: {
        boardId: "board-synced",
      },
    });
    expect(loadProjectConfig(projectRoot).kanban.projectId).toBe("board-synced");
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "synced",
        name: "Synced",
        projectRoot: projectRoot,
        vibeKanbanProjectId: "board-synced",
        vibeKanbanRepoId: "repo-synced",
      },
    ]);
  });

  it("syncs imported projects by registering the source checkout and provisioning workspace setup", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-pharo-source-"), "ImportedSynced");
    fs.mkdirSync(sourceRoot, { recursive: true });
    initNexusHome({ homePath, vibeKanbanPort: 3200 });
    const projectRoot = path.join(homePath, "projects", "ImportedSynced");
    importDevNexusPharoProject({
      homePath,
      root: sourceRoot,
      name: "ImportedSynced",
      gitRunner: fakeGitRunner([], {
        branch: "main",
        remoteUrl: "https://github.com/example/imported-synced.git",
      }),
    });
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "http://127.0.0.1:3200/api/repos") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "repo-imported-synced",
                path: sourceRoot,
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://127.0.0.1:3200/api/repos/repo-imported-synced") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "repo-imported-synced",
                path: sourceRoot,
                setup_script: JSON.parse(String(init?.body)).setup_script,
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://127.0.0.1:3200/api/info") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                shared_api_base: "http://vibe.test",
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://127.0.0.1:3200/api/auth/token") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                access_token: "token",
              },
            }),
            { status: 200 },
          );
        }

        if (url === "http://vibe.test/v1/organizations") {
          return new Response(
            JSON.stringify({
              organizations: [
                {
                  id: "org-1",
                  name: "Personal",
                  is_personal: true,
                },
              ],
            }),
            { status: 200 },
          );
        }

        if (url === "http://vibe.test/v1/fallback/projects?organization_id=org-1") {
          return new Response(
            JSON.stringify({
              projects: [
                {
                  id: "board-imported-synced",
                  organization_id: "org-1",
                  name: "ImportedSynced",
                },
              ],
            }),
            { status: 200 },
          );
        }

        throw new Error(`Unexpected Vibe Kanban request: ${url}`);
      },
    );

    const result = await syncDevNexusPharoProjectTracker({
      homePath,
      project: "imported-synced",
      fetch: fetchMock,
    });

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      path: sourceRoot,
      display_name: "ImportedSynced",
    });
    const setupScript = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
      .setup_script as string;
    expect(setupScript).toContain(projectRoot);
    expect(setupScript).toContain(sourceRoot);
    expect(setupScript).toContain("Add-GitInfoExclude 'AGENTS.md'");
    expect(setupScript).toContain("Add-GitInfoExclude '.codex/'");
    expect(setupScript).toContain("Add-GitInfoExclude 'node_modules/'");
    expect(result.project.vibeKanbanRepoId).toBe("repo-imported-synced");
  });

  it("imports an existing git repository and writes missing project files", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-pharo-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    initNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "Imported");
    const gitCalls: string[][] = [];

    const result = importDevNexusPharoProject({
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
    expect(result).toMatchObject({
      projectRoot,
      projectConfig: {
        id: "imported",
        name: "Imported",
        repo: {
          kind: "git",
          remoteUrl: "https://github.com/example/imported.git",
          defaultBranch: "main",
          sourceRoot,
        },
      },
      git: {
        operation: "import",
        remoteUrl: "https://github.com/example/imported.git",
        defaultBranch: "main",
      },
    });
    expectDevNexusPharoPluginConfig(result.projectConfig);
    expectDevNexusPharoPluginConfig(loadProjectConfig(projectRoot));
    expect(fs.existsSync(path.join(projectRoot, devNexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, devNexusProjectConfigFileName))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, plexusProjectConfigFileName))).toBe(false);
    expect(fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8")).toBe(
      defaultAgentsContent(),
    );
    expect(fs.readFileSync(codexConfigPath(projectRoot), "utf8")).toContain(
      "[mcp_servers.dev_nexus_pharo]",
    );
    expect(fs.readFileSync(codexConfigPath(projectRoot), "utf8")).toContain(
      "[mcp_servers.pharo]",
    );
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "imported",
        name: "Imported",
        projectRoot: projectRoot,
      },
    ]);
  });

  it("imports a generic DevNexus project without touching the source checkout", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-pharo-source-"), "ImportedGeneric");
    fs.mkdirSync(path.join(sourceRoot, ".codex"), { recursive: true });
    fs.writeFileSync(path.join(sourceRoot, "AGENTS.md"), "# Source owned\n", "utf8");
    fs.writeFileSync(
      codexConfigPath(sourceRoot),
      'model = "gpt-5.3-codex"\n',
      "utf8",
    );
    initNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "ImportedGeneric");
    const gitCalls: string[][] = [];

    const result = importNexusProject({
      homePath,
      root: sourceRoot,
      projectRoot,
      name: "ImportedGeneric",
      gitRunner: fakeGitRunner(gitCalls, {
        branch: "main",
        remoteUrl: "https://github.com/example/imported-generic.git",
      }),
    });

    expect(gitCalls).toEqual([
      ["-C", sourceRoot, "rev-parse", "--is-inside-work-tree"],
      ["-C", sourceRoot, "config", "--get", "remote.origin.url"],
      ["-C", sourceRoot, "symbolic-ref", "--short", "HEAD"],
      ["init", projectRoot],
    ]);
    expect(result.projectConfig).toMatchObject({
      id: "imported-generic",
      name: "ImportedGeneric",
      repo: {
        kind: "git",
        remoteUrl: "https://github.com/example/imported-generic.git",
        defaultBranch: "main",
        sourceRoot,
      },
    });
    expect(result.projectConfig.extensions).toBeUndefined();
    expect(result.projectConfig.plugins).toBeUndefined();
    expect(fs.existsSync(path.join(projectRoot, devNexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(codexConfigPath(projectRoot))).toBe(false);
    expect(
      fs.existsSync(path.join(projectRoot, ".dev-nexus", "skills", "diagnose", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "dev-nexus-pharo-workflow", "SKILL.md"),
      ),
    ).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, devNexusProjectConfigFileName))).toBe(false);
    expect(fs.readFileSync(path.join(sourceRoot, "AGENTS.md"), "utf8")).toBe(
      "# Source owned\n",
    );
    expect(getNexusProjectStatus({ homePath, project: "imported-generic" }).project)
      .toMatchObject({
        id: "imported-generic",
        plexusProjectConfigPath: null,
        plexusProjectConfigExists: false,
      });
  });

  it("imports a repository without touching source-owned agent and Codex files", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-pharo-source-"), "ImportedOwnedFiles");
    fs.mkdirSync(path.join(sourceRoot, ".codex"), { recursive: true });
    initNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "ImportedOwnedFiles");
    const agentsPath = path.join(sourceRoot, "AGENTS.md");
    const configPath = codexConfigPath(sourceRoot);
    fs.writeFileSync(agentsPath, "# Project-specific agents\n", "utf8");
    fs.writeFileSync(
      configPath,
      [
        'model = "gpt-5.3-codex"',
        "",
        "[mcp_servers.keep]",
        'command = "node"',
      ].join("\n"),
      "utf8",
    );

    const result = importDevNexusPharoProject({
      homePath,
      root: sourceRoot,
      name: "ImportedOwnedFiles",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(result.agentsPath).toBe(path.join(projectRoot, "AGENTS.md"));
    expect(fs.readFileSync(agentsPath, "utf8")).toBe("# Project-specific agents\n");
    const sourceCodexConfig = fs.readFileSync(configPath, "utf8");
    expect(sourceCodexConfig).toContain('model = "gpt-5.3-codex"');
    expect(sourceCodexConfig).toContain("[mcp_servers.keep]");
    expect(sourceCodexConfig).not.toContain("[mcp_servers.dev_nexus_pharo]");
    const managedCodexConfig = fs.readFileSync(codexConfigPath(projectRoot), "utf8");
    expect(managedCodexConfig).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(managedCodexConfig).toContain("[mcp_servers.plexus]");
    expect(managedCodexConfig).toContain("[mcp_servers.vibe_kanban]");
    expect(managedCodexConfig).toContain("[mcp_servers.pharo]");
    expect(managedCodexConfig.match(/default_tools_approval_mode = "approve"/gu)).toHaveLength(4);
    const suggestedFirstPrompt = fs.readFileSync(
      path.join(projectRoot, "suggestedFirstPrompt.md"),
      "utf8",
    );
    expect(suggestedFirstPrompt).toContain(`Inspect the source checkout at ${sourceRoot}.`);
    expect(suggestedFirstPrompt).toContain("Record durable local context in NOTES.md");
  });

  it("imports an existing project config and marks it DevNexus-Pharo-managed", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Existing");
    fs.mkdirSync(projectRoot, { recursive: true });
    initNexusHome({ homePath });
    const existingConfig = {
      version: 1 as const,
      id: "existing-id",
      name: "Existing Name",
      home: null,
      repo: {
        kind: "local" as const,
        remoteUrl: null,
        defaultBranch: "dev",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban" as const,
        projectId: "kanban-existing",
      },
    };
    fs.writeFileSync(
      path.join(projectRoot, devNexusProjectConfigFileName),
      `${JSON.stringify(existingConfig, null, 2)}\n`,
      "utf8",
    );
    fs.writeFileSync(
      path.join(projectRoot, "suggestedFirstPrompt.md"),
      "# Existing project-owned prompt\n",
      "utf8",
    );

    const result = importDevNexusPharoProject({
      homePath,
      root: projectRoot,
      name: "Ignored Name",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(result.projectConfig).toEqual({
      ...existingConfig,
      components: [
        {
          id: "primary",
          name: "Existing Name",
          kind: "local",
          role: "primary",
          remoteUrl: null,
          defaultBranch: "dev",
          sourceRoot: ".",
          relationships: [],
        },
      ],
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
      plugins: [devNexusPharoPluginConfigExpectation()],
    });
    expect(loadProjectConfig(projectRoot)).toEqual(result.projectConfig);
    expect(fs.readFileSync(result.suggestedFirstPromptPath, "utf8")).toBe(
      "# Existing project-owned prompt\n",
    );
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "existing-id",
        name: "Existing Name",
        projectRoot: projectRoot,
        vibeKanbanProjectId: "kanban-existing",
      },
    ]);
  });

  it("imports an existing project config without duplicating the DevNexus-Pharo plugin", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "ExistingPlugins");
    fs.mkdirSync(projectRoot, { recursive: true });
    initNexusHome({ homePath });
    const existingPlugin = {
      id: "other-plugin",
      name: "Other Plugin",
      version: "1.0.0",
      enabled: true,
      capabilities: [],
    };
    const existingConfig = {
      version: 1 as const,
      id: "existing-plugins",
      name: "Existing Plugins",
      home: null,
      repo: {
        kind: "local" as const,
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban" as const,
        projectId: null,
      },
      plugins: [
        existingPlugin,
        {
          id: devNexusPharoPluginId,
          name: "Existing DevNexus-Pharo",
          version: "0.0.0",
          enabled: true,
          capabilities: [],
        },
      ],
    };
    fs.writeFileSync(
      path.join(projectRoot, devNexusProjectConfigFileName),
      `${JSON.stringify(existingConfig, null, 2)}\n`,
      "utf8",
    );

    const result = importDevNexusPharoProject({
      homePath,
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(result.projectConfig.plugins).toContainEqual(existingPlugin);
    expectDevNexusPharoPluginConfig(result.projectConfig);
    expect(loadProjectConfig(projectRoot).plugins).toEqual(result.projectConfig.plugins);
  });

  it("reports registered projects even when project files are missing", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Missing");
    initNexusHome({ homePath });
    const config = loadHomeConfig(homePath);
    config.projects.push({
      id: "missing",
      name: "Missing",
      projectRoot: projectRoot,
      vibeKanbanProjectId: "kanban-missing",
    });
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(
      path.join(homePath, "dev-nexus.home.json"),
      `${JSON.stringify(config, null, 2)}\n`,
      "utf8",
    );

    expect(listNexusProjects({ homePath }).projects[0]).toEqual({
      id: "missing",
      name: "Missing",
      projectRoot,
      repo: null,
      components: [],
      workTracking: null,
      vibeKanbanProjectId: "kanban-missing",
      vibeKanbanRepoId: null,
      projectConfigPath: path.join(projectRoot, devNexusProjectConfigFileName),
      projectConfigExists: false,
      plexusProjectConfigPath: null,
      plexusProjectConfigExists: false,
      worktreesRoot: path.join(projectRoot, "worktrees"),
      worktreesRootExists: false,
    });
  });

  it("rejects duplicate project ids before running git", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const gitCalls: string[][] = [];
    createDevNexusPharoProject({
      homePath,
      name: "Duplicate",
      gitRunner: fakeGitRunner(gitCalls),
    });
    gitCalls.length = 0;

    expect(() =>
      createDevNexusPharoProject({
        homePath,
        name: "Duplicate",
        root: path.join(makeTempDir("dev-nexus-pharo-projects-"), "Duplicate2"),
        gitRunner: fakeGitRunner(gitCalls),
      }),
    ).toThrow(NexusProjectError);
    expect(gitCalls).toEqual([]);
  });

  it("rejects reserved control project collisions before running git", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const homeConfig = loadHomeConfig(homePath);
    const gitCalls: string[][] = [];

    expect(() =>
      createDevNexusPharoProject({
        homePath,
        name: "Dev Nexus Pharo Control",
        gitRunner: fakeGitRunner(gitCalls),
      }),
    ).toThrow(/reserved control project id/);
    expect(gitCalls).toEqual([]);

    expect(() =>
      createDevNexusPharoProject({
        homePath,
        name: "Normal Project",
        root: homeConfig.controlProject.root,
        gitRunner: fakeGitRunner(gitCalls),
      }),
    ).toThrow(/reserved control project root/);
    expect(gitCalls).toEqual([]);
  });

  it("rejects imported reserved control project ids before running git", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const sourceRoot = makeTempDir("dev-nexus-pharo-source-");
    saveProjectConfig(sourceRoot, {
      version: 1,
      id: devNexusPharoControlProjectId,
      name: "Reserved Control",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
    const gitCalls: string[][] = [];

    expect(() =>
      importDevNexusPharoProject({
        homePath,
        root: sourceRoot,
        gitRunner: fakeGitRunner(gitCalls),
      }),
    ).toThrow(/reserved control project id/);
    expect(gitCalls).toEqual([]);
  });

  it("refuses to create a project in a non-empty directory", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Busy");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "README.md"), "# Busy\n", "utf8");
    const gitCalls: string[][] = [];

    expect(() =>
      createDevNexusPharoProject({
        homePath,
        name: "Busy",
        root: projectRoot,
        gitRunner: fakeGitRunner(gitCalls),
      }),
    ).toThrow(/already exists and is not empty/);
    expect(gitCalls).toEqual([]);
  });

  it("rejects mutually exclusive source options", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });

    expect(() =>
      createDevNexusPharoProject({
        homePath,
        name: "Invalid",
        from: "https://github.com/example/invalid.git",
        gitInit: true,
      }),
    ).toThrow("--from and --git-init are mutually exclusive");
  });
});
