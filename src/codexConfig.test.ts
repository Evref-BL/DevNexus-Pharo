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
import { devNexusPharoProjectExtensionConfigKey } from "./devNexusPharoExtension.js";
import { devNexusPharoDevNexusPluginConfig } from "./devNexusPharoPlugin.js";
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
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath);

    expect(
      buildCodexMcpServers(homePath, config, expected.platform).vibe_kanban,
    ).toMatchObject({
      command: expected.command,
      args: expected.args,
      defaultToolsApprovalMode: "approve",
    });
  });

  it("auto-approves DevNexus-Pharo-managed MCP tools by default", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath);

    expect(buildCodexMcpServers(homePath, config)).toMatchObject({
      dev_nexus_pharo: {
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
        "[mcp_servers.dev_nexus_pharo]",
        'command = "old-dev-nexus-pharo"',
        "",
        "[mcp_servers.dev_nexus_pharo.env]",
        'DEV_NEXUS_PHARO_HOME = "old"',
      ].join("\n"),
      {
        dev_nexus_pharo: {
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
    expect(merged).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(merged).toContain('type = "http"');
    expect(merged).toContain('url = "http://127.0.0.1:7330/mcp"');
    expect(merged).not.toContain("old-dev-nexus-pharo");
    expect(merged).not.toContain("DEV_NEXUS_PHARO_HOME");
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

  it("writes DevNexus-Pharo, PLexus, and Vibe Kanban MCP entries to a workspace", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");
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
    expect(content).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(content).toContain('type = "http"');
    expect(content).toContain('url = "http://127.0.0.1:7330/mcp"');
    expect(content).toContain("[mcp_servers.plexus]");
    expect(content).toContain('url = "http://127.0.0.1:7331/mcp"');
    expect(content).toContain("[mcp_servers.vibe_kanban]");
    expect(content.match(/default_tools_approval_mode = "approve"/gu)).toHaveLength(3);
    expect(content).toContain('"--mcp"');
  });

  it("writes a scoped Pharo MCP facade for DevNexus-Pharo project workspaces", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-project-");
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
        [devNexusPharoProjectExtensionConfigKey]: {},
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

  it("writes shared DevNexus project MCP entries for DevNexus-Pharo plugin roots", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-dogfood",
      name: "Shared Dogfood",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "git@github.com:example/shared-dogfood.git",
        defaultBranch: "main",
      },
      components: [
        {
          id: "dev-nexus",
          name: "DevNexus",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:example/dev-nexus.git",
          defaultBranch: "main",
          sourceRoot: "sourcesRoot:dev-nexus",
          relationships: [],
        },
      ],
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        defaultToolsApprovalMode: "approve",
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    const configPath = codexConfigPath(projectRoot);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        "[mcp_servers.plexus]",
        'url = "http://127.0.0.1:7331/mcp"',
        "",
        "[mcp_servers.vibe_kanban]",
        'command = "npx"',
      ].join("\n"),
      "utf8",
    );

    const result = initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
      platform: "darwin",
    });

    expect(Object.keys(result.servers)).toEqual([
      "dev_nexus",
      "dev_nexus_pharo",
      "plexus_project",
      "pharo_launcher",
      "pharo",
    ]);
    expect(result.content).toContain("[mcp_servers.dev_nexus]");
    expect(result.content).toContain('command = "dev-nexus"');
    expect(result.content).toContain('args = ["mcp-stdio"]');
    expect(result.content).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(result.content).toContain('command = "dev-nexus-pharo"');
    expect(result.content).toContain("[mcp_servers.plexus_project]");
    expect(result.servers.plexus_project?.command).toBe("plexus");
    expect(result.content).toContain('args = ["mcp", "project"]');
    expect(result.content).toContain("[mcp_servers.pharo_launcher]");
    expect(result.servers.pharo_launcher?.command).toBe("plexus");
    expect(result.content).toContain('args = ["mcp", "pharo-launcher", "--project-path"');
    expect(result.content).toContain("[mcp_servers.pharo]");
    expect(result.content).toContain('url = "http://127.0.0.1:7331/mcp"');
    expect(result.content).not.toContain('command = "plexus-gateway"');
    expect(result.content).not.toContain("[mcp_servers.plexus]");
    expect(result.content).not.toContain("[mcp_servers.vibe_kanban]");
    expect(result.plexusProjectConfigPath).toBe(
      path.join(projectRoot, "plexus.project.json"),
    );
    expect(result.plexusProjectConfigCreated).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(projectRoot, "plexus.project.json"), "utf8")),
    ).toMatchObject({
      name: "Shared Dogfood",
      kanban: {
        provider: "vibe-kanban",
        projectId: "shared-dogfood",
      },
      images: [],
    });

    const doctor = await doctorCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    expect(doctor.ok).toBe(true);
    expect(doctor.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "config:dev_nexus", status: "ok" }),
        expect.objectContaining({ name: "plexus_project:config", status: "ok" }),
        expect.objectContaining({ name: "dev_nexus:command", status: "skipped" }),
        expect.objectContaining({ name: "pharo:http", status: "skipped" }),
      ]),
    );
  });

  it("reports missing shared PLexus project config as a doctor failure", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-root",
      name: "Shared Root",
      home: null,
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    fs.rmSync(path.join(projectRoot, "plexus.project.json"), { force: true });

    const doctor = await doctorCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });

    expect(doctor.ok).toBe(false);
    expect(doctor.checks).toContainEqual(
      expect.objectContaining({
        name: "plexus_project:config",
        status: "failed",
      }),
    );
  });

  it("prefers project-local runtime binaries for shared DevNexus plugin roots", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-root",
      name: "Shared Root",
      home: null,
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    const binDirectory = path.join(
      projectRoot,
      ".dev-nexus",
      "runtime",
      "npm-tools",
      "node_modules",
      ".bin",
    );
    fs.mkdirSync(binDirectory, { recursive: true });
    const devNexusPharoBin = path.join(binDirectory, "dev-nexus-pharo.cmd");
    const plexusBin = path.join(binDirectory, "plexus.cmd");
    fs.writeFileSync(devNexusPharoBin, "", "utf8");
    fs.writeFileSync(plexusBin, "", "utf8");

    const result = initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
      platform: "win32",
    });

    expect(result.servers.dev_nexus?.command).toBe("dev-nexus.cmd");
    expect(result.servers.dev_nexus_pharo?.command).toBe(devNexusPharoBin);
    expect(result.servers.plexus_project?.command).toBe(plexusBin);
    expect(result.servers.pharo_launcher?.command).toBe(plexusBin);
  });

  it("uses the host platform when selecting project-local runtime binary shims", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-root",
      name: "Shared Root",
      home: null,
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    const binDirectory = path.join(
      projectRoot,
      ".dev-nexus",
      "runtime",
      "npm-tools",
      "node_modules",
      ".bin",
    );
    fs.mkdirSync(binDirectory, { recursive: true });
    fs.writeFileSync(path.join(binDirectory, "dev-nexus-pharo"), "", "utf8");
    fs.writeFileSync(path.join(binDirectory, "dev-nexus-pharo.cmd"), "", "utf8");
    fs.writeFileSync(path.join(binDirectory, "plexus"), "", "utf8");
    fs.writeFileSync(path.join(binDirectory, "plexus.cmd"), "", "utf8");

    const result = initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    const shimSuffix = process.platform === "win32" ? ".cmd" : "";

    expect(result.servers.dev_nexus_pharo?.command).toBe(
      path.join(binDirectory, `dev-nexus-pharo${shimSuffix}`),
    );
    expect(result.servers.plexus_project?.command).toBe(
      path.join(binDirectory, `plexus${shimSuffix}`),
    );
  });

  it("reports missing Codex config as an actionable doctor failure", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");

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
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath, {
      devNexusPharoMcpPort: pharo.port,
      plexusMcpPort: plexus.port,
    });
    initNexusHome({ homePath });
    saveHomeConfig(homePath, config);
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");
    initCodexWorkspace({ homePath, workspacePath, config: loadHomeConfig(homePath) });

    const result = await doctorCodexWorkspace({ homePath, workspacePath });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "dev_nexus_pharo:health", status: "ok" }),
        expect.objectContaining({ name: "dev_nexus_pharo:initialize", status: "ok" }),
        expect.objectContaining({ name: "dev_nexus_pharo:tools", status: "ok" }),
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
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath, {
      devNexusPharoMcpPort: pharo.port,
      plexusMcpPort: plexus.port,
    });
    initNexusHome({ homePath });
    saveHomeConfig(homePath, config);
    const workspacePath = makeTempDir("dev-nexus-pharo-project-");
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
        [devNexusPharoProjectExtensionConfigKey]: {},
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
