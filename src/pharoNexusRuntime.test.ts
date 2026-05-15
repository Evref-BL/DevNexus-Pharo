import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createControlProjectConfig,
  controlProjectRootPath,
  initNexusHome,
  legacyControlProjectRootPath,
  loadHomeConfig,
  loadProjectConfig,
  saveHomeConfig,
  saveProjectConfig,
} from "./config.js";
import {
  getPharoNexusStatus,
  startPharoNexus,
  stopPharoNexus,
  vibeKanbanToolOpensBrowserOnStart,
} from "./pharoNexusRuntime.js";
import { stopPharoNexusMcp } from "./pharoNexusMcpService.js";
import { stopPlexusGateway } from "./plexusGatewayService.js";
import { waitForHttpPort } from "./processSupervisor.js";
import { stopVibeKanban } from "./vibeKanbanService.js";

const tempDirs: string[] = [];
const homePaths: string[] = [];

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

async function freeServicePorts(): Promise<{
  vibeKanbanPort: number;
  pharoNexusMcpPort: number;
  plexusMcpPort: number;
}> {
  const ports = new Set<number>();
  while (ports.size < 3) {
    ports.add(await freePort());
  }

  const [vibeKanbanPort, pharoNexusMcpPort, plexusMcpPort] = [...ports];
  return { vibeKanbanPort, pharoNexusMcpPort, plexusMcpPort };
}

function fakeVibeKanbanServerScript(postFilePath: string): string {
  return [
    "const fs = require('fs');",
    "const http = require('http');",
    `const postFilePath = ${JSON.stringify(postFilePath)};`,
    "let signedIn = false;",
    "http.createServer((request, response) => {",
    "const url = new URL(request.url, 'http://127.0.0.1');",
    "if (request.method === 'GET' && url.pathname === '/remote/v1/health') {",
    "response.statusCode = 204;",
    "response.end();",
    "return;",
    "}",
    "if (request.method === 'GET' && url.pathname === '/api/info') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: { shared_api_base: `http://127.0.0.1:${process.env.PORT}/remote` } }));",
    "return;",
    "}",
    "if (request.method === 'GET' && url.pathname === '/api/auth/status') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: { logged_in: signedIn } }));",
    "return;",
    "}",
    "if (request.method === 'POST' && url.pathname === '/api/auth/local/login') {",
    "let body = '';",
    "request.on('data', (chunk) => { body += chunk; });",
    "request.on('end', () => {",
    "const payload = JSON.parse(body);",
    "signedIn = payload.email === 'admin@example.test' && payload.password === 'secret-password';",
    "if (!signedIn) { response.statusCode = 401; response.end(JSON.stringify({ success: false, message: 'Unauthorized' })); return; }",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: { user_id: 'user-1', email: payload.email, providers: [] } }));",
    "});",
    "return;",
    "}",
    "if (request.method === 'GET' && url.pathname === '/api/auth/token') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: { access_token: 'token-1' } }));",
    "return;",
    "}",
    "if (request.method === 'GET' && url.pathname === '/remote/v1/organizations') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ organizations: [{ id: 'org-1', name: 'Personal', is_personal: true }] }));",
    "return;",
    "}",
    "if (request.method === 'GET' && url.pathname === '/remote/v1/fallback/projects') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ projects: [{ id: 'control-board', organization_id: 'org-1', name: 'PharoNexus' }] }));",
    "return;",
    "}",
    "if (request.method === 'POST' && url.pathname === '/remote/v1/projects') {",
    "let body = '';",
    "request.on('data', (chunk) => { body += chunk; });",
    "request.on('end', () => {",
    "const payload = JSON.parse(body);",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ txid: `tx-${payload.id}` }));",
    "});",
    "return;",
    "}",
    "if (request.method === 'GET' && url.pathname === '/api/mcp-config') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: { mcp_config: { servers: { existing: { command: 'node', args: ['existing.js'] } } } } }));",
    "return;",
    "}",
    "if (request.method === 'POST' && url.pathname === '/api/mcp-config') {",
    "let body = '';",
    "request.on('data', (chunk) => { body += chunk; });",
    "request.on('end', () => {",
    "fs.writeFileSync(postFilePath, body);",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: 'Updated MCP server configuration' }));",
    "});",
    "return;",
    "}",
    "if (request.method === 'GET' && url.pathname === '/api/repos') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: [] }));",
    "return;",
    "}",
    "if (request.method === 'POST' && url.pathname === '/api/repos') {",
    "let body = '';",
    "request.on('data', (chunk) => { body += chunk; });",
    "request.on('end', () => {",
    "const payload = JSON.parse(body);",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: { id: 'control-repo', path: payload.path, display_name: payload.display_name } }));",
    "});",
    "return;",
    "}",
    "if (request.method === 'PUT' && url.pathname.startsWith('/api/repos/')) {",
    "let body = '';",
    "request.on('data', (chunk) => { body += chunk; });",
    "request.on('end', () => {",
    "const payload = JSON.parse(body);",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ success: true, data: { id: url.pathname.split('/').pop(), path: 'repo-path', display_name: 'repo', setup_script: payload.setup_script } }));",
    "});",
    "return;",
    "}",
    "response.statusCode = 204;",
    "response.end();",
    "}).listen(Number(process.env.PORT), '127.0.0.1');",
  ].join("");
}

function fakePlexusGatewayServerScript(): string {
  return [
    "const http = require('http');",
    "http.createServer((_request, response) => {",
    "response.statusCode = 204;",
    "response.end();",
    "}).listen(Number(process.env.PORT), '127.0.0.1');",
  ].join("");
}

function fakePharoNexusMcpServerScript(): string {
  return [
    "const http = require('http');",
    "http.createServer((request, response) => {",
    "if (request.url === '/health') {",
    "response.setHeader('content-type', 'application/json');",
    "response.end(JSON.stringify({ ok: true }));",
    "return;",
    "}",
    "response.statusCode = 404;",
    "response.end();",
    "}).listen(Number(process.env.PORT), '127.0.0.1');",
  ].join("");
}

function initHomeWithTopLevelTools(
  vibePort: number,
  pharoNexusMcpPort: number,
  plexusMcpPort: number,
  postFilePath: string,
  plexusArgs = ["-e", "setInterval(() => {}, 1000);"],
): string {
  const homePath = makeTempDir("pharo-nexus-home-");
  initNexusHome({
    homePath,
    vibeKanbanPort: vibePort,
    pharoNexusMcpPort,
    plexusMcpPort,
  });
  const config = loadHomeConfig(homePath);
  config.tools.pharoNexus = {
    command: process.execPath,
    args: ["-e", fakePharoNexusMcpServerScript()],
  };
  config.tools.plexus = {
    command: process.execPath,
    args: plexusArgs,
  };
  config.tools.vibeKanban = {
    command: process.execPath,
    args: ["-e", fakeVibeKanbanServerScript(postFilePath)],
  };
  config.integrations.vibeKanban.backend = {
    mode: "external",
    sharedApiBase: `http://127.0.0.1:${vibePort}/remote`,
    healthPath: "/v1/health",
    startOnPharoNexusStart: false,
    stopOnPharoNexusStop: false,
  };
  saveHomeConfig(homePath, config);
  homePaths.push(homePath);
  return homePath;
}

function enableManagedBackendLocalAuth(
  homePath: string,
  vibePort: number,
): void {
  const remoteRoot = path.join(homePath, "vibe-kanban", "crates", "remote");
  fs.mkdirSync(remoteRoot, { recursive: true });
  const envFile = path.join(remoteRoot, ".env.remote");
  fs.writeFileSync(
    envFile,
    [
      "SELF_HOST_LOCAL_AUTH_EMAIL=admin@example.test",
      "SELF_HOST_LOCAL_AUTH_PASSWORD=secret-password",
    ].join("\n"),
    "utf8",
  );

  const config = loadHomeConfig(homePath);
  config.integrations.vibeKanban.backend = {
    mode: "docker",
    sharedApiBase: `http://127.0.0.1:${vibePort}/remote`,
    healthPath: "/v1/health",
    sourceRepositoryUrl: "https://github.com/BloopAI/vibe-kanban.git",
    autoBootstrap: true,
    composeCommand: "auto",
    composeArgs: [],
    composeFile: path.join(remoteRoot, "docker-compose.yml"),
    envFile,
    projectName: "pharo-nexus-vibe",
    workingDirectory: remoteRoot,
    startOnPharoNexusStart: false,
    stopOnPharoNexusStop: false,
  };
  saveHomeConfig(homePath, config);
}

afterEach(async () => {
  for (const homePath of homePaths.splice(0)) {
    await stopVibeKanban({
      homePath,
      force: true,
      timeoutMs: 2_000,
      pollIntervalMs: 50,
    });
    await stopPlexusGateway({
      homePath,
      force: true,
      timeoutMs: 2_000,
      pollIntervalMs: 50,
    });
    await stopPharoNexusMcp({
      homePath,
      force: true,
      timeoutMs: 2_000,
      pollIntervalMs: 50,
    });
  }

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("PharoNexus runtime", () => {
  it("detects stock Vibe Kanban commands that open the browser themselves", () => {
    expect(
      vibeKanbanToolOpensBrowserOnStart({
        command: "npx",
        args: ["vibe-kanban"],
      }),
    ).toBe(true);
    expect(
      vibeKanbanToolOpensBrowserOnStart({
        command: "npx.CMD",
        args: ["-y", "vibe-kanban@latest"],
      }),
    ).toBe(true);
    expect(
      vibeKanbanToolOpensBrowserOnStart({
        command: "C:\\Users\\me\\.vibe-kanban\\bin\\vibe-kanban.exe",
        args: [],
      }),
    ).toBe(true);
    expect(
      vibeKanbanToolOpensBrowserOnStart({
        command: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000);"],
      }),
    ).toBe(false);
  });

  it("starts services, links the control project, and installs PharoNexus plus PLexus MCP config", async () => {
    const postFilePath = path.join(makeTempDir("pharo-nexus-post-"), "post.json");
    const { vibeKanbanPort, pharoNexusMcpPort, plexusMcpPort } =
      await freeServicePorts();

    const homePath = initHomeWithTopLevelTools(
      vibeKanbanPort,
      pharoNexusMcpPort,
      plexusMcpPort,
      postFilePath,
    );

    const result = await startPharoNexus({
      homePath,
      executor: "codex",
      serverName: "plexus_local",
      openBrowser: false,
      vibeHealthTimeoutMs: 2_000,
    });

    expect(result.services.plexusGateway.pid).toBeGreaterThan(0);
    expect(result.services.pharoNexusMcp.pid).toBeGreaterThan(0);
    expect(result.services.vibeKanban.pid).toBeGreaterThan(0);
    expect(result.health.pharoNexusMcp).toMatchObject({
      ok: true,
      statusCode: 200,
    });
    expect(result.health.vibeKanban).toMatchObject({
      ok: true,
      statusCode: 204,
    });
    expect(result.controlProject).toMatchObject({
      projectPath: controlProjectRootPath(homePath),
      linked: true,
      vibeKanbanProjectId: "control-board",
      vibeKanbanRepoId: "control-repo",
    });
    expect(loadHomeConfig(homePath).controlProject).toMatchObject({
      vibeKanbanProjectId: "control-board",
      vibeKanbanRepoId: "control-repo",
    });
    expect(
      loadProjectConfig(controlProjectRootPath(homePath)).kanban.projectId,
    ).toBe("control-board");
    expect(result.mcpConfig).toMatchObject({
      executor: "CODEX",
      pharoNexus: {
        serverName: "pharo_nexus",
      },
      plexus: {
        serverName: "plexus_local",
      },
      updated: true,
    });

    const postedBody = JSON.parse(fs.readFileSync(postFilePath, "utf8"));
    expect(postedBody).toMatchObject({
      servers: {
        existing: {
          command: "node",
          args: ["existing.js"],
        },
        pharo_nexus: {
          type: "http",
          url: `http://127.0.0.1:${pharoNexusMcpPort}/mcp`,
        },
        plexus_local: {
          type: "http",
          url: `http://127.0.0.1:${plexusMcpPort}/mcp`,
        },
      },
    });
  });

  it("opens Vibe Kanban in the browser after it becomes healthy", async () => {
    const postFilePath = path.join(makeTempDir("pharo-nexus-post-"), "post.json");
    const { vibeKanbanPort, pharoNexusMcpPort, plexusMcpPort } =
      await freeServicePorts();

    const homePath = initHomeWithTopLevelTools(
      vibeKanbanPort,
      pharoNexusMcpPort,
      plexusMcpPort,
      postFilePath,
    );
    const browserOpener = vi.fn(async (url: string) => ({
      url,
      opened: true,
      command: "test-open",
      args: [url],
    }));

    const result = await startPharoNexus({
      homePath,
      skipMcpConfig: true,
      browserOpener,
      vibeHealthTimeoutMs: 2_000,
    });

    expect(browserOpener).toHaveBeenCalledWith(
      `http://127.0.0.1:${vibeKanbanPort}/projects/control-board`,
    );
    expect(result.browser).toMatchObject({
      url: `http://127.0.0.1:${vibeKanbanPort}/projects/control-board`,
      opened: true,
      command: "test-open",
      args: [`http://127.0.0.1:${vibeKanbanPort}/projects/control-board`],
    });
  });

  it("signs into managed self-hosted Vibe Kanban before linking the control project", async () => {
    const postFilePath = path.join(makeTempDir("pharo-nexus-post-"), "post.json");
    const { vibeKanbanPort, pharoNexusMcpPort, plexusMcpPort } =
      await freeServicePorts();

    const homePath = initHomeWithTopLevelTools(
      vibeKanbanPort,
      pharoNexusMcpPort,
      plexusMcpPort,
      postFilePath,
    );
    enableManagedBackendLocalAuth(homePath, vibeKanbanPort);
    const progressMessages: string[] = [];

    const result = await startPharoNexus({
      homePath,
      skipMcpConfig: true,
      openBrowser: false,
      vibeHealthTimeoutMs: 2_000,
      progress: (message) => progressMessages.push(message),
    });

    expect(result.auth?.vibeKanban).toMatchObject({
      status: "logged-in",
      attempted: true,
      loggedIn: true,
      email: "admin@example.test",
    });
    expect(result.controlProject).toMatchObject({
      linked: true,
      vibeKanbanProjectId: "control-board",
    });
    expect(progressMessages).toContain(
      "Signed into Vibe Kanban with self-hosted local auth as admin@example.test.",
    );
  });

  it("migrates the legacy control directory to PharoNexus and re-registers it", async () => {
    const postFilePath = path.join(makeTempDir("pharo-nexus-post-"), "post.json");
    const { vibeKanbanPort, pharoNexusMcpPort, plexusMcpPort } =
      await freeServicePorts();

    const homePath = initHomeWithTopLevelTools(
      vibeKanbanPort,
      pharoNexusMcpPort,
      plexusMcpPort,
      postFilePath,
    );
    const legacyRoot = legacyControlProjectRootPath(homePath);
    const targetRoot = controlProjectRootPath(homePath);
    const homeConfig = loadHomeConfig(homePath);
    fs.renameSync(targetRoot, legacyRoot);
    homeConfig.controlProject.root = legacyRoot;
    homeConfig.controlProject.vibeKanbanProjectId = "legacy-control-repo";
    saveHomeConfig(homePath, homeConfig);
    saveProjectConfig(legacyRoot, {
      ...createControlProjectConfig(homeConfig.controlProject),
      kanban: {
        provider: "vibe-kanban",
        projectId: "legacy-control-repo",
      },
    });

    const result = await startPharoNexus({
      homePath,
      skipMcpConfig: true,
      openBrowser: false,
      vibeHealthTimeoutMs: 2_000,
    });

    expect(fs.existsSync(targetRoot)).toBe(true);
    expect(fs.existsSync(legacyRoot)).toBe(false);
    expect(result.controlProject).toMatchObject({
      projectPath: targetRoot,
      linked: true,
      vibeKanbanProjectId: "control-board",
      vibeKanbanRepoId: "control-repo",
    });
    expect(loadHomeConfig(homePath).controlProject).toMatchObject({
      name: "PharoNexus",
      root: targetRoot,
      vibeKanbanProjectId: "control-board",
      vibeKanbanRepoId: "control-repo",
    });
    expect(loadProjectConfig(targetRoot)).toMatchObject({
      name: "PharoNexus",
      kanban: {
        projectId: "control-board",
      },
    });
  });

  it("reports top-level status and stops Vibe Kanban before PLexus gateway", async () => {
    const postFilePath = path.join(makeTempDir("pharo-nexus-post-"), "post.json");
    const { vibeKanbanPort, pharoNexusMcpPort, plexusMcpPort } =
      await freeServicePorts();

    const homePath = initHomeWithTopLevelTools(
      vibeKanbanPort,
      pharoNexusMcpPort,
      plexusMcpPort,
      postFilePath,
      ["-e", fakePlexusGatewayServerScript()],
    );

    await startPharoNexus({
      homePath,
      skipMcpConfig: true,
      openBrowser: false,
      vibeHealthTimeoutMs: 2_000,
    });
    await waitForHttpPort({
      port: plexusMcpPort,
      totalTimeoutMs: 2_000,
    });

    const runningStatus = await getPharoNexusStatus({
      homePath,
      checkHealth: true,
      healthTimeoutMs: 1_000,
    });

    expect(runningStatus).toMatchObject({
      running: true,
      stale: false,
      services: {
        pharoNexusMcp: {
          running: true,
          health: {
            ok: true,
            statusCode: 200,
          },
        },
        plexusGateway: {
          running: true,
          health: {
            ok: true,
            statusCode: 204,
          },
        },
        vibeKanban: {
          running: true,
          health: {
            ok: true,
            statusCode: 204,
          },
        },
      },
    });

    const progressMessages: string[] = [];
    const stopped = await stopPharoNexus({
      homePath,
      force: true,
      timeoutMs: 2_000,
      pollIntervalMs: 50,
      progress: (message) => progressMessages.push(message),
    });

    expect(stopped.services.vibeKanban.stop).toMatchObject({
      stopped: true,
    });
    expect(stopped.services.pharoNexusMcp.stop).toMatchObject({
      stopped: true,
    });
    expect(stopped.services.plexusGateway.stop).toMatchObject({
      stopped: true,
    });
    expect(progressMessages).toEqual([
      `Using PharoNexus home: ${homePath}`,
      "Stopping Vibe Kanban app...",
      "Vibe Kanban app stopped.",
      "Stopping PharoNexus MCP...",
      "PharoNexus MCP stopped.",
      "Stopping PLexus gateway...",
      "PLexus gateway stopped.",
      "Leaving Vibe Kanban backend running by configuration.",
      "PharoNexus stop complete.",
    ]);

    const stoppedStatus = await getPharoNexusStatus({ homePath });
    expect(stoppedStatus).toMatchObject({
      running: false,
      stale: false,
      services: {
        pharoNexusMcp: {
          running: false,
          state: {
            status: "stopped",
          },
        },
        plexusGateway: {
          running: false,
          state: {
            status: "stopped",
          },
        },
        vibeKanban: {
          running: false,
          state: {
            status: "stopped",
          },
        },
      },
    });
  });
});
