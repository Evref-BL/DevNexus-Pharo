import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initPharoNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  plexusProjectConfigFileName,
} from "./config.js";
import {
  callPharoNexusMcpTool,
  listPharoNexusMcpTools,
  startPharoNexusMcpHttpServer,
} from "./mcpServer.js";
import type { GitCommandResult, GitRunner } from "./projectService.js";

const tempDirs: string[] = [];

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

function fakeGitRunner(args: readonly string[]): GitCommandResult {
  const argsArray = [...args];
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

describe("PharoNexus MCP server tools", () => {
  it("serves MCP initialize and tools/list over HTTP", async () => {
    const server = await startPharoNexusMcpHttpServer({
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
            name: "pharo-nexus",
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
        "pharo_nexus_project_create",
      );
    } finally {
      await server.close();
    }
  });

  it("rejects non-local MCP HTTP origins", async () => {
    const server = await startPharoNexusMcpHttpServer({
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
    expect(listPharoNexusMcpTools().map((tool) => tool.name)).toEqual([
      "pharo_nexus_project_create",
      "pharo_nexus_project_import",
      "pharo_nexus_project_link_kanban",
      "pharo_nexus_project_sync_kanban",
      "pharo_nexus_project_list",
      "pharo_nexus_project_status",
    ]);
  });

  it("creates, lists, and reads a project through MCP tool calls", async () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(makeTempDir("pharo-nexus-projects-"), "McpProject");
    initPharoNexusHome({ homePath });

    const createResult = await callPharoNexusMcpTool(
      "pharo_nexus_project_create",
      {
        homePath,
        name: "McpProject",
        root: projectRoot,
        gitInit: true,
        syncVibeKanban: false,
      },
      { gitRunner: fakeGitRunner },
    );
    const createPayload = parseToolText(createResult);

    expect(createResult.isError).toBeUndefined();
    expect(createPayload).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "mcp-project",
        name: "McpProject",
      },
    });

    const listPayload = parseToolText(
      await callPharoNexusMcpTool("pharo_nexus_project_list", { homePath }),
    );
    expect(listPayload).toMatchObject({
      ok: true,
      projects: [
        {
          id: "mcp-project",
          name: "McpProject",
          projectRoot,
        },
      ],
    });

    const linkPayload = parseToolText(
      await callPharoNexusMcpTool("pharo_nexus_project_link_kanban", {
        homePath,
        project: "mcp-project",
        vibeKanbanProjectId: "vk-mcp",
      }),
    );
    expect(linkPayload).toMatchObject({
      ok: true,
      vibeKanbanProjectId: "vk-mcp",
      project: {
        id: "mcp-project",
        vibeKanbanProjectId: "vk-mcp",
      },
    });

    const statusPayload = parseToolText(
      await callPharoNexusMcpTool("pharo_nexus_project_status", {
        homePath,
        project: "mcp-project",
      }),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      project: {
        id: "mcp-project",
        projectRoot,
        vibeKanbanProjectId: "vk-mcp",
      },
    });
  });

  it("imports an existing repository through an MCP tool call", async () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const sourceRoot = path.join(makeTempDir("pharo-nexus-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    initPharoNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "Imported");

    const result = await callPharoNexusMcpTool(
      "pharo_nexus_project_import",
      {
        homePath,
        root: sourceRoot,
        name: "Imported",
        syncVibeKanban: false,
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
    expect(fs.existsSync(path.join(sourceRoot, "pharo-nexus.project.json"))).toBe(false);
  });

  it("supports the first usable control-project scenario through remoteUrl", async () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const gitCalls: string[][] = [];
    initPharoNexusHome({ homePath });
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

    const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
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
    };

    const result = await callPharoNexusMcpTool(
      "pharo_nexus_project_create",
      {
        homePath,
        name: "MyLibrary",
        remoteUrl: "https://github.com/me/MyLibrary.git",
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
        kanban: {
          projectId: "board-my-library",
        },
      },
      plexusProjectConfig: {
        name: "MyLibrary",
        kanban: {
          provider: "vibe-kanban",
          projectId: "board-my-library",
        },
        images: [],
      },
      vibeKanbanSync: {
        vibeKanbanProjectId: "board-my-library",
        vibeKanbanRepoId: "repo-my-library",
      },
    });
    expect(gitCalls[0]).toEqual(["init", projectRoot]);
    expect(gitCalls[1]).toEqual([
      "clone",
      "https://github.com/me/MyLibrary.git",
      path.join(projectRoot, "git"),
    ]);
    expect(fs.existsSync(path.join(projectRoot, "pharo-nexus.project.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "git", "pharo-nexus.project.json"))).toBe(false);
    expect(loadProjectConfig(projectRoot)).toMatchObject({
      id: "my-library",
      name: "MyLibrary",
      kanban: {
        projectId: "board-my-library",
      },
    });
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "my-library",
        name: "MyLibrary",
        plexusProjectRoot: projectRoot,
        vibeKanbanProjectId: "board-my-library",
        vibeKanbanRepoId: "repo-my-library",
      },
    ]);
  });

  it("returns tool errors as MCP error results", async () => {
    const result = await callPharoNexusMcpTool("pharo_nexus_project_status", {});

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toMatchObject({
      ok: false,
      error: "arguments.project is required",
    });
  });
});
