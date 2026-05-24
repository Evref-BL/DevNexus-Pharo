import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  controlProjectRootPath,
  initNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  saveHomeConfig,
} from "../../src/config.js";
import {
  getDevNexusPharoStatus,
  startDevNexusPharo,
  stopDevNexusPharo,
} from "../../src/devNexusPharoRuntime.js";
import { stopDevNexusPharoMcp } from "../../src/devNexusPharoMcpService.js";
import { stopPlexusGateway } from "../../src/plexusGatewayService.js";
import { waitForHttpPort } from "dev-nexus";

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
  devNexusPharoMcpPort: number;
  plexusMcpPort: number;
}> {
  const ports = new Set<number>();
  while (ports.size < 2) {
    ports.add(await freePort());
  }

  const [devNexusPharoMcpPort, plexusMcpPort] = [...ports];
  return { devNexusPharoMcpPort, plexusMcpPort };
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

function fakeDevNexusPharoMcpServerScript(): string {
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
  devNexusPharoMcpPort: number,
  plexusMcpPort: number,
): string {
  const homePath = makeTempDir("dev-nexus-pharo-home-");
  initNexusHome({
    homePath,
    devNexusPharoMcpPort,
    plexusMcpPort,
  });
  const config = loadHomeConfig(homePath);
  config.tools.nexus = {
    command: process.execPath,
    args: ["-e", fakeDevNexusPharoMcpServerScript()],
  };
  config.tools.plexus = {
    command: process.execPath,
    args: ["-e", fakePlexusGatewayServerScript()],
  };
  saveHomeConfig(homePath, config);
  homePaths.push(homePath);
  return homePath;
}

afterEach(async () => {
  for (const homePath of homePaths.splice(0)) {
    await stopPlexusGateway({
      homePath,
      force: true,
      timeoutMs: 2_000,
      pollIntervalMs: 50,
    });
    await stopDevNexusPharoMcp({
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

describe("DevNexus-Pharo runtime", () => {
  it("starts the control project, PLexus gateway, and DevNexus-Pharo MCP", async () => {
    const { devNexusPharoMcpPort, plexusMcpPort } = await freeServicePorts();
    const homePath = initHomeWithTopLevelTools(
      devNexusPharoMcpPort,
      plexusMcpPort,
    );

    const result = await startDevNexusPharo({
      homePath,
      mcpHealthTimeoutMs: 2_000,
    });

    expect(result.services.plexusGateway.pid).toBeGreaterThan(0);
    expect(result.services.devNexusPharoMcp.pid).toBeGreaterThan(0);
    expect(result.health.devNexusPharoMcp).toMatchObject({
      ok: true,
      statusCode: 200,
    });
    expect(result.controlProject).toMatchObject({
      projectPath: controlProjectRootPath(homePath),
    });
    expect(loadProjectConfig(controlProjectRootPath(homePath))).toEqual(
      result.controlProject.config,
    );
  });

  it("reports status and stops services in runtime order", async () => {
    const { devNexusPharoMcpPort, plexusMcpPort } = await freeServicePorts();
    const homePath = initHomeWithTopLevelTools(
      devNexusPharoMcpPort,
      plexusMcpPort,
    );

    await startDevNexusPharo({
      homePath,
      mcpHealthTimeoutMs: 2_000,
    });
    await waitForHttpPort({
      port: plexusMcpPort,
      totalTimeoutMs: 2_000,
    });

    const runningStatus = await getDevNexusPharoStatus({
      homePath,
      checkHealth: true,
      healthTimeoutMs: 1_000,
    });

    expect(runningStatus).toMatchObject({
      running: true,
      stale: false,
      services: {
        devNexusPharoMcp: {
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
      },
    });

    const progressMessages: string[] = [];
    const stopped = await stopDevNexusPharo({
      homePath,
      force: true,
      timeoutMs: 2_000,
      pollIntervalMs: 50,
      progress: (message) => progressMessages.push(message),
    });

    expect(stopped.services.devNexusPharoMcp.stop).toMatchObject({
      stopped: true,
    });
    expect(stopped.services.plexusGateway.stop).toMatchObject({
      stopped: true,
    });
    expect(progressMessages).toEqual([
      `Using DevNexus-Pharo home: ${homePath}`,
      "Stopping DevNexus-Pharo MCP...",
      "DevNexus-Pharo MCP stopped.",
      "Stopping PLexus gateway...",
      "PLexus gateway stopped.",
      "DevNexus-Pharo stop complete.",
    ]);

    const stoppedStatus = await getDevNexusPharoStatus({ homePath });
    expect(stoppedStatus).toMatchObject({
      running: false,
      stale: false,
      services: {
        devNexusPharoMcp: {
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
      },
    });
  });
});
