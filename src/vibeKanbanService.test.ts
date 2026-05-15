import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initNexusHome,
  loadHomeConfig,
  saveHomeConfig,
  type NexusHomeConfig,
} from "./config.js";
import {
  getVibeKanbanStatus,
  loadVibeKanbanState,
  startVibeKanban,
  stopVibeKanban,
  VibeKanbanServiceError,
  vibeKanbanStatePath,
} from "./vibeKanbanService.js";

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

function initHomeWithVibeKanban(
  args: string[],
  configure?: (config: NexusHomeConfig) => void,
): string {
  const homePath = makeTempDir("pharo-nexus-home-");
  initNexusHome({ homePath });
  const config = loadHomeConfig(homePath);
  config.tools.vibeKanban = {
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
    await stopVibeKanban({
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

describe("Vibe Kanban service", () => {
  it("starts the configured Vibe Kanban command, records pid state, writes logs, and stops it", async () => {
    const port = await freePort();
    const homePath = initHomeWithVibeKanban(
      [
        "-e",
        [
          "process.stdout.write('vibe-ready\\n');",
          "process.stderr.write('vibe-warn\\n');",
          "setInterval(() => {}, 1000);",
        ].join(""),
      ],
      (config) => {
        config.ports.vibeKanban = port;
      },
    );

    const state = await startVibeKanban({ homePath });

    expect(state.pid).toBeGreaterThan(0);
    expect(loadVibeKanbanState(homePath)).toMatchObject({
      service: "vibe-kanban",
      status: "running",
      pid: state.pid,
      port,
      command: process.execPath,
    });
    expect(vibeKanbanStatePath(homePath)).toContain("vibe-kanban.json");

    await waitFor(
      () =>
        Boolean(
          state.logPaths &&
            fileIncludes(state.logPaths.stdout, "vibe-ready") &&
            fileIncludes(state.logPaths.stderr, "vibe-warn"),
        ),
      Boolean,
    );

    await expect(getVibeKanbanStatus({ homePath })).resolves.toMatchObject({
      running: true,
      stale: false,
    });

    const stopped = await stopVibeKanban({ homePath, force: true });
    expect(stopped.stop).toMatchObject({
      pid: state.pid,
      stopped: true,
    });
    expect(loadVibeKanbanState(homePath)).toMatchObject({
      status: "stopped",
    });
  }, 15_000);

  it("refuses to start a second Vibe Kanban process when the existing one is running", async () => {
    const port = await freePort();
    const homePath = initHomeWithVibeKanban(
      [
        "-e",
        "setInterval(() => {}, 1000);",
      ],
      (config) => {
        config.ports.vibeKanban = port;
      },
    );

    await startVibeKanban({ homePath });

    await expect(startVibeKanban({ homePath })).rejects.toThrow(
      VibeKanbanServiceError,
    );
  });

  it("reports HTTP health for Vibe Kanban listening on the configured port", async () => {
    const port = await freePort();
    const homePath = initHomeWithVibeKanban(
      [
        "-e",
        [
          "const http = require('http');",
          "const port = Number(process.env.PORT);",
          "http.createServer((_request, response) => {",
          "response.statusCode = 204;",
          "response.end();",
          "}).listen(port, '127.0.0.1');",
        ].join(""),
      ],
      (config) => {
        config.ports.vibeKanban = port;
      },
    );

    await startVibeKanban({ homePath });

    const status = await waitFor(
      () => getVibeKanbanStatus({ homePath, checkHealth: true }),
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
