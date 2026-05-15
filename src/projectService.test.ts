import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codexConfigPath } from "./codexConfig.js";
import {
  initPharoNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  devNexusProjectConfigFileName,
  saveProjectConfig,
} from "./config.js";
import { plexusProjectConfigFileName } from "./pharoNexusExtension.js";
import {
  configurePharoNexusProjectTracker,
  createPharoNexusProject,
  getPharoNexusProjectStatus,
  importPharoNexusProject,
  linkPharoNexusProjectTracker,
  listPharoNexusProjects,
  PharoNexusProjectError,
  syncPharoNexusProjectTracker,
  type GitCommandResult,
  type GitRunner,
} from "./projectService.js";

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

describe("PharoNexus project service", () => {
  it("creates a new git-initialized project under the configured projects root", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectsRoot = path.join(homePath, "custom-projects");
    initPharoNexusHome({ homePath, projectsRoot });
    const gitCalls: string[][] = [];

    const result = createPharoNexusProject({
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
    expect(loadProjectConfig(result.projectRoot)).toEqual({
      version: 1,
      id: "my-project",
      name: "MyProject",
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
    expect(
      JSON.parse(fs.readFileSync(result.plexusProjectConfigPath, "utf8")),
    ).toEqual({
      name: "MyProject",
      kanban: {
        provider: "vibe-kanban",
        projectId: "my-project",
      },
      images: [],
    });
    expect(fs.existsSync(result.worktreesRoot)).toBe(true);
    expect(fs.readFileSync(result.agentsPath, "utf8")).toBe(defaultAgentsContent());
    expect(result.codexConfigPath).toBe(codexConfigPath(result.projectRoot));
    const codexConfig = fs.readFileSync(result.codexConfigPath, "utf8");
    expect(codexConfig).toContain("[mcp_servers.pharo_nexus]");
    expect(codexConfig).toContain("[mcp_servers.plexus]");
    expect(codexConfig).toContain("[mcp_servers.vibe_kanban]");
    expect(codexConfig.match(/default_tools_approval_mode = "approve"/gu)).toHaveLength(3);
    const suggestedFirstPrompt = fs.readFileSync(
      result.suggestedFirstPromptPath,
      "utf8",
    );
    expect(suggestedFirstPrompt).toContain(
      "This is a Codex and PharoNexus project for MyProject.",
    );
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

  it("creates a managed project root and clones a remote source under it", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "RemoteProject");
    const gitCalls: string[][] = [];

    const result = createPharoNexusProject({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "LinkedAtCreate");

    const result = createPharoNexusProject({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Listed");
    createPharoNexusProject({
      homePath,
      name: "Listed",
      root: projectRoot,
      from: "https://github.com/example/listed.git",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(listPharoNexusProjects({ homePath })).toEqual({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Status");
    createPharoNexusProject({
      homePath,
      name: "Status",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const byId = getPharoNexusProjectStatus({
      homePath,
      project: "status",
    });
    const byPath = getPharoNexusProjectStatus({
      homePath,
      project: projectRoot,
    });
    const byConfigPath = getPharoNexusProjectStatus({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Launcher");
    createPharoNexusProject({
      homePath,
      name: "Pharo Launcher MCP",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(projectRoot.startsWith(process.cwd())).toBe(false);
    const result = getPharoNexusProjectStatus({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });

    expect(() =>
      getPharoNexusProjectStatus({
        homePath,
        project: "pharo-launcher-mcp",
      }),
    ).toThrow(
      `No registered project matched "pharo-launcher-mcp". ` +
        `Path fallback checked "${path.resolve("pharo-launcher-mcp")}" and failed: ` +
        `PharoNexus project is not initialized: ${path.join(
          path.resolve("pharo-launcher-mcp"),
          devNexusProjectConfigFileName,
        )}`,
    );
  });

  it("links an existing PharoNexus project to a Vibe Kanban project id", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Linkable");
    createPharoNexusProject({
      homePath,
      name: "Linkable",
      root: projectRoot,
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = linkPharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Unregistered");
    initPharoNexusHome({ homePath });
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
        },
        null,
        2,
      ),
      "utf8",
    );

    linkPharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "GitHubTracked");
    createPharoNexusProject({
      homePath,
      name: "GitHubTracked",
      root: projectRoot,
      vibeKanbanProjectId: "vk-existing",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = configurePharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "GitLabTracked");
    createPharoNexusProject({
      homePath,
      name: "GitLabTracked",
      root: projectRoot,
      vibeKanbanProjectId: "vk-existing",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = configurePharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "JiraTracked");
    createPharoNexusProject({
      homePath,
      name: "JiraTracked",
      root: projectRoot,
      vibeKanbanProjectId: "vk-existing",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    const result = configurePharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "LocalTracked");
    initPharoNexusHome({ homePath });
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

    const result = configurePharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath, vibeKanbanPort: 3200 });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Synced");
    createPharoNexusProject({
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

    const result = await syncPharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    const sourceRoot = path.join(makeTempDir("pharo-nexus-source-"), "ImportedSynced");
    fs.mkdirSync(sourceRoot, { recursive: true });
    initPharoNexusHome({ homePath, vibeKanbanPort: 3200 });
    const projectRoot = path.join(homePath, "projects", "ImportedSynced");
    importPharoNexusProject({
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

    const result = await syncPharoNexusProjectTracker({
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
    const homePath = makeTempDir("pharo-nexus-home-");
    const sourceRoot = path.join(makeTempDir("pharo-nexus-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "Imported");
    const gitCalls: string[][] = [];

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
    expect(fs.existsSync(path.join(projectRoot, devNexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(true);
    expect(fs.existsSync(path.join(sourceRoot, devNexusProjectConfigFileName))).toBe(false);
    expect(fs.existsSync(path.join(sourceRoot, plexusProjectConfigFileName))).toBe(false);
    expect(fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8")).toBe(
      defaultAgentsContent(),
    );
    expect(fs.readFileSync(codexConfigPath(projectRoot), "utf8")).toContain(
      "[mcp_servers.pharo_nexus]",
    );
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "imported",
        name: "Imported",
        projectRoot: projectRoot,
      },
    ]);
  });

  it("imports a repository without touching source-owned agent and Codex files", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const sourceRoot = path.join(makeTempDir("pharo-nexus-source-"), "ImportedOwnedFiles");
    fs.mkdirSync(path.join(sourceRoot, ".codex"), { recursive: true });
    initPharoNexusHome({ homePath });
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

    const result = importPharoNexusProject({
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
    expect(sourceCodexConfig).not.toContain("[mcp_servers.pharo_nexus]");
    const managedCodexConfig = fs.readFileSync(codexConfigPath(projectRoot), "utf8");
    expect(managedCodexConfig).toContain("[mcp_servers.pharo_nexus]");
    expect(managedCodexConfig).toContain("[mcp_servers.plexus]");
    expect(managedCodexConfig).toContain("[mcp_servers.vibe_kanban]");
    expect(managedCodexConfig.match(/default_tools_approval_mode = "approve"/gu)).toHaveLength(3);
    const suggestedFirstPrompt = fs.readFileSync(
      path.join(projectRoot, "suggestedFirstPrompt.md"),
      "utf8",
    );
    expect(suggestedFirstPrompt).toContain(`Inspect the source checkout at ${sourceRoot}.`);
    expect(suggestedFirstPrompt).toContain("Record durable local context in NOTES.md");
  });

  it("imports an existing project config without overwriting it", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Existing");
    fs.mkdirSync(projectRoot, { recursive: true });
    initPharoNexusHome({ homePath });
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

    const result = importPharoNexusProject({
      homePath,
      root: projectRoot,
      name: "Ignored Name",
      gitRunner: fakeGitRunner([], { branch: "main" }),
    });

    expect(result.projectConfig).toEqual(existingConfig);
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

  it("reports registered projects even when project files are missing", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Missing");
    initPharoNexusHome({ homePath });
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

    expect(listPharoNexusProjects({ homePath }).projects[0]).toEqual({
      id: "missing",
      name: "Missing",
      projectRoot,
      repo: null,
      workTracking: null,
      vibeKanbanProjectId: "kanban-missing",
      vibeKanbanRepoId: null,
      projectConfigPath: path.join(projectRoot, devNexusProjectConfigFileName),
      projectConfigExists: false,
      plexusProjectConfigPath: path.join(projectRoot, plexusProjectConfigFileName),
      plexusProjectConfigExists: false,
      worktreesRoot: path.join(projectRoot, "worktrees"),
      worktreesRootExists: false,
    });
  });

  it("rejects duplicate project ids before running git", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const gitCalls: string[][] = [];
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

  it("refuses to create a project in a non-empty directory", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Busy");
    fs.mkdirSync(projectRoot, { recursive: true });
    fs.writeFileSync(path.join(projectRoot, "README.md"), "# Busy\n", "utf8");
    const gitCalls: string[][] = [];

    expect(() =>
      createPharoNexusProject({
        homePath,
        name: "Busy",
        root: projectRoot,
        gitRunner: fakeGitRunner(gitCalls),
      }),
    ).toThrow(/already exists and is not empty/);
    expect(gitCalls).toEqual([]);
  });

  it("rejects mutually exclusive source options", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initPharoNexusHome({ homePath });

    expect(() =>
      createPharoNexusProject({
        homePath,
        name: "Invalid",
        from: "https://github.com/example/invalid.git",
        gitInit: true,
      }),
    ).toThrow("--from and --git-init are mutually exclusive");
  });
});
