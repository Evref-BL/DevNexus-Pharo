import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaultCoreSkillPack,
  listMcpInputSchemaProviderIssues,
} from "dev-nexus";
import {
  initNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  saveProjectConfig,
} from "./config.js";
import {
  defaultPlexusImageExecutionPolicy,
  devNexusPharoSkillPack,
  plexusProjectConfigFileName,
} from "./devNexusPharoExtension.js";
import {
  callDevNexusPharoMcpTool,
  listDevNexusPharoMcpTools,
  startDevNexusPharoMcpHttpServer,
} from "./mcpServer.js";
import type { GitCommandResult, GitRunner } from "./nexusProjectService.js";

const tempDirs: string[] = [];
const expectedDevNexusPharoSkillCount =
  defaultCoreSkillPack.length + devNexusPharoSkillPack.length;
const removedGenericDevNexusToolNames = [
  "automation_status",
  "target_cycle_list",
  "target_cycle_record",
  "target_report",
  "work_item_create",
  "work_item_list",
  "work_item_get",
  "work_item_update",
  "work_item_comment",
  "work_item_set_status",
];
const removedTrackerToolNames = [
  "project_link_tracker",
  "project_configure_tracker",
  "project_sync_tracker",
];
const removedWorktreeToolNames = [
  "worktree_prepare",
  "worktree_guide",
  "worktree_list",
  "worktree_status",
  "worktree_record_execution",
  "worktree_archive",
];
const removedUnqualifiedProjectToolNames = [
  "project_create",
  "project_import",
  "project_list",
  "project_status",
  "project_skill_status",
  "project_skill_refresh",
];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function freePort(): Promise<number> {
  const server = http.createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        if (!address || typeof address === "string") {
          reject(new Error("Expected TCP server address"));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function parseToolText(result: {
  content: Array<{ type: "text"; text: string }>;
}): unknown {
  return JSON.parse(result.content[0].text);
}

function fakeGitRunner(args: readonly string[], cwd?: string): GitCommandResult {
  const argsArray = [...args];
  if (argsArray[0] === "clone") {
    fs.mkdirSync(argsArray[2], { recursive: true });
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
      stdout: "https://github.com/example/imported.git\n",
      stderr: "",
      exitCode: 0,
    };
  }

  if (argsArray.includes("symbolic-ref")) {
    return {
      args: argsArray,
      stdout: "main\n",
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
}

describe("DevNexus-Pharo MCP server tools", () => {
  it("serves MCP initialize and tools/list over HTTP", async () => {
    const server = await startDevNexusPharoMcpHttpServer({
      port: await freePort(),
    });

    try {
      const initializeResponse = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        }),
      });
      expect(initializeResponse.status).toBe(200);
      await expect(initializeResponse.json()).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "dev-nexus-pharo",
          },
        },
      });

      const listResponse = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      });
      expect(listResponse.status).toBe(200);
      const listPayload = await listResponse.json() as {
        id: number;
        result: { tools: Array<{ name: string }> };
      };
      expect(listPayload).toMatchObject({
        id: 2,
      });
      expect(listPayload.result.tools.map((tool) => tool.name)).toContain(
        "pharo_project_create",
      );
    } finally {
      await server.close();
    }
  });

  it("rejects non-local MCP HTTP origins", async () => {
    const server = await startDevNexusPharoMcpHttpServer({
      port: await freePort(),
    });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://example.test",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("lists project management tools", () => {
    const tools = listDevNexusPharoMcpTools();
    const toolNames = tools.map((tool) => tool.name);
    expect(toolNames).toEqual([
      "pharo_project_create",
      "pharo_project_import",
      "pharo_project_list",
      "pharo_project_status",
      "pharo_project_skill_status",
      "pharo_project_skill_refresh",
    ]);
    for (const toolName of [
      ...removedGenericDevNexusToolNames,
      ...removedTrackerToolNames,
      ...removedWorktreeToolNames,
      ...removedUnqualifiedProjectToolNames,
      "dev_nexus_pharo_work_item_create",
      "dev_nexus_pharo_codex_worktree_prepare",
      "codex_worktree_prepare",
    ]) {
      expect(toolNames).not.toContain(toolName);
    }
    for (const tool of tools) {
      expect(tool.inputSchema).toMatchObject({
        properties: {
          detail: {
            enum: ["summary", "full"],
            default: "summary",
          },
        },
      });
    }
  });

  it("rejects removed generic, tracker, and worktree tools as unknown", async () => {
    for (const toolName of [
      ...removedGenericDevNexusToolNames,
      ...removedTrackerToolNames,
      ...removedWorktreeToolNames,
      ...removedUnqualifiedProjectToolNames,
    ]) {
      const result = await callDevNexusPharoMcpTool(toolName, {});

      expect(result.isError).toBe(true);
      expect(parseToolText(result)).toEqual({
        ok: false,
        error: `Unknown DevNexus-Pharo MCP tool: ${toolName}`,
      });
    }
  });

  it("lists provider-accepted tool input schemas", () => {
    const issues = listDevNexusPharoMcpTools().flatMap((tool) =>
      listMcpInputSchemaProviderIssues(tool.inputSchema).map((issue) => ({
        tool: tool.name,
        ...issue,
      })),
    );

    expect(issues).toEqual([]);
  });

  it("rejects invalid detail values", async () => {
    const result = await callDevNexusPharoMcpTool("pharo_project_list", {
      detail: "everything",
    });

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toEqual({
      ok: false,
      error: "arguments.detail must be summary or full",
    });
  });

  it("creates, lists, and reads a project through MCP tool calls", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "McpProject");
    initNexusHome({ homePath });

    const createResult = await callDevNexusPharoMcpTool(
      "pharo_project_create",
      {
        homePath,
        name: "McpProject",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    const createPayload = parseToolText(createResult);

    expect(createResult.isError).toBeUndefined();
    expect(createPayload).toMatchObject({
      ok: true,
      detail: "summary",
      projectRoot,
      projectConfig: {
        id: "mcp-project",
        name: "McpProject",
      },
      codex: {
        serverCount: 6,
        contentLength: expect.any(Number),
      },
    });
    expect((createPayload as any).codex.content).toBeUndefined();

    const listPayload = parseToolText(
      await callDevNexusPharoMcpTool("pharo_project_list", { homePath }),
    );
    expect(listPayload).toMatchObject({
      ok: true,
      detail: "summary",
      projectCount: 1,
      projects: [
        {
          id: "mcp-project",
          name: "McpProject",
          projectRoot,
        },
      ],
    });

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("pharo_project_status", {
        homePath,
        project: "mcp-project",
      }),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      detail: "summary",
      project: {
        id: "mcp-project",
        projectRoot,
      },
    });
    expect((statusPayload as any).project.components[0].workTrackers).toBeUndefined();

    const fullStatusPayload = parseToolText(
      await callDevNexusPharoMcpTool("pharo_project_status", {
        homePath,
        project: "mcp-project",
        detail: "full",
      }),
    );
    expect(fullStatusPayload).toMatchObject({
      ok: true,
      detail: "full",
      project: {
        components: [
          {
            workTrackers: expect.any(Array),
          },
        ],
      },
    });
  });

  it("inspects and refreshes specialization skills through MCP", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "SkillMcp");
    initNexusHome({ homePath });

    await callDevNexusPharoMcpTool(
      "pharo_project_create",
      {
        homePath,
        name: "SkillMcp",
        root: projectRoot,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );

    fs.rmSync(
      path.join(projectRoot, ".dev-nexus", "skills", "dev-nexus-pharo-workflow"),
      { recursive: true, force: true },
    );
    fs.rmSync(
      path.join(projectRoot, ".dev-nexus", "skills", "pharo-project-load"),
      { recursive: true, force: true },
    );
    fs.appendFileSync(
      path.join(projectRoot, ".dev-nexus", "skills", "diagnose", "SKILL.md"),
      "\nLocal edit.\n",
      "utf8",
    );

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("pharo_project_skill_status", {
        homePath,
        project: "skill-mcp",
      }),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      detail: "summary",
      skillStatus: {
        summary: {
          expected: expectedDevNexusPharoSkillCount,
          missing: 2,
          stale: 1,
        },
        attentionSkillCount: 3,
      },
    });
    expect((statusPayload as any).skillStatus.skills[0].skillPath).toBeUndefined();

    const refreshPayload = parseToolText(
      await callDevNexusPharoMcpTool("pharo_project_skill_refresh", {
        homePath,
        project: "skill-mcp",
      }),
    );
    expect(refreshPayload).toMatchObject({
      ok: true,
      detail: "summary",
      refresh: {
        before: {
          summary: {
            missing: 2,
            stale: 1,
          },
        },
        after: {
          summary: {
            expected: expectedDevNexusPharoSkillCount,
            installed: expectedDevNexusPharoSkillCount,
            missing: 0,
            stale: 0,
          },
        },
        materializedCount: expect.any(Number),
      },
    });
    expect((refreshPayload as any).refresh.before.skills[0].skillPath).toBeUndefined();
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "dev-nexus-pharo-workflow", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "pharo-project-load", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("resolves project status by managed config id before MCP path fallback", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(
      makeTempDir("dev-nexus-pharo-projects-"),
      "pharo-launcher-mcp",
    );
    initNexusHome({ homePath });

    const createResult = await callDevNexusPharoMcpTool(
      "pharo_project_create",
      {
        homePath,
        name: "pharo-launcher-mcp",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    expect(createResult.isError).toBeUndefined();
    expect(projectRoot.startsWith(process.cwd())).toBe(false);
    saveProjectConfig(projectRoot, {
      ...loadProjectConfig(projectRoot),
      id: "pharo-launcher-mcp",
      name: "pharo-launcher-mcp",
    });

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("pharo_project_status", {
        homePath,
        project: "pharo-launcher-mcp",
      }),
    );

    expect(statusPayload).toMatchObject({
      ok: true,
      project: {
        id: "pharo-launcher-mcp",
        projectRoot,
      },
    });
  });

  it("imports an existing repository through an MCP tool call", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-pharo-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    initNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "Imported");

    const result = await callDevNexusPharoMcpTool(
      "pharo_project_import",
      {
        homePath,
        root: sourceRoot,
        name: "Imported",
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );

    expect(result.isError).toBeUndefined();
    expect(parseToolText(result)).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "imported",
        repo: {
          kind: "git",
          remoteUrl: "https://github.com/example/imported.git",
          defaultBranch: "main",
          sourceRoot,
        },
      },
    });
    expect(fs.existsSync(path.join(sourceRoot, "dev-nexus.project.json"))).toBe(false);
  });

  it("supports the first usable control-project scenario through remoteUrl", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const gitCalls: string[][] = [];
    initNexusHome({ homePath });
    const gitRunner: GitRunner = (args: readonly string[]): GitCommandResult => {
      const argsArray = [...args];
      gitCalls.push(argsArray);

      if (argsArray[0] === "init") {
        fs.mkdirSync(path.join(argsArray[1], ".git"), { recursive: true });
      }

      if (argsArray[0] === "clone") {
        fs.mkdirSync(path.join(argsArray[2], ".git"), { recursive: true });
      }

      if (argsArray.includes("symbolic-ref")) {
        return {
          args: argsArray,
          stdout: "main\n",
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

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/repos") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "repo-my-library",
              path: path.join(homePath, "projects", "MyLibrary", "git"),
            },
          }),
          { status: 200 },
        );
      }

      if (url === "http://127.0.0.1:3000/api/repos/repo-my-library") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "repo-my-library",
              path: path.join(homePath, "projects", "MyLibrary", "git"),
              setup_script: JSON.parse(String(init?.body)).setup_script,
            },
          }),
          { status: 200 },
        );
      }

      if (url === "http://127.0.0.1:3000/api/info") {
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

      if (url === "http://127.0.0.1:3000/api/auth/token") {
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
                id: "board-my-library",
                organization_id: "org-1",
                name: "MyLibrary",
              },
            ],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected Vibe Kanban request: ${url}`);
    });

    const result = await callDevNexusPharoMcpTool(
      "pharo_project_create",
      {
        homePath,
        name: "MyLibrary",
        remoteUrl: "https://github.com/me/MyLibrary.git",
        detail: "full",
      },
      { gitRunner, fetch: fetchMock },
    );
    const payload = parseToolText(result);
    const projectRoot = path.join(homePath, "projects", "MyLibrary");

    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "my-library",
        name: "MyLibrary",
        repo: {
          kind: "git",
          remoteUrl: "https://github.com/me/MyLibrary.git",
          defaultBranch: "main",
          sourceRoot: "git",
        },
      },
      plexusProjectConfig: {
        id: "my-library",
        name: "MyLibrary",
        images: [],
        imageExecution: defaultPlexusImageExecutionPolicy,
      },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gitCalls[0]).toEqual(["init", projectRoot]);
    expect(gitCalls[1]).toEqual([
      "clone",
      "https://github.com/me/MyLibrary.git",
      path.join(projectRoot, "git"),
    ]);
    expect(fs.existsSync(path.join(projectRoot, "dev-nexus.project.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "git", "dev-nexus.project.json"))).toBe(false);
    expect(loadProjectConfig(projectRoot)).toMatchObject({
      id: "my-library",
      name: "MyLibrary",
    });
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "my-library",
        name: "MyLibrary",
        projectRoot: projectRoot,
      },
    ]);
  });

  it("returns tool errors as MCP error results", async () => {
    const result = await callDevNexusPharoMcpTool("pharo_project_status", {});

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toMatchObject({
      ok: false,
      error: "arguments.project is required",
    });
  });

});
