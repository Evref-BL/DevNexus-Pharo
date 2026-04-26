import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initPharoNexusHome,
  loadHomeConfig,
  saveHomeConfig,
  type PharoNexusHomeConfig,
} from "./config.js";
import {
  buildPlexusGatewayServiceArgs,
  getPlexusGatewayStatus,
  loadPlexusGatewayState,
  PlexusGatewayServiceError,
  plexusGatewayStatePath,
  resolvePlexusGatewayServiceCommand,
  startPlexusGateway,
  stopPlexusGateway,
} from "./plexusGatewayService.js";

const tempDirs: string[] = [];
const homePaths: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitFor<T>(
  action: () => Promise<T> | T,
  predicate: (value: T) => boolean,
  timeoutMs = 2_000,
): Promise<T> {
  const startedAt = Date.now();
  let lastValue: T;
  while (Date.now() - startedAt <= timeoutMs) {
    lastValue = await action();
    if (predicate(lastValue)) {
      return lastValue;
    }

    await sleep(25);
  }

  throw new Error("Timed out waiting for condition");
}

function fileIncludes(filePath: string, expected: string): boolean {
  return fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").includes(expected);
}

function initHomeWithGateway(
  args: string[],
  configure?: (config: PharoNexusHomeConfig) => void,
): string {
  const homePath = makeTempDir("pharo-nexus-home-");
  initPharoNexusHome({ homePath });
  const config = loadHomeConfig(homePath);
  config.tools.plexus = {
    command: process.execPath,
    args,
  };
  configure?.(config);
  saveHomeConfig(homePath, config);
  homePaths.push(homePath);
  return homePath;
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

afterEach(async () => {
  for (const homePath of homePaths.splice(0)) {
    await stopPlexusGateway({
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

describe("PLexus gateway service", () => {
  it("uses explicit service mode for the PLexus gateway executable", () => {
    expect(buildPlexusGatewayServiceArgs("plexus-gateway", [])).toEqual([
      "serve",
    ]);
    expect(
      buildPlexusGatewayServiceArgs("plexus-gateway.CMD", ["--host", "0.0.0.0"]),
    ).toEqual(["--host", "0.0.0.0", "serve"]);
    expect(buildPlexusGatewayServiceArgs("plexus-gateway", ["--stdio"])).toEqual(
      ["--stdio"],
    );
    expect(buildPlexusGatewayServiceArgs(process.execPath, ["-e", ""])).toEqual([
      "-e",
      "",
    ]);
  });

  it.runIf(process.platform === "win32")(
    "resolves the npm command shim to the real PLexus gateway node entrypoint for services",
    () => {
      const shimDirectory = makeTempDir("pharo-nexus-plexus-shim-");
      const entrypoint = path.join(
        shimDirectory,
        "node_modules",
        "plexus",
        "packages",
        "plexus-gateway",
        "dist",
        "index.js",
      );
      fs.mkdirSync(path.dirname(entrypoint), { recursive: true });
      fs.writeFileSync(entrypoint, "", "utf8");
      fs.writeFileSync(
        path.join(shimDirectory, "plexus-gateway.cmd"),
        [
          "@ECHO off",
          "SET dp0=%~dp0",
          `"%_prog%"  "%dp0%\\node_modules\\plexus\\packages\\plexus-gateway\\dist\\index.js" %*`,
        ].join("\r\n"),
        "utf8",
      );

      const resolved = resolvePlexusGatewayServiceCommand(
        "plexus-gateway",
        [],
        {
          PATH: shimDirectory,
          PATHEXT: ".CMD",
        },
      );

      expect(resolved.command).toBe(process.execPath);
      expect(resolved.args).toEqual([entrypoint, "serve"]);
    },
  );

  it("starts the configured gateway command, records pid state, writes logs, and stops it", async () => {
    const homePath = initHomeWithGateway([
      "-e",
      [
        "process.stdout.write('plexus-ready\\n');",
        "process.stdout.write(`plexus-host=${process.env.PLEXUS_HOST}\\n`);",
        "process.stderr.write('plexus-warn\\n');",
        "setInterval(() => {}, 1000);",
      ].join(""),
    ]);

    const state = await startPlexusGateway({ homePath });

    expect(state.pid).toBeGreaterThan(0);
    expect(loadPlexusGatewayState(homePath)).toMatchObject({
      service: "plexus-gateway",
      status: "running",
      pid: state.pid,
      port: 7331,
      command: process.execPath,
    });
    expect(plexusGatewayStatePath(homePath)).toContain("plexus-gateway.json");

    await waitFor(
      () =>
        Boolean(
          state.logPaths &&
            fileIncludes(state.logPaths.stdout, "plexus-ready") &&
            fileIncludes(state.logPaths.stdout, "plexus-host=127.0.0.1") &&
            fileIncludes(state.logPaths.stderr, "plexus-warn"),
        ),
      Boolean,
    );

    await expect(getPlexusGatewayStatus({ homePath })).resolves.toMatchObject({
      running: true,
      stale: false,
    });

    const stopped = await stopPlexusGateway({ homePath, force: true });
    expect(stopped.stop).toMatchObject({
      pid: state.pid,
      stopped: true,
    });
    expect(loadPlexusGatewayState(homePath)).toMatchObject({
      status: "stopped",
    });
  });

  it("refuses to start a second gateway when the existing one is running", async () => {
    const homePath = initHomeWithGateway([
      "-e",
      "setInterval(() => {}, 1000);",
    ]);

    await startPlexusGateway({ homePath });

    await expect(startPlexusGateway({ homePath })).rejects.toThrow(
      PlexusGatewayServiceError,
    );
  });

  it("reports HTTP health for a gateway listening on the configured port", async () => {
    const port = await freePort();
    const homePath = initHomeWithGateway(
      [
        "-e",
        [
          "const http = require('http');",
          "const port = Number(process.env.PLEXUS_MCP_PORT);",
          "http.createServer((_request, response) => {",
          "response.statusCode = 204;",
          "response.end();",
          "}).listen(port, '127.0.0.1');",
        ].join(""),
      ],
      (config) => {
        config.ports.plexusMcp = port;
      },
    );

    await startPlexusGateway({ homePath });

    const status = await waitFor(
      () => getPlexusGatewayStatus({ homePath, checkHealth: true }),
      (candidate) => candidate.health?.ok === true,
    );

    expect(status).toMatchObject({
      running: true,
      health: {
        ok: true,
        statusCode: 204,
      },
    });
  });
});
