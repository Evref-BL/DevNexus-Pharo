import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCoreSkillPack } from "dev-nexus";
import { main, usage } from "../../src/cli.js";
import { codexConfigPath } from "../../src/codexConfig.js";
import {
  initNexusHome,
  loadProjectConfig,
  loadHomeConfig,
  devNexusProjectConfigFileName,
  saveHomeConfig,
  saveProjectConfig,
} from "../../src/config.js";
import {
  defaultPlexusImageExecutionPolicy,
  devNexusPharoProjectExtensionConfigKey,
  devNexusPharoSkillPack,
  plexusProjectConfigFileName,
} from "../../src/devNexusPharoExtension.js";

const tempDirs: string[] = [];
const expectedDevNexusPharoSkillCount =
  defaultCoreSkillPack.length + devNexusPharoSkillPack.length;

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

describe("dev-nexus-pharo cli", () => {
  it("documents the top-level commands", () => {
    expect(usage()).toContain("dev-nexus-pharo init [home]");
    expect(usage()).toContain("dev-nexus-pharo start [home]");
    expect(usage()).toContain("dev-nexus-pharo status [home]");
    expect(usage()).toContain("dev-nexus-pharo stop [home]");
    expect(usage()).toContain("dev-nexus-pharo mcp");
    expect(usage()).toContain("dev-nexus-pharo codex init <workspace>");
    expect(usage()).toContain("dev-nexus-pharo codex doctor <workspace>");
    expect(usage()).toContain("dev-nexus-pharo project create <name>");
    expect(usage()).not.toContain("configure-tracker");
    expect(usage()).not.toContain("link-tracker");
    expect(usage()).not.toContain("sync-tracker");
    expect(usage()).toContain("dev-nexus-pharo project skills status <id-or-path>");
    expect(usage()).toContain("dev-nexus-pharo project skills refresh <id-or-path>");
    expect(usage()).toContain("dev-nexus-pharo vibe-kanban start <home>");
    expect(usage()).toContain("dev-nexus-pharo vibe-kanban status <home>");
    expect(usage()).toContain("dev-nexus-pharo vibe-kanban stop <home>");
    expect(usage()).toContain("dev-nexus-pharo vibe-backend start <home>");
    expect(usage()).toContain("dev-nexus-pharo vibe-backend status <home>");
    expect(usage()).toContain("dev-nexus-pharo vibe-backend stop <home>");
    expect(usage()).toContain("dev-nexus-pharo vibe-kanban mcp-config install");
    expect(usage()).toContain("--interactive");
    expect(usage()).not.toContain("--tracker-project-id");
    expect(usage()).not.toContain("--sync-tracker");
    expect(usage()).toContain("--generic");
    expect(usage()).not.toContain("--repository-owner");
    expect(usage()).not.toContain("--repository-name");
    expect(usage()).not.toContain("--repository-id");
    expect(usage()).toContain("--no-open-browser");
    expect(usage()).toContain("--json");
  });

  it("initializes a home from the CLI with human-readable feedback", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
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
      devNexusPharoMcp: 7330,
      plexusMcp: 7332,
    });
    expect(log.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        "DevNexus-Pharo home initialized.",
        `  Home: ${homePath}`,
        `  Config: ${path.join(homePath, "dev-nexus.home.json")}`,
        "  dev-nexus-pharo start",
      ]),
    );
  });

  it("uses DEV_NEXUS_PHARO_HOME when init has no explicit home", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "env-home");
    vi.stubEnv("DEV_NEXUS_PHARO_HOME", homePath);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["init"])).resolves.toBe(0);

    expect(loadHomeConfig(homePath).paths.projectsRoot).toBe(
      path.join(homePath, "projects"),
    );
  });

  it("supports JSON output for init", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
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

  it("creates a generic DevNexus project from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "GenericCli");
    initHome(homePath);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "project",
        "create",
        "GenericCli",
        "--root",
        projectRoot,
        "--generic",
        "--home",
        homePath,
        "--json",
      ]),
    ).resolves.toBe(0);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "generic-cli",
        name: "GenericCli",
      },
    });
    expect(loadProjectConfig(projectRoot).extensions).toBeUndefined();
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(
      false,
    );
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
  });

  it("initializes Codex MCP config for a workspace while preserving existing settings", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");
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
    expect(content).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(content).toContain("[mcp_servers.plexus]");
    expect(content).toContain("[mcp_servers.vibe_kanban]");
    expect(log.mock.calls.map((call) => String(call[0]))).toContain(
      "Codex config updated.",
    );
  });

  it("returns a non-zero doctor result when Codex config is missing", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");
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

  it("uses DEV_NEXUS_PHARO_HOME for status when no home is passed", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    initHome(homePath);
    vi.stubEnv("DEV_NEXUS_PHARO_HOME", homePath);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(main(["status"])).resolves.toBe(0);

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      homePath: path.resolve(homePath),
      running: false,
    });
  });

  it.runIf(gitIsAvailable())(
    "creates a DevNexus-Pharo project from the CLI",
    async () => {
      const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
      const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "CliProject");
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
        fs.existsSync(path.join(projectRoot, devNexusProjectConfigFileName)),
      ).toBe(true);
      expect(
        fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName)),
      ).toBe(true);
      expect(loadHomeConfig(homePath).projects).toEqual([
        {
          id: "cli-project",
          name: "CliProject",
          projectRoot: projectRoot,
        },
      ]);
    },
  );

  it.runIf(gitIsAvailable())(
    "imports an existing DevNexus-Pharo project from the CLI",
    async () => {
      const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
      const sourceRoot = path.join(makeTempDir("dev-nexus-pharo-source-"), "ImportedCliProject");
      initHome(homePath);
      fs.mkdirSync(sourceRoot, { recursive: true });
      spawnSync("git", ["init", sourceRoot], {
        encoding: "utf8",
        shell: false,
        windowsHide: true,
      });
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const projectRoot = path.join(homePath, "projects", "ImportedCliProject");

      await expect(
        main([
          "project",
          "import",
          sourceRoot,
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
          repo: {
            sourceRoot,
          },
        },
        git: {
          operation: "import",
        },
      });
      expect(loadHomeConfig(homePath).projects).toEqual([
        {
          id: "imported-cli-project",
          name: "ImportedCliProject",
          projectRoot: projectRoot,
        },
      ]);
      expect(fs.existsSync(path.join(sourceRoot, devNexusProjectConfigFileName))).toBe(false);
    },
  );

  it("lists and reports project status from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Listed");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "listed",
      name: "Listed",
      projectRoot: projectRoot,
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
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: "kanban-listed",
      },
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
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
    await expect(
      main(["project", "skills", "status", "listed", "--home", homePath, "--json"]),
    ).resolves.toBe(0);
    await expect(
      main(["project", "skills", "refresh", "listed", "--home", homePath, "--json"]),
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
    expect(JSON.parse(String(log.mock.calls[2]?.[0]))).toMatchObject({
      ok: true,
      project: {
        id: "listed",
      },
      skillStatus: {
        summary: {
          expected: expectedDevNexusPharoSkillCount,
          missing: expectedDevNexusPharoSkillCount,
        },
      },
    });
    expect(JSON.parse(String(log.mock.calls[3]?.[0]))).toMatchObject({
      ok: true,
      project: {
        id: "listed",
      },
      refresh: {
        before: {
          summary: {
            missing: expectedDevNexusPharoSkillCount,
          },
        },
        after: {
          summary: {
            expected: expectedDevNexusPharoSkillCount,
            installed: expectedDevNexusPharoSkillCount,
            missing: 0,
          },
        },
      },
    });
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "dev-nexus-pharo-workflow", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("installs PLexus MCP config into Vibe Kanban from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
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
          dev_nexus_pharo: {
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
      devNexusPharo: {
        serverName: "dev_nexus_pharo",
      },
      plexus: {
        serverName: "plexus_local",
      },
      updated: true,
    });
  });
});

function initHome(homePath: string): void {
  initNexusHome({ homePath });
}

function gitIsAvailable(): boolean {
  const result = spawnSync("git", ["--version"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  return result.status === 0;
}
