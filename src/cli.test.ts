import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main, usage } from "./cli.js";
import { codexConfigPath } from "./codexConfig.js";
import {
  initPharoNexusHome,
  loadHomeConfig,
  pharoNexusProjectConfigFileName,
  plexusProjectConfigFileName,
  saveHomeConfig,
  saveProjectConfig,
} from "./config.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("pharo-nexus cli", () => {
  it("documents the top-level commands", () => {
    expect(usage()).toContain("pharo-nexus init [home]");
    expect(usage()).toContain("pharo-nexus start [home]");
    expect(usage()).toContain("pharo-nexus status [home]");
    expect(usage()).toContain("pharo-nexus stop [home]");
    expect(usage()).toContain("pharo-nexus mcp");
    expect(usage()).toContain("pharo-nexus codex init <workspace>");
    expect(usage()).toContain("pharo-nexus codex doctor <workspace>");
    expect(usage()).toContain("pharo-nexus project create <name>");
    expect(usage()).toContain("pharo-nexus project link-kanban <id-or-path>");
    expect(usage()).toContain("pharo-nexus project sync-kanban <id-or-path>");
    expect(usage()).toContain("pharo-nexus vibe-kanban start <home>");
    expect(usage()).toContain("pharo-nexus vibe-kanban status <home>");
    expect(usage()).toContain("pharo-nexus vibe-kanban stop <home>");
    expect(usage()).toContain("pharo-nexus vibe-backend start <home>");
    expect(usage()).toContain("pharo-nexus vibe-backend status <home>");
    expect(usage()).toContain("pharo-nexus vibe-backend stop <home>");
    expect(usage()).toContain("pharo-nexus vibe-kanban mcp-config install");
    expect(usage()).toContain("--interactive");
    expect(usage()).toContain("--vibe-project-id");
    expect(usage()).toContain("--sync-vibe-kanban");
    expect(usage()).toContain("--no-open-browser");
    expect(usage()).toContain("--json");
  });

  it("initializes a home from the CLI with human-readable feedback", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "init",
        homePath,
        "--vibe-kanban-port",
        "3100",
        "--plexus-mcp-port",
        "7332",
      ]),
    ).resolves.toBe(0);

    expect(loadHomeConfig(homePath).ports).toEqual({
      vibeKanban: 3100,
      pharoNexusMcp: 7330,
      plexusMcp: 7332,
    });
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        "PharoNexus home initialized.",
        `  Home: ${homePath}`,
        `  Config: ${path.join(homePath, "pharo-nexus.home.json")}`,
        "  pharo-nexus start",
      ]),
    );
  });

  it("uses PHARO_NEXUS_HOME when init has no explicit home", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "env-home");
    vi.stubEnv("PHARO_NEXUS_HOME", homePath);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["init"])).resolves.toBe(0);

    expect(loadHomeConfig(homePath).paths.projectsRoot).toBe(
      path.join(homePath, "projects"),
    );
  });

  it("supports JSON output for init", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "init",
        homePath,
        "--vibe-kanban-port",
        "3100",
        "--plexus-mcp-port",
        "7332",
        "--json",
      ]),
    ).resolves.toBe(0);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      homePath,
    });
  });

  it("initializes Codex MCP config for a workspace while preserving existing settings", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    const workspacePath = makeTempDir("pharo-nexus-workspace-");
    initHome(homePath);
    const configPath = codexConfigPath(workspacePath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, 'model = "gpt-5.3-codex"\n', "utf8");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main(["codex", "init", workspacePath, "--home", homePath]),
    ).resolves.toBe(0);

    const content = fs.readFileSync(configPath, "utf8");
    expect(content).toContain('model = "gpt-5.3-codex"');
    expect(content).toContain("[mcp_servers.pharo_nexus]");
    expect(content).toContain("[mcp_servers.plexus]");
    expect(content).toContain("[mcp_servers.vibe_kanban]");
    expect(log.mock.calls.map((call) => String(call[0]))).toContain(
      "Codex config updated.",
    );
  });

  it("returns a non-zero doctor result when Codex config is missing", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    const workspacePath = makeTempDir("pharo-nexus-workspace-");
    initHome(homePath);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main(["codex", "doctor", workspacePath, "--home", homePath, "--json"]),
    ).resolves.toBe(1);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: false,
      checks: [
        {
          name: "config",
          status: "failed",
        },
      ],
    });
  });

  it("uses PHARO_NEXUS_HOME for status when no home is passed", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    initHome(homePath);
    vi.stubEnv("PHARO_NEXUS_HOME", homePath);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["status"])).resolves.toBe(0);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      homePath: path.resolve(homePath),
      running: false,
    });
  });

  it.runIf(gitIsAvailable())(
    "creates a PharoNexus project from the CLI",
    async () => {
      const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
      const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "CliProject");
      initHome(homePath);
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(
        main([
          "project",
          "create",
          "CliProject",
          "--home",
          homePath,
          "--root",
          projectRoot,
          "--git-init",
          "--json",
        ]),
      ).resolves.toBe(0);

      const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(payload).toMatchObject({
        ok: true,
        projectRoot,
        projectConfig: {
          id: "cli-project",
          name: "CliProject",
        },
        git: {
          operation: "init",
        },
      });
      expect(
        fs.existsSync(path.join(projectRoot, pharoNexusProjectConfigFileName)),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName)),
      ).toBe(true);
      expect(loadHomeConfig(homePath).projects).toEqual([
        {
          id: "cli-project",
          name: "CliProject",
          plexusProjectRoot: projectRoot,
        },
      ]);
    },
  );

  it.runIf(gitIsAvailable())(
    "imports an existing PharoNexus project from the CLI",
    async () => {
      const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
      const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "ImportedCliProject");
      initHome(homePath);
      fs.mkdirSync(projectRoot, { recursive: true });
      spawnSync("git", ["init", projectRoot], {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});

      await expect(
        main([
          "project",
          "import",
          projectRoot,
          "--home",
          homePath,
          "--name",
          "ImportedCliProject",
          "--json",
        ]),
      ).resolves.toBe(0);

      const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
      expect(payload).toMatchObject({
        ok: true,
        projectRoot,
        projectConfig: {
          id: "imported-cli-project",
          name: "ImportedCliProject",
        },
        git: {
          operation: "import",
        },
      });
      expect(loadHomeConfig(homePath).projects).toEqual([
        {
          id: "imported-cli-project",
          name: "ImportedCliProject",
          plexusProjectRoot: projectRoot,
        },
      ]);
    },
  );

  it("lists and reports project status from the CLI", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Listed");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "listed",
      name: "Listed",
      plexusProjectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "listed",
      name: "Listed",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "https://github.com/example/listed.git",
        defaultBranch: "main",
      },
      plexusProjectConfig: plexusProjectConfigFileName,
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: "kanban-listed",
      },
    });
    fs.writeFileSync(
      path.join(projectRoot, plexusProjectConfigFileName),
      JSON.stringify({
        name: "Listed",
        kanban: { provider: "vibe-kanban", projectId: "listed" },
        images: [],
      }),
      "utf8",
    );
    fs.mkdirSync(path.join(projectRoot, "worktrees"), { recursive: true });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main(["project", "list", "--home", homePath, "--json"]),
    ).resolves.toBe(0);
    await expect(
      main(["project", "status", "listed", "--home", homePath, "--json"]),
    ).resolves.toBe(0);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      projects: [
        {
          id: "listed",
          name: "Listed",
          projectRoot,
          repo: {
            remoteUrl: "https://github.com/example/listed.git",
            defaultBranch: "main",
          },
          vibeKanbanProjectId: "kanban-listed",
          plexusProjectConfigPath: path.join(projectRoot, plexusProjectConfigFileName),
          worktreesRoot: path.join(projectRoot, "worktrees"),
        },
      ],
    });
    expect(JSON.parse(String(log.mock.calls[1]?.[0]))).toMatchObject({
      ok: true,
      project: {
        id: "listed",
        name: "Listed",
        projectRoot,
      },
    });
  });

  it("links a project to a Vibe Kanban project id from the CLI", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Linked");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "linked",
      name: "Linked",
      plexusProjectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "linked",
      name: "Linked",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      plexusProjectConfig: plexusProjectConfigFileName,
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
    fs.writeFileSync(
      path.join(projectRoot, plexusProjectConfigFileName),
      JSON.stringify({
        name: "Linked",
        kanban: { provider: "vibe-kanban", projectId: "linked" },
        images: [],
      }),
      "utf8",
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "project",
        "link-kanban",
        "linked",
        "--home",
        homePath,
        "--vibe-project-id",
        "vk-linked",
        "--json",
      ]),
    ).resolves.toBe(0);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      vibeKanbanProjectId: "vk-linked",
      project: {
        id: "linked",
        name: "Linked",
        vibeKanbanProjectId: "vk-linked",
      },
      plexusProjectConfig: {
        kanban: {
          provider: "vibe-kanban",
          projectId: "vk-linked",
        },
      },
    });
    expect(loadHomeConfig(homePath).projects[0]).toMatchObject({
      id: "linked",
      vibeKanbanProjectId: "vk-linked",
    });
  });

  it("syncs a project repo and board to Vibe Kanban from the CLI", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "Synced");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.ports.vibeKanban = 3400;
    homeConfig.projects.push({
      id: "synced",
      name: "Synced",
      plexusProjectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "synced",
      name: "Synced",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      plexusProjectConfig: plexusProjectConfigFileName,
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
    const fetchMock = vi.fn(
      async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "http://127.0.0.1:3400/api/repos") {
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

        if (url === "http://127.0.0.1:3400/api/info") {
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

        if (url === "http://127.0.0.1:3400/api/auth/token") {
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
    vi.stubGlobal("fetch", fetchMock);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "project",
        "sync-kanban",
        "synced",
        "--home",
        homePath,
        "--json",
      ]),
    ).resolves.toBe(0);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:3400/api/repos",
    );
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
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
      vibeKanbanBoard: {
        boardId: "board-synced",
      },
    });
  });

  it("installs PLexus MCP config into Vibe Kanban from the CLI", async () => {
    const homePath = path.join(makeTempDir("pharo-nexus-parent-"), "home");
    initHome(homePath);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const postedBodies: unknown[] = [];
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.method === "POST") {
          postedBodies.push(JSON.parse(String(init.body)));
          return new Response(
            JSON.stringify({
              success: true,
              data: "Updated MCP server configuration",
            }),
            { status: 200 },
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            data: {
              mcp_config: {
                servers: {
                  existing: {
                    command: "node",
                    args: ["existing.js"],
                  },
                },
              },
            },
          }),
          { status: 200 },
        );
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      main([
        "vibe-kanban",
        "mcp-config",
        "install",
        homePath,
        "--executor",
        "codex",
        "--server-name",
        "plexus_local",
        "--port",
        "3000",
      ]),
    ).resolves.toBe(0);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/api/mcp-config?executor=CODEX",
    );
    expect(postedBodies).toEqual([
      {
        servers: {
          existing: {
            command: "node",
            args: ["existing.js"],
          },
          pharo_nexus: {
            type: "http",
            url: "http://127.0.0.1:7330/mcp",
          },
          plexus_local: {
            type: "http",
            url: "http://127.0.0.1:7331/mcp",
          },
        },
      },
    ]);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      executor: "CODEX",
      pharoNexus: {
        serverName: "pharo_nexus",
      },
      plexus: {
        serverName: "plexus_local",
      },
      updated: true,
    });
  });
});

function initHome(homePath: string): void {
  initPharoNexusHome({ homePath });
}

function gitIsAvailable(): boolean {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  return result.status === 0;
}
