import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultHomeConfig,
  initNexusHome,
  loadHomeConfig,
  saveProjectConfig,
  saveHomeConfig,
} from "./config.js";
import { pharoNexusProjectExtensionConfigKey } from "./pharoNexusExtension.js";
import {
  buildCodexMcpServers,
  codexConfigPath,
  doctorCodexWorkspace,
  initCodexWorkspace,
  mergeCodexMcpServersIntoToml,
} from "./codexConfig.js";

const tempDirs: string[] = [];
const servers: http.Server[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readRequestBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Buffer));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startFakeMcpServer(toolNames: string[]): Promise<{ port: number }> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method !== "POST" || url.pathname !== "/mcp") {
        response.statusCode = 404;
        response.end();
        return;
      }

      const body = await readRequestBody(request) as { id?: unknown; method?: string };
      if (body.method === "initialize") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            capabilities: { tools: {} },
          },
        }));
        return;
      }

      if (body.method === "tools/list") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: toolNames.map((name) => ({ name })),
          },
        }));
        return;
      }

      response.statusCode = 400;
      response.end();
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return { port: address.port };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await closeServer(server);
  }
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Codex config", () => {
  it.each([
    {
      platform: "win32" as NodeJS.Platform,
      command: "cmd",
      args: ["/c", "npx", "-y", "vibe-kanban@0.1.43", "--mcp"],
    },
    {
      platform: "darwin" as NodeJS.Platform,
      command: "npx",
      args: ["-y", "vibe-kanban@0.1.43", "--mcp"],
    },
    {
      platform: "linux" as NodeJS.Platform,
      command: "npx",
      args: ["-y", "vibe-kanban@0.1.43", "--mcp"],
    },
  ])("builds Codex MCP commands for $platform-shaped environments", (expected) => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const config = createDefaultHomeConfig(homePath);

    expect(
      buildCodexMcpServers(homePath, config, expected.platform).vibe_kanban,
    ).toMatchObject({
      command: expected.command,
      args: expected.args,
      defaultToolsApprovalMode: "approve",
    });
  });

  it("auto-approves PharoNexus-managed MCP tools by default", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const config = createDefaultHomeConfig(homePath);

    expect(buildCodexMcpServers(homePath, config)).toMatchObject({
      pharo_nexus: {
        defaultToolsApprovalMode: "approve",
      },
      plexus: {
        defaultToolsApprovalMode: "approve",
      },
      vibe_kanban: {
        defaultToolsApprovalMode: "approve",
      },
    });
  });

  it("merges managed MCP servers without dropping unrelated TOML", () => {
    const merged = mergeCodexMcpServersIntoToml(
      [
        'model = "gpt-5.3-codex"',
        "",
        "[mcp_servers.keep]",
        'command = "node"',
        'args = ["keep.js"]',
        "",
        "[mcp_servers.pharo_nexus]",
        'command = "old-pharo-nexus"',
        "",
        "[mcp_servers.pharo_nexus.env]",
        'PHARO_NEXUS_HOME = "old"',
      ].join("\n"),
      {
        pharo_nexus: {
          type: "http",
          enabled: true,
          required: true,
          url: "http://127.0.0.1:7330/mcp",
        },
      },
    );

    expect(merged).toContain('model = "gpt-5.3-codex"');
    expect(merged).toContain("[mcp_servers.keep]");
    expect(merged).toContain('args = ["keep.js"]');
    expect(merged).toContain("[mcp_servers.pharo_nexus]");
    expect(merged).toContain('type = "http"');
    expect(merged).toContain('url = "http://127.0.0.1:7330/mcp"');
    expect(merged).not.toContain("old-pharo-nexus");
    expect(merged).not.toContain("PHARO_NEXUS_HOME");
  });

  it("preserves user-managed Vibe MCP entries while replacing the managed one", () => {
    const merged = mergeCodexMcpServersIntoToml(
      [
        "[mcp_servers.vibe_custom]",
        'command = "node"',
        'args = ["custom-vibe.js", "--mcp"]',
        "",
        "[mcp_servers.vibe_kanban]",
        'command = "old-vibe"',
      ].join("\n"),
      {
        vibe_kanban: {
          enabled: true,
          command: "npx",
          args: ["-y", "vibe-kanban@0.1.43", "--mcp"],
        },
      },
    );

    expect(merged).toContain("[mcp_servers.vibe_custom]");
    expect(merged).toContain('args = ["custom-vibe.js", "--mcp"]');
    expect(merged).toContain("[mcp_servers.vibe_kanban]");
    expect(merged).toContain('command = "npx"');
    expect(merged).not.toContain('command = "old-vibe"');
  });

  it("writes PharoNexus, PLexus, and Vibe Kanban MCP entries to a workspace", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initNexusHome({ homePath });
    const workspacePath = makeTempDir("pharo-nexus-workspace-");
    const configPath = codexConfigPath(workspacePath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      ['model = "gpt-5.3-codex"', "", "[mcp_servers.keep]", 'command = "node"'].join("\n"),
      "utf8",
    );

    const result = initCodexWorkspace({ homePath, workspacePath });
    const content = fs.readFileSync(configPath, "utf8");

    expect(result.updated).toBe(true);
    expect(content).toContain('model = "gpt-5.3-codex"');
    expect(content).toContain("[mcp_servers.keep]");
    expect(content).toContain("[mcp_servers.pharo_nexus]");
    expect(content).toContain('type = "http"');
    expect(content).toContain('url = "http://127.0.0.1:7330/mcp"');
    expect(content).toContain("[mcp_servers.plexus]");
    expect(content).toContain('url = "http://127.0.0.1:7331/mcp"');
    expect(content).toContain("[mcp_servers.vibe_kanban]");
    expect(content.match(/default_tools_approval_mode = "approve"/gu)).toHaveLength(3);
    expect(content).toContain('"--mcp"');
  });

  it("writes a scoped Pharo MCP facade for PharoNexus project workspaces", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("pharo-nexus-project-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "pharo-project",
      name: "Pharo Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-pharo-project",
      },
      extensions: {
        [pharoNexusProjectExtensionConfigKey]: {},
      },
    });

    const result = initCodexWorkspace({ homePath, workspacePath: projectRoot });
    const pharoServer = result.servers.pharo;

    expect(pharoServer).toMatchObject({
      enabled: true,
      command: "plexus-gateway",
      args: ["--stdio"],
      env: {
        PLEXUS_GATEWAY_SURFACE: "pharo",
        PLEXUS_PROJECT_ROOT: path.resolve(projectRoot),
        PLEXUS_PROJECT_ID: "pharo-project",
        PLEXUS_WORKSPACE_ID: path.basename(projectRoot),
        PLEXUS_WORKSPACE_ROOT: path.resolve(projectRoot),
        PLEXUS_TARGET_ID: `pharo-project--${path.basename(projectRoot)}`,
        PLEXUS_STATE_ROOT: path.join(homePath, "state", "plexus"),
      },
      defaultToolsApprovalMode: "approve",
    });
    expect(JSON.parse(pharoServer?.env?.PLEXUS_PHARO_TOOLS_JSON ?? "[]")).toEqual([
      expect.objectContaining({ name: "pharo_eval" }),
    ]);
    expect(result.content).toContain("[mcp_servers.pharo]");
    expect(result.content).toContain("[mcp_servers.pharo.env]");
  });

  it("reports missing Codex config as an actionable doctor failure", async () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    initNexusHome({ homePath });
    const workspacePath = makeTempDir("pharo-nexus-workspace-");

    await expect(doctorCodexWorkspace({ homePath, workspacePath })).resolves.toMatchObject({
      ok: false,
      checks: [
        {
          name: "config",
          status: "failed",
        },
      ],
    });
  });

  it("checks configured HTTP MCP endpoints and expected tool names", async () => {
    const pharo = await startFakeMcpServer([
      "project_create",
      "project_import",
      "project_status",
    ]);
    const plexus = await startFakeMcpServer([
      "plexus_project_open",
      "plexus_project_status",
    ]);
    const homePath = makeTempDir("pharo-nexus-home-");
    const config = createDefaultHomeConfig(homePath, {
      pharoNexusMcpPort: pharo.port,
      plexusMcpPort: plexus.port,
    });
    initNexusHome({ homePath });
    saveHomeConfig(homePath, config);
    const workspacePath = makeTempDir("pharo-nexus-workspace-");
    initCodexWorkspace({ homePath, workspacePath, config: loadHomeConfig(homePath) });

    const result = await doctorCodexWorkspace({ homePath, workspacePath });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "pharo_nexus:health", status: "ok" }),
        expect.objectContaining({ name: "pharo_nexus:initialize", status: "ok" }),
        expect.objectContaining({ name: "pharo_nexus:tools", status: "ok" }),
        expect.objectContaining({ name: "plexus:health", status: "ok" }),
        expect.objectContaining({ name: "plexus:initialize", status: "ok" }),
        expect.objectContaining({ name: "plexus:tools", status: "ok" }),
        expect.objectContaining({ name: "vibe_kanban:command", status: "skipped" }),
      ]),
    );
  });

  it("checks Pharo MCP facade config without launching the command", async () => {
    const pharo = await startFakeMcpServer([
      "project_create",
      "project_import",
      "project_status",
    ]);
    const plexus = await startFakeMcpServer([
      "plexus_project_open",
      "plexus_project_status",
    ]);
    const homePath = makeTempDir("pharo-nexus-home-");
    const config = createDefaultHomeConfig(homePath, {
      pharoNexusMcpPort: pharo.port,
      plexusMcpPort: plexus.port,
    });
    initNexusHome({ homePath });
    saveHomeConfig(homePath, config);
    const workspacePath = makeTempDir("pharo-nexus-project-");
    saveProjectConfig(workspacePath, {
      version: 1,
      id: "doctor-pharo",
      name: "Doctor Pharo",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-doctor-pharo",
      },
      extensions: {
        [pharoNexusProjectExtensionConfigKey]: {},
      },
    });
    initCodexWorkspace({ homePath, workspacePath, config: loadHomeConfig(homePath) });

    const result = await doctorCodexWorkspace({ homePath, workspacePath });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "config:pharo", status: "ok" }),
        expect.objectContaining({ name: "pharo:command", status: "skipped" }),
      ]),
    );
  });
});
