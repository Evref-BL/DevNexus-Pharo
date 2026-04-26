import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

export interface ProcessLogPaths {
  stdout: string;
  stderr: string;
  lifecycle: string;
}

export interface StartManagedProcessOptions {
  name: string;
  command: string;
  args?: readonly string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  logDirectory: string;
  appendLogs?: boolean;
  detached?: boolean;
  release?: boolean;
}

export interface ManagedProcessHandle {
  name: string;
  command: string;
  args: string[];
  pid: number;
  startedAt: string;
  logPaths: ProcessLogPaths;
  child: ChildProcess;
}

export interface StopProcessByPidOptions {
  signal?: NodeJS.Signals;
  timeoutMs?: number;
  pollIntervalMs?: number;
  force?: boolean;
  killTree?: boolean;
}

export interface StopProcessByPidResult {
  pid: number;
  stopped: boolean;
  alreadyExited: boolean;
  method: "process.kill" | "taskkill";
}

export interface HttpPortHealthCheckOptions {
  port: number;
  host?: string;
  path?: string;
  timeoutMs?: number;
  healthyStatusMin?: number;
  healthyStatusMax?: number;
}

export interface HttpPortHealthCheckResult {
  ok: boolean;
  url: string;
  statusCode?: number;
  durationMs: number;
  error?: string;
}

export interface WaitForHttpPortOptions extends HttpPortHealthCheckOptions {
  intervalMs?: number;
  totalTimeoutMs?: number;
}

export class ProcessSupervisorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcessSupervisorError";
  }
}

export type ProcessSupervisorPlatform = NodeJS.Platform;

interface ResolvedSpawnCommand {
  command: string;
  argsPrefix: string[];
  displayCommand: string;
}

export interface ProcessListeningOnPortLookupOptions {
  platform?: ProcessSupervisorPlatform;
  allowedProcessNames?: string[];
  timeoutMs?: number;
}

export interface ProcessListeningOnPortResult {
  pid: number;
  platform: ProcessSupervisorPlatform;
  method: "powershell";
}

export function isWindowsPlatform(
  platform: ProcessSupervisorPlatform = process.platform,
): boolean {
  return platform === "win32";
}

export function defaultDetachedForReleasedProcess(
  platform: ProcessSupervisorPlatform = process.platform,
): boolean {
  return !isWindowsPlatform(platform);
}

export function defaultDetachedForPersistentService(
  platform: ProcessSupervisorPlatform = process.platform,
): boolean {
  return isWindowsPlatform(platform);
}

export function defaultKillTreeForPlatform(
  platform: ProcessSupervisorPlatform = process.platform,
): boolean {
  return isWindowsPlatform(platform);
}

export function stopMethodForPlatform(
  killTree: boolean,
  platform: ProcessSupervisorPlatform = process.platform,
): StopProcessByPidResult["method"] {
  return killTree && isWindowsPlatform(platform) ? "taskkill" : "process.kill";
}

function assertNonEmptyString(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new ProcessSupervisorError(`${name} must be a non-empty string`);
  }
}

function assertPid(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new ProcessSupervisorError("pid must be a positive integer");
  }
}

function sanitizeLogName(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-");
  return sanitized.replace(/^-+|-+$/g, "") || "process";
}

function processLogPaths(logDirectory: string, name: string): ProcessLogPaths {
  const baseName = sanitizeLogName(name);
  return {
    stdout: path.join(logDirectory, `${baseName}.stdout.log`),
    stderr: path.join(logDirectory, `${baseName}.stderr.log`),
    lifecycle: path.join(logDirectory, `${baseName}.lifecycle.log`),
  };
}

function writeLifecycleEvent(
  stream: fs.WriteStream,
  event: Record<string, unknown>,
): void {
  stream.write(
    `${JSON.stringify({ timestamp: new Date().toISOString(), ...event })}\n`,
  );
}

function openLogFile(filePath: string, appendLogs: boolean): number {
  return fs.openSync(filePath, appendLogs ? "a" : "w");
}

export function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const entry = Object.entries(env).find(
    ([envKey]) => envKey.toLowerCase() === key.toLowerCase(),
  );

  return entry?.[1];
}

export function commandHasPathSegment(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

export function executableExtensions(
  env: NodeJS.ProcessEnv,
  platform: ProcessSupervisorPlatform = process.platform,
): string[] {
  if (!isWindowsPlatform(platform)) {
    return [""];
  }

  const pathExt = envValue(env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD";
  const extensions = pathExt
    .split(";")
    .map((extension) => extension.trim())
    .filter(Boolean);

  return [...extensions, ""];
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function candidateExecutablePaths(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: ProcessSupervisorPlatform = process.platform,
): string[] {
  const extensions = executableExtensions(env, platform);
  const commandExtension = path.extname(command);
  const candidates =
    isWindowsPlatform(platform) && commandExtension
      ? [command]
      : extensions.map((extension) => `${command}${extension}`);

  if (commandHasPathSegment(command)) {
    return candidates.map((candidate) => path.resolve(candidate));
  }

  const pathValue = envValue(env, "PATH") ?? "";
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .flatMap((directory) =>
      candidates.map((candidate) => path.join(directory, candidate)),
    );
}

export function findExecutablePath(
  command: string,
  env: NodeJS.ProcessEnv,
  platform: ProcessSupervisorPlatform = process.platform,
): string | undefined {
  return candidateExecutablePaths(command, env, platform).find(isFile);
}

function resolveCommandForSpawn(
  command: string,
  env: NodeJS.ProcessEnv,
  processName: string,
): ResolvedSpawnCommand {
  const resolved = findExecutablePath(command, env);
  if (resolved) {
    const extension = path.extname(resolved).toLowerCase();
    if (isWindowsPlatform() && [".bat", ".cmd"].includes(extension)) {
      return {
        command: envValue(env, "COMSPEC") ?? "cmd.exe",
        argsPrefix: ["/d", "/s", "/c", resolved],
        displayCommand: resolved,
      };
    }

    return {
      command: resolved,
      argsPrefix: [],
      displayCommand: resolved,
    };
  }

  throw new ProcessSupervisorError(
    [
      `Cannot start ${processName}: executable not found: ${command}.`,
      "Make sure it is installed and available on PATH,",
      "or update the configured command in pharo-nexus.home.json.",
    ].join(" "),
  );
}

function recordChildError(
  child: ChildProcess,
  lifecycleLog: fs.WriteStream,
): void {
  child.once("error", (error) => {
    if (!lifecycleLog.writableEnded) {
      writeLifecycleEvent(lifecycleLog, {
        event: "error",
        message: error.message,
      });
    }
  });
}

export function startManagedProcess(
  options: StartManagedProcessOptions,
): ManagedProcessHandle {
  assertNonEmptyString(options.name, "name");
  assertNonEmptyString(options.command, "command");

  const args = [...(options.args ?? [])];
  const childEnv = options.env ? { ...process.env, ...options.env } : process.env;
  const resolvedCommand = resolveCommandForSpawn(
    options.command,
    childEnv,
    options.name,
  );
  const spawnArgs = [...resolvedCommand.argsPrefix, ...args];
  const logDirectory = path.resolve(options.logDirectory);
  fs.mkdirSync(logDirectory, { recursive: true });

  const logPaths = processLogPaths(logDirectory, options.name);
  const logFlags = options.appendLogs ? "a" : "w";
  const release = options.release ?? false;
  const detached =
    options.detached ?? (release && defaultDetachedForReleasedProcess());
  const lifecycleLog = fs.createWriteStream(logPaths.lifecycle, {
    flags: logFlags,
  });

  if (release) {
    const stdoutFd = openLogFile(logPaths.stdout, options.appendLogs ?? false);
    const stderrFd = openLogFile(logPaths.stderr, options.appendLogs ?? false);
    const child = spawn(resolvedCommand.command, spawnArgs, {
      cwd: options.cwd,
      env: childEnv,
      detached,
      shell: false,
      stdio: ["ignore", stdoutFd, stderrFd],
      windowsHide: true,
    });
    recordChildError(child, lifecycleLog);

    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);

    if (!child.pid) {
      lifecycleLog.end();
      throw new ProcessSupervisorError(
        `Failed to capture pid for process: ${options.name}`,
      );
    }

    const startedAt = new Date().toISOString();
    writeLifecycleEvent(lifecycleLog, {
      event: "started",
      name: options.name,
      command: resolvedCommand.displayCommand,
      args,
      spawnCommand: resolvedCommand.command,
      spawnArgs,
      pid: child.pid,
      cwd: options.cwd,
      released: true,
      detached,
    });
    lifecycleLog.end();
    child.unref();

    return {
      name: options.name,
      command: resolvedCommand.displayCommand,
      args,
      pid: child.pid,
      startedAt,
      logPaths,
      child,
    };
  }

  const stdoutLog = fs.createWriteStream(logPaths.stdout, { flags: logFlags });
  const stderrLog = fs.createWriteStream(logPaths.stderr, { flags: logFlags });

  const child = spawn(resolvedCommand.command, spawnArgs, {
    cwd: options.cwd,
    env: childEnv,
    detached,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  recordChildError(child, lifecycleLog);

  child.stdout?.pipe(stdoutLog);
  child.stderr?.pipe(stderrLog);

  if (!child.pid) {
    stdoutLog.end();
    stderrLog.end();
    lifecycleLog.end();
    throw new ProcessSupervisorError(
      `Failed to capture pid for process: ${options.name}`,
    );
  }

  const startedAt = new Date().toISOString();
  writeLifecycleEvent(lifecycleLog, {
    event: "started",
    name: options.name,
    command: resolvedCommand.displayCommand,
    args,
    spawnCommand: resolvedCommand.command,
    spawnArgs,
    pid: child.pid,
    cwd: options.cwd,
    detached,
  });

  child.once("close", (exitCode, signal) => {
    writeLifecycleEvent(lifecycleLog, {
      event: "closed",
      exitCode,
      signal,
    });
    lifecycleLog.end();
  });

  return {
    name: options.name,
    command: resolvedCommand.displayCommand,
    args,
    pid: child.pid,
    startedAt,
    logPaths,
    child,
  };
}

export function isProcessRunning(pid: number): boolean {
  assertPid(pid);
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") {
      return false;
    }

    if (code === "EPERM") {
      return true;
    }

    return false;
  }
}

function sleep(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }

    await sleep(pollIntervalMs);
  }

  return !isProcessRunning(pid);
}

function runTaskkill(pid: number, force: boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ["/pid", String(pid), "/t", ...(force ? ["/f"] : [])];
    const child = spawn("taskkill.exe", args, {
      shell: false,
      windowsHide: true,
    });
    let stderr = "";

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      if (exitCode === 0 || !isProcessRunning(pid)) {
        resolve();
        return;
      }

      reject(
        new ProcessSupervisorError(
          `taskkill failed for pid ${pid}: ${stderr.trim() || exitCode}`,
        ),
      );
    });
  });
}

export async function stopProcessByPid(
  pid: number,
  options: StopProcessByPidOptions = {},
): Promise<StopProcessByPidResult> {
  assertPid(pid);

  const timeoutMs = options.timeoutMs ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 100;
  const killTree = options.killTree ?? defaultKillTreeForPlatform();
  const method = stopMethodForPlatform(killTree);

  if (!isProcessRunning(pid)) {
    return { pid, stopped: true, alreadyExited: true, method };
  }

  if (method === "taskkill") {
    await runTaskkill(pid, options.force ?? true);
  } else {
    process.kill(pid, options.signal ?? "SIGTERM");
  }

  let stopped = await waitForProcessExit(pid, timeoutMs, pollIntervalMs);
  if (!stopped && options.force && method === "process.kill") {
    process.kill(pid, "SIGKILL");
    stopped = await waitForProcessExit(pid, timeoutMs, pollIntervalMs);
  }

  return { pid, stopped, alreadyExited: false, method };
}

export function isTcpPortListening(
  port: number,
  timeoutMs = 200,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

function powershellSingleQuotedString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function findProcessListeningOnPort(
  port: number,
  options: ProcessListeningOnPortLookupOptions = {},
): ProcessListeningOnPortResult | undefined {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ProcessSupervisorError(
      "port owner lookup port must be an integer between 1 and 65535",
    );
  }

  const platform = options.platform ?? process.platform;
  if (!isWindowsPlatform(platform)) {
    return undefined;
  }

  const allowedProcessNames = options.allowedProcessNames ?? [];
  const allowedLiteral = allowedProcessNames
    .map(powershellSingleQuotedString)
    .join(", ");
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    `$allowed = @(${allowedLiteral})`,
    "function Test-AllowedProcessName($name) {",
    "  if ($allowed.Count -eq 0) { return $true }",
    "  foreach ($allowedName in $allowed) {",
    "    if ($name -eq $allowedName -or $name -like $allowedName) { return $true }",
    "  }",
    "  return $false",
    "}",
    `$connection = Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1`,
    "if ($connection) {",
    "  $owner = Get-Process -Id $connection.OwningProcess",
    "  if ($owner -and (Test-AllowedProcessName $owner.ProcessName)) {",
    "    [Console]::Out.Write($connection.OwningProcess)",
    "  }",
    "}",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-Command", script],
    {
      encoding: "utf8",
      shell: false,
      timeout: options.timeoutMs ?? 2_000,
      windowsHide: true,
    },
  );
  const pid = Number(result.stdout.trim());

  return Number.isInteger(pid) && pid > 0
    ? { pid, platform, method: "powershell" }
    : undefined;
}

function healthUrl(options: HttpPortHealthCheckOptions): string {
  const host = options.host ?? "127.0.0.1";
  const pathName = options.path ?? "/";
  return `http://${host}:${options.port}${
    pathName.startsWith("/") ? pathName : `/${pathName}`
  }`;
}

export function checkHttpPort(
  options: HttpPortHealthCheckOptions,
): Promise<HttpPortHealthCheckResult> {
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new ProcessSupervisorError(
      "HTTP health check port must be an integer between 1 and 65535",
    );
  }

  const url = healthUrl(options);
  const startedAt = Date.now();
  const healthyStatusMin = options.healthyStatusMin ?? 200;
  const healthyStatusMax = options.healthyStatusMax ?? 399;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      result: Omit<HttpPortHealthCheckResult, "durationMs" | "url">,
    ) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        url,
        durationMs: Date.now() - startedAt,
        ...result,
      });
    };
    const request = http.get(url, (response) => {
      response.resume();
      const statusCode = response.statusCode;
      finish({
        ok:
          statusCode !== undefined &&
          statusCode >= healthyStatusMin &&
          statusCode <= healthyStatusMax,
        ...(statusCode !== undefined ? { statusCode } : {}),
      });
    });

    request.setTimeout(options.timeoutMs ?? 1_000, () => {
      request.destroy();
      finish({ ok: false, error: "HTTP health check timed out" });
    });
    request.once("error", (error) => {
      finish({ ok: false, error: error.message });
    });
  });
}

export async function waitForHttpPort(
  options: WaitForHttpPortOptions,
): Promise<HttpPortHealthCheckResult> {
  const totalTimeoutMs = options.totalTimeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  const startedAt = Date.now();
  let lastResult: HttpPortHealthCheckResult | undefined;

  while (Date.now() - startedAt <= totalTimeoutMs) {
    lastResult = await checkHttpPort(options);
    if (lastResult.ok) {
      return lastResult;
    }

    await sleep(intervalMs);
  }

  return {
    ok: false,
    url: healthUrl(options),
    durationMs: Date.now() - startedAt,
    statusCode: lastResult?.statusCode,
    error: lastResult?.error ?? "Timed out waiting for HTTP port",
  };
}
