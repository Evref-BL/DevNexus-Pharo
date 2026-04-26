import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  candidateExecutablePaths,
  checkHttpPort,
  defaultDetachedForPersistentService,
  defaultDetachedForReleasedProcess,
  findExecutablePath,
  findProcessListeningOnPort,
  isProcessRunning,
  isTcpPortListening,
  ProcessSupervisorError,
  startManagedProcess,
  stopMethodForPlatform,
  stopProcessByPid,
  waitForHttpPort,
} from "./processSupervisor.js";

const tempDirs: string[] = [];
const startedPids: number[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (predicate()) {
      return;
    }

    await sleep(25);
  }

  throw new Error("Timed out waiting for condition");
}

function fileIncludes(filePath: string, expected: string): boolean {
  return fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8").includes(expected);
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

afterEach(async () => {
  for (const pid of startedPids.splice(0)) {
    if (isProcessRunning(pid)) {
      await stopProcessByPid(pid, {
        force: true,
        timeoutMs: 2_000,
        pollIntervalMs: 50,
      });
    }
  }

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("process supervisor", () => {
  it("defines platform-specific process supervision defaults explicitly", () => {
    expect(defaultDetachedForReleasedProcess("win32")).toBe(false);
    expect(defaultDetachedForReleasedProcess("linux")).toBe(true);
    expect(defaultDetachedForPersistentService("win32")).toBe(true);
    expect(defaultDetachedForPersistentService("darwin")).toBe(false);
    expect(stopMethodForPlatform(true, "win32")).toBe("taskkill");
    expect(stopMethodForPlatform(true, "linux")).toBe("process.kill");
    expect(stopMethodForPlatform(false, "win32")).toBe("process.kill");
  });

  it("resolves Windows command shim candidates behind one helper", () => {
    const shimDirectory = makeTempDir("pharo-nexus-shim-");
    const shimPath = path.join(shimDirectory, "fake-tool.CMD");
    fs.writeFileSync(shimPath, "@echo off\r\n", "utf8");
    const env = {
      PATH: shimDirectory,
      PATHEXT: ".CMD",
    };

    expect(candidateExecutablePaths("fake-tool", env, "win32")).toContain(shimPath);
    expect(findExecutablePath("fake-tool", env, "win32")).toBe(shimPath);
  });

  it("documents non-Windows port-owner lookup as an unavailable fallback", () => {
    expect(findProcessListeningOnPort(12345, { platform: "linux" })).toBeUndefined();
  });

  it("starts a process, captures pid, and writes stdout/stderr/lifecycle logs", async () => {
    const logDirectory = makeTempDir("pharo-nexus-logs-");
    const handle = startManagedProcess({
      name: "plexus mcp",
      command: process.execPath,
      args: [
        "-e",
        [
          "process.stdout.write('ready\\n');",
          "process.stderr.write('warn\\n');",
          "setInterval(() => {}, 1000);",
        ].join(""),
      ],
      logDirectory,
    });
    startedPids.push(handle.pid);

    expect(handle.pid).toBeGreaterThan(0);
    expect(isProcessRunning(handle.pid)).toBe(true);
    expect(handle.logPaths.stdout).toBe(
      path.join(logDirectory, "plexus-mcp.stdout.log"),
    );

    await waitFor(
      () =>
        fileIncludes(handle.logPaths.stdout, "ready") &&
        fileIncludes(handle.logPaths.stderr, "warn") &&
        fileIncludes(handle.logPaths.lifecycle, '"event":"started"'),
    );
  });

  it("releases a background process without requesting a detached Windows console by default", async () => {
    const logDirectory = makeTempDir("pharo-nexus-logs-");
    const handle = startManagedProcess({
      name: "released",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      logDirectory,
      release: true,
    });
    startedPids.push(handle.pid);

    await waitFor(() => fileIncludes(handle.logPaths.lifecycle, '"released":true'));
    expect(fileIncludes(
      handle.logPaths.lifecycle,
      `"detached":${process.platform !== "win32"}`,
    )).toBe(true);
  });

  it("fails with actionable feedback when the executable is missing", () => {
    const logDirectory = makeTempDir("pharo-nexus-logs-");

    expect(() =>
      startManagedProcess({
        name: "plexus-gateway",
        command: "definitely-not-a-real-pharo-nexus-command",
        logDirectory,
      }),
    ).toThrow(ProcessSupervisorError);
    expect(() =>
      startManagedProcess({
        name: "plexus-gateway",
        command: "definitely-not-a-real-pharo-nexus-command",
        logDirectory,
      }),
    ).toThrow(
      "Cannot start plexus-gateway: executable not found: definitely-not-a-real-pharo-nexus-command.",
    );
  });

  it.runIf(process.platform === "win32")(
    "starts a Windows npm-style .cmd shim from PATH",
    async () => {
      const logDirectory = makeTempDir("pharo-nexus-logs-");
      const shimDirectory = makeTempDir("pharo-nexus-shim-");
      fs.writeFileSync(
        path.join(shimDirectory, "fake-shim.cmd"),
        [
          "@echo off",
          `"${process.execPath}" -e "process.stdout.write('cmd-ready\\\\n'); setInterval(() => {}, 1000);"`,
        ].join("\r\n"),
        "utf8",
      );

      const handle = startManagedProcess({
        name: "fake-shim",
        command: "fake-shim",
        env: {
          PATH: shimDirectory,
          PATHEXT: ".CMD",
        },
        logDirectory,
      });
      startedPids.push(handle.pid);

      expect(handle.command.toLowerCase()).toBe(
        path.join(shimDirectory, "fake-shim.CMD").toLowerCase(),
      );
      await waitFor(() => fileIncludes(handle.logPaths.stdout, "cmd-ready"));
    },
  );

  it("stops a process by pid", async () => {
    const logDirectory = makeTempDir("pharo-nexus-logs-");
    const handle = startManagedProcess({
      name: "stoppable",
      command: process.execPath,
      args: ["-e", "setInterval(() => {}, 1000);"],
      logDirectory,
    });
    startedPids.push(handle.pid);

    const result = await stopProcessByPid(handle.pid, {
      force: true,
      timeoutMs: 2_000,
      pollIntervalMs: 50,
    });

    expect(result).toMatchObject({
      pid: handle.pid,
      stopped: true,
      alreadyExited: false,
    });
    await waitFor(() => !isProcessRunning(handle.pid));
    startedPids.splice(startedPids.indexOf(handle.pid), 1);
  });

  it("checks and waits for an HTTP port", async () => {
    const server = http.createServer((_request, response) => {
      response.statusCode = 204;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected TCP server address");
      }

      await expect(
        checkHttpPort({
          port: address.port,
          timeoutMs: 500,
        }),
      ).resolves.toMatchObject({
        ok: true,
        statusCode: 204,
      });
      await expect(
        waitForHttpPort({
          port: address.port,
          totalTimeoutMs: 500,
          intervalMs: 25,
          timeoutMs: 100,
        }),
      ).resolves.toMatchObject({
        ok: true,
      });
      await expect(isTcpPortListening(address.port)).resolves.toBe(true);
    } finally {
      await closeServer(server);
    }
  });

  it("returns an unhealthy result when no HTTP service answers", async () => {
    const server = http.createServer((_request, response) => {
      response.statusCode = 200;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Expected TCP server address");
    }
    const port = address.port;
    await closeServer(server);

    await expect(
      checkHttpPort({
        port,
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({
      ok: false,
    });
  });
});
