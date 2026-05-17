import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultCoreSkillPack } from "dev-nexus";
import { main, usage } from "./cli.js";
import { codexConfigPath } from "./codexConfig.js";
import {
  initNexusHome,
  loadProjectConfig,
  loadHomeConfig,
  devNexusProjectConfigFileName,
  saveHomeConfig,
  saveProjectConfig,
} from "./config.js";
import {
  defaultPlexusImageExecutionPolicy,
  devNexusPharoProjectExtensionConfigKey,
  devNexusPharoSkillPack,
  plexusProjectConfigFileName,
} from "./devNexusPharoExtension.js";
import type { GitCommandResult, GitRunner } from "./nexusProjectService.js";
import { createWorkItemService } from "./workItemService.js";

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
    expect(usage()).toContain("dev-nexus-pharo codex worktree guide");
    expect(usage()).toContain("dev-nexus-pharo codex worktree list");
    expect(usage()).toContain("dev-nexus-pharo codex worktree status <id>");
    expect(usage()).toContain("dev-nexus-pharo codex worktree prepare <project>");
    expect(usage()).toContain("dev-nexus-pharo codex worktree record <id>");
    expect(usage()).toContain("dev-nexus-pharo codex worktree archive <id>");
    expect(usage()).toContain("dev-nexus-pharo project create <name>");
    expect(usage()).toContain("dev-nexus-pharo project configure-tracker <id-or-path>");
    expect(usage()).toContain("dev-nexus-pharo project link-tracker <id-or-path>");
    expect(usage()).toContain("dev-nexus-pharo project sync-tracker <id-or-path>");
    expect(usage()).toContain("legacy; use dev-nexus project tracker configure");
    expect(usage()).toContain("Legacy compatibility wrapper. Prefer dev-nexus project tracker configure");
    expect(usage()).toContain("Legacy Vibe Kanban registration wrapper");
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
    expect(usage()).toContain("--tracker-project-id");
    expect(usage()).toContain("--sync-tracker");
    expect(usage()).toContain("--generic");
    expect(usage()).toContain("--repository-owner");
    expect(usage()).toContain("--repository-name");
    expect(usage()).toContain("--repository-id");
    expect(usage()).toContain("--no-open-browser");
    expect(usage()).toContain("--state <active|archived>");
    expect(usage()).toContain("--id <worktree-id>");
    expect(usage()).toContain("--component-id");
    expect(usage()).toContain("--work-item-id");
    expect(usage()).toContain("--comment-work-item");
    expect(usage()).toContain("--commit-id");
    expect(usage()).toContain("--publication-decision");
    expect(usage()).toContain("--remove-worktree");
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

  it("prepares and archives Codex worktrees from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Prepared");
    initHome(homePath);
    fs.mkdirSync(projectRoot, { recursive: true });
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "prepared",
      name: "Prepared",
      projectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "prepared",
      name: "Prepared",
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
      workTracking: {
        provider: "local",
        storePath: path.join(".tracker", "items.json"),
      },
    });
    const workItem = await createWorkItemService({
      homePath,
      now: () => "2026-05-15T11:10:00.000Z",
    }).createWorkItem({
      project: "prepared",
      title: "FCD-900",
    });
    fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), "# Agent guide\n", "utf8");
    fs.mkdirSync(path.dirname(codexConfigPath(projectRoot)), { recursive: true });
    fs.writeFileSync(codexConfigPath(projectRoot), 'model = "gpt-5.3-codex"\n', "utf8");
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const context = { gitRunner: fakeWorktreeGitRunner(calls) };

    await expect(
      main(
        [
          "codex",
          "worktree",
          "prepare",
          "prepared",
          "--home",
          homePath,
          "--branch",
          "codex/fcd-900",
          "--work-item-id",
          workItem.id,
          "--comment-work-item",
          "--json",
        ],
        context,
      ),
    ).resolves.toBe(0);
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "codex-fcd-900");
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      ok: true,
      projectRoot,
      componentId: "primary",
      sourceRoot: projectRoot,
      worktreePath,
      branchName: "codex/fcd-900",
      metadataRecord: {
        id: "prepared:codex/fcd-900",
        workItem: {
          id: workItem.id,
        },
      },
      trackerComment: {
        id: "local-comment-1",
        body: expect.stringContaining("Codex worktree prepared."),
      },
    });

    await expect(
      main(
        [
          "codex",
          "worktree",
          "list",
          "--home",
          homePath,
          "--project",
          "prepared",
          "--state",
          "active",
          "--json",
        ],
        context,
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(String(log.mock.calls[1]?.[0]))).toMatchObject({
      ok: true,
      worktrees: [
        {
          metadataRecord: {
            id: "prepared:codex/fcd-900",
            state: "active",
          },
          worktreeExists: true,
        },
      ],
    });

    await expect(
      main(
        [
          "codex",
          "worktree",
          "status",
          "prepared:codex/fcd-900",
          "--home",
          homePath,
          "--json",
        ],
        context,
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(String(log.mock.calls[2]?.[0]))).toMatchObject({
      ok: true,
      worktree: {
        metadataRecord: {
          id: "prepared:codex/fcd-900",
          branchName: "codex/fcd-900",
        },
        projectRootExists: true,
        sourceRootExists: true,
        worktreeExists: true,
      },
    });

    await expect(
      main(
        [
          "codex",
          "worktree",
          "record",
          "prepared:codex/fcd-900",
          "--home",
          homePath,
          "--commit-id",
          "abc123",
          "--verification-command",
          "npm test",
          "--verification-status",
          "passed",
          "--verification-summary",
          "164 tests passed",
          "--publication-decision",
          "review_handoff",
          "--pr-url",
          "https://example.test/pr/1",
          "--reason",
          "Ready for review",
          "--json",
        ],
        context,
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(String(log.mock.calls[3]?.[0]))).toMatchObject({
      ok: true,
      metadataRecord: {
        id: "prepared:codex/fcd-900",
        execution: {
          commitIds: ["abc123"],
          verification: [
            {
              command: "npm test",
              status: "passed",
              summary: "164 tests passed",
            },
          ],
          publicationDecision: {
            type: "review_handoff",
            prUrl: "https://example.test/pr/1",
            reason: "Ready for review",
          },
        },
      },
    });

    await expect(
      main(
        [
          "codex",
          "worktree",
          "archive",
          "prepared:codex/fcd-900",
          "--home",
          homePath,
          "--remove-worktree",
          "--comment-work-item",
          "--json",
        ],
        context,
      ),
    ).resolves.toBe(0);

    expect(JSON.parse(String(log.mock.calls[4]?.[0]))).toMatchObject({
      ok: true,
      removedWorktree: true,
      metadataRecord: {
        id: "prepared:codex/fcd-900",
        state: "archived",
        execution: {
          commitIds: ["abc123"],
        },
      },
      trackerComment: {
        id: "local-comment-2",
        body: expect.stringContaining("Codex worktree archived."),
      },
    });
    expect(JSON.parse(String(log.mock.calls[4]?.[0])).trackerComment.body).toContain(
      "Removed worktree: yes",
    );
    expect(fs.existsSync(worktreePath)).toBe(false);
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          cwd: projectRoot,
          args: ["worktree", "add", "-b", "codex/fcd-900", worktreePath],
        },
        {
          cwd: worktreePath,
          args: ["rev-parse", "--git-path", "info/exclude"],
        },
        {
          cwd: projectRoot,
          args: ["worktree", "remove", worktreePath],
        },
      ]),
    );
  });

  it("prints direct Codex worktree workflow guidance from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    initHome(homePath);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "codex",
        "worktree",
        "guide",
        "--home",
        homePath,
        "--project",
        "prepared",
        "--work-item-id",
        "local-1",
        "--comment-work-item",
        "--remove-worktree",
        "--publication-decision",
        "review_handoff",
        "--json",
      ]),
    ).resolves.toBe(0);

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      ok: true,
      homePath,
      project: "prepared",
      workItemId: "local-1",
      worktree: null,
    });
    expect(payload.steps).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Prepare worktree",
        command: expect.stringContaining("--comment-work-item"),
      }),
      expect.objectContaining({
        title: "Run Codex directly",
        detail: expect.stringContaining("Do not create a Vibe workspace"),
      }),
    ]));
    expect(payload.notes).toEqual(expect.arrayContaining([
      expect.stringContaining("read-only"),
      expect.stringContaining("Vibe"),
    ]));
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

  it("links a project to a Vibe Kanban project id from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Linked");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "linked",
      name: "Linked",
      projectRoot: projectRoot,
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
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
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
        "link-tracker",
        "linked",
        "--home",
        homePath,
        "--tracker-project-id",
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
      deprecation: {
        status: "deprecated",
        command: "dev-nexus-pharo project link-tracker",
        replacement: "dev-nexus project tracker link",
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

  it("emits a deprecation notice for legacy tracker CLI wrappers", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Notice");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "notice",
      name: "Notice",
      projectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "notice",
      name: "Notice",
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
    vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      main([
        "project",
        "configure-tracker",
        "notice",
        "--home",
        homePath,
        "--provider",
        "local",
        "--store-path",
        ".tracker/items.json",
      ]),
    ).resolves.toBe(0);

    const notice = String(error.mock.calls[0]?.[0]);
    expect(notice).toContain(
      "Deprecated: dev-nexus-pharo project configure-tracker",
    );
    expect(notice).toContain("dev-nexus project tracker configure");
  });

  it("configures GitHub work tracking from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "GitHubTracked");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "github-tracked",
      name: "GitHubTracked",
      projectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "github-tracked",
      name: "GitHubTracked",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "https://github.com/example/project.git",
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "project",
        "configure-tracker",
        "github-tracked",
        "--home",
        homePath,
        "--provider",
        "github",
        "--host",
        "github.enterprise.test",
        "--repository-owner",
        "example",
        "--repository-name",
        "project",
        "--json",
      ]),
    ).resolves.toBe(0);

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      ok: true,
      workTracking: {
        provider: "github",
        host: "github.enterprise.test",
        repository: {
          owner: "example",
          name: "project",
        },
      },
      project: {
        id: "github-tracked",
        workTracking: {
          provider: "github",
        },
      },
      deprecation: {
        status: "deprecated",
        command: "dev-nexus-pharo project configure-tracker",
        replacement: "dev-nexus project tracker configure",
      },
    });
    expect(loadProjectConfig(projectRoot).workTracking).toEqual(payload.workTracking);
  });

  it("configures GitLab work tracking from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "GitLabTracked");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "gitlab-tracked",
      name: "GitLabTracked",
      projectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "gitlab-tracked",
      name: "GitLabTracked",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "https://gitlab.com/example/project.git",
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "project",
        "configure-tracker",
        "gitlab-tracked",
        "--home",
        homePath,
        "--provider",
        "gitlab",
        "--host",
        "gitlab.enterprise.test",
        "--repository-id",
        "example/project",
        "--json",
      ]),
    ).resolves.toBe(0);

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      ok: true,
      workTracking: {
        provider: "gitlab",
        host: "gitlab.enterprise.test",
        repository: {
          id: "example/project",
        },
      },
      project: {
        id: "gitlab-tracked",
        workTracking: {
          provider: "gitlab",
        },
      },
    });
    expect(loadProjectConfig(projectRoot).workTracking).toEqual(payload.workTracking);
  });

  it("configures Jira work tracking from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "JiraTracked");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push({
      id: "jira-tracked",
      name: "JiraTracked",
      projectRoot: projectRoot,
    });
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "jira-tracked",
      name: "JiraTracked",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "https://example.com/jira-tracked.git",
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
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      main([
        "project",
        "configure-tracker",
        "jira-tracked",
        "--home",
        homePath,
        "--provider",
        "jira",
        "--host",
        "example.atlassian.net",
        "--project-key",
        "FCD",
        "--issue-type",
        "Bug",
        "--json",
      ]),
    ).resolves.toBe(0);

    const payload = JSON.parse(String(log.mock.calls[0]?.[0]));
    expect(payload).toMatchObject({
      ok: true,
      workTracking: {
        provider: "jira",
        host: "example.atlassian.net",
        projectKey: "FCD",
        issueType: "Bug",
      },
      project: {
        id: "jira-tracked",
        workTracking: {
          provider: "jira",
        },
      },
    });
    expect(loadProjectConfig(projectRoot).workTracking).toEqual(payload.workTracking);
  });

  it("syncs a project repo and board to Vibe Kanban from the CLI", async () => {
    const homePath = path.join(makeTempDir("dev-nexus-pharo-parent-"), "home");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Synced");
    initHome(homePath);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.ports.vibeKanban = 3400;
    homeConfig.projects.push({
      id: "synced",
      name: "Synced",
      projectRoot: projectRoot,
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
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: null,
      },
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
    });
    const fetchMock = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
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

        if (url === "http://127.0.0.1:3400/api/repos/repo-synced") {
          return new Response(
            JSON.stringify({
              success: true,
              data: {
                id: "repo-synced",
                path: projectRoot,
                setup_script: JSON.parse(String(init?.body)).setup_script,
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
        "sync-tracker",
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
      deprecation: {
        status: "deprecated",
        command: "dev-nexus-pharo project sync-tracker",
      },
    });
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

    return {
      args: argsArray,
      stdout: "",
      stderr: "",
      exitCode: 0,
    };
  };
}
