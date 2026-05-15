import fs from "node:fs";
import path from "node:path";
import {
  loadHomeConfig,
  pharoNexusCliEntrypointPath,
  pharoNexusLogsDirectoryName,
  resolvePharoNexusHome,
  type NexusHomeConfig,
} from "./config.js";
import {
  defaultPharoNexusMcpHealthPath,
  defaultPharoNexusMcpHost,
} from "./mcpServer.js";
import {
  checkHttpPort,
  defaultDetachedForPersistentService,
  isProcessRunning,
  startManagedProcess,
  stopProcessByPid,
  type HttpPortHealthCheckResult,
  type ProcessLogPaths,
  type StopProcessByPidResult,
} from "./processSupervisor.js";

export const pharoNexusMcpServiceName = "pharo-nexus-mcp";
export const pharoNexusMcpStateFileName = "pharo-nexus-mcp.json";

export type PharoNexusMcpRuntimeStatus = "running" | "stopped" | "stale";

export interface PharoNexusMcpServiceState {
  service: typeof pharoNexusMcpServiceName;
  status: PharoNexusMcpRuntimeStatus;
  pid?: number;
  host: string;
  port: number;
  command: string;
  args: string[];
  startedAt?: string;
  updatedAt: string;
  logPaths?: ProcessLogPaths;
}

export interface PharoNexusMcpStartOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  appendLogs?: boolean;
  release?: boolean;
  extraEnv?: NodeJS.ProcessEnv;
}

export interface PharoNexusMcpStopOptions {
  homePath: string;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface PharoNexusMcpStatusOptions {
  homePath: string;
  checkHealth?: boolean;
  healthPath?: string;
  healthTimeoutMs?: number;
}

export interface PharoNexusMcpStatusResult {
  state?: PharoNexusMcpServiceState;
  running: boolean;
  stale: boolean;
  health?: HttpPortHealthCheckResult;
}

export interface PharoNexusMcpStopResult {
  state?: PharoNexusMcpServiceState;
  stop?: StopProcessByPidResult;
}

export interface PharoNexusMcpServiceCommand {
  command: string;
  args: string[];
}

export class PharoNexusMcpServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PharoNexusMcpServiceError";
  }
}

function now(): string {
  return new Date().toISOString();
}

function servicesStateDirectoryPath(homePath: string): string {
  return path.join(resolvePharoNexusHome(homePath), "state", "services");
}

export function pharoNexusMcpStatePath(homePath: string): string {
  return path.join(servicesStateDirectoryPath(homePath), pharoNexusMcpStateFileName);
}

export function pharoNexusMcpLogDirectoryPath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    pharoNexusLogsDirectoryName,
    pharoNexusMcpServiceName,
  );
}

function loadConfig(
  homePath: string,
  config: NexusHomeConfig | undefined,
): NexusHomeConfig {
  return config ?? loadHomeConfig(homePath);
}

function normalizedCommandName(command: string): string {
  return path
    .basename(command)
    .toLowerCase()
    .replace(/\.(cmd|exe|ps1)$/u, "");
}

function isPharoNexusEntrypoint(command: string, args: string[]): boolean {
  if (normalizedCommandName(command) === "pharo-nexus") {
    return true;
  }

  return args.some((arg) => {
    const normalizedArg = arg.replaceAll("\\", "/").toLowerCase();
    return normalizedArg.endsWith("/dist/cli.js");
  });
}

function hasPharoNexusMcpModeArg(args: string[]): boolean {
  return args.some((arg) => arg === "mcp" || arg === "mcp-stdio");
}

export function buildPharoNexusMcpServiceArgs(
  command: string,
  args: string[],
): string[] {
  if (
    !isPharoNexusEntrypoint(command, args) ||
    hasPharoNexusMcpModeArg(args)
  ) {
    return [...args];
  }

  return [...args, "mcp"];
}

export function resolvePharoNexusMcpServiceCommand(
  command: string,
  args: string[],
): PharoNexusMcpServiceCommand {
  if (normalizedCommandName(command) === "pharo-nexus") {
    return {
      command: process.execPath,
      args: [
        pharoNexusCliEntrypointPath(),
        ...buildPharoNexusMcpServiceArgs(command, args),
      ],
    };
  }

  return {
    command,
    args: buildPharoNexusMcpServiceArgs(command, args),
  };
}

function validateState(value: unknown): PharoNexusMcpServiceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PharoNexusMcpServiceError("PharoNexus MCP state must be an object");
  }

  const record = value as Record<string, unknown>;
  if (record.service !== pharoNexusMcpServiceName) {
    throw new PharoNexusMcpServiceError(
      `PharoNexus MCP state service must be ${pharoNexusMcpServiceName}`,
    );
  }

  if (
    record.status !== "running" &&
    record.status !== "stopped" &&
    record.status !== "stale"
  ) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state status must be running, stopped, or stale",
    );
  }

  if (typeof record.host !== "string" || record.host.trim().length === 0) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state host must be a non-empty string",
    );
  }

  if (
    typeof record.port !== "number" ||
    !Number.isInteger(record.port) ||
    record.port < 1 ||
    record.port > 65_535
  ) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state port must be an integer between 1 and 65535",
    );
  }

  if (typeof record.command !== "string" || record.command.length === 0) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state command must be a non-empty string",
    );
  }

  if (
    !Array.isArray(record.args) ||
    record.args.some((arg) => typeof arg !== "string")
  ) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state args must be an array of strings",
    );
  }

  if (typeof record.updatedAt !== "string" || record.updatedAt.length === 0) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state updatedAt must be a non-empty string",
    );
  }

  const pid = record.pid;
  if (
    pid !== undefined &&
    (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
  ) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state pid must be a positive integer",
    );
  }

  return record as unknown as PharoNexusMcpServiceState;
}

export function loadPharoNexusMcpState(
  homePath: string,
): PharoNexusMcpServiceState | undefined {
  const filePath = pharoNexusMcpStatePath(homePath);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return validateState(
    JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function savePharoNexusMcpState(
  homePath: string,
  state: PharoNexusMcpServiceState,
): string {
  const filePath = pharoNexusMcpStatePath(homePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(validateState(state), null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

function stateWithRuntimeStatus(
  state: PharoNexusMcpServiceState,
): PharoNexusMcpServiceState {
  if (state.status === "stopped" || !state.pid) {
    return state;
  }

  return {
    ...state,
    status: isProcessRunning(state.pid) ? "running" : "stale",
  };
}

export async function startPharoNexusMcp(
  options: PharoNexusMcpStartOptions,
): Promise<PharoNexusMcpServiceState> {
  const homePath = resolvePharoNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const existingState = loadPharoNexusMcpState(homePath);
  const existingRuntimeState = existingState
    ? stateWithRuntimeStatus(existingState)
    : undefined;

  if (existingRuntimeState?.status === "running" && existingRuntimeState.pid) {
    if (!options.force) {
      throw new PharoNexusMcpServiceError(
        `PharoNexus MCP is already running with pid ${existingRuntimeState.pid}`,
      );
    }

    await stopProcessByPid(existingRuntimeState.pid, {
      force: true,
      timeoutMs: 5_000,
    });
  }

  const serviceCommand = resolvePharoNexusMcpServiceCommand(
    config.tools.pharoNexus.command,
    config.tools.pharoNexus.args,
  );
  const host = config.mcp.host;
  const port = config.ports.pharoNexusMcp;
  const handle = startManagedProcess({
    name: pharoNexusMcpServiceName,
    command: serviceCommand.command,
    args: serviceCommand.args,
    logDirectory: pharoNexusMcpLogDirectoryPath(homePath),
    appendLogs: options.appendLogs ?? true,
    release: options.release ?? true,
    detached: defaultDetachedForPersistentService(),
    env: {
      PHARO_NEXUS_HOME: homePath,
      PHARO_NEXUS_MCP_HOST: host,
      PHARO_NEXUS_MCP_PORT: String(port),
      HOST: host,
      PORT: String(port),
      ...options.extraEnv,
    },
  });

  const state: PharoNexusMcpServiceState = {
    service: pharoNexusMcpServiceName,
    status: "running",
    pid: handle.pid,
    host,
    port,
    command: handle.command,
    args: handle.args,
    startedAt: handle.startedAt,
    updatedAt: now(),
    logPaths: handle.logPaths,
  };
  savePharoNexusMcpState(homePath, state);

  return state;
}

export async function getPharoNexusMcpStatus(
  options: PharoNexusMcpStatusOptions,
): Promise<PharoNexusMcpStatusResult> {
  const state = loadPharoNexusMcpState(options.homePath);
  if (!state) {
    return {
      running: false,
      stale: false,
    };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== state.status) {
    savePharoNexusMcpState(options.homePath, {
      ...runtimeState,
      updatedAt: now(),
    });
  }

  const health =
    options.checkHealth && runtimeState.status === "running"
      ? await checkHttpPort({
          host: runtimeState.host,
          port: runtimeState.port,
          path: options.healthPath ?? defaultPharoNexusMcpHealthPath,
          timeoutMs: options.healthTimeoutMs ?? 1_000,
        })
      : undefined;

  return {
    state: runtimeState,
    running: runtimeState.status === "running",
    stale: runtimeState.status === "stale",
    ...(health ? { health } : {}),
  };
}

export async function stopPharoNexusMcp(
  options: PharoNexusMcpStopOptions,
): Promise<PharoNexusMcpStopResult> {
  const homePath = resolvePharoNexusHome(options.homePath);
  const state = loadPharoNexusMcpState(homePath);
  if (!state || !state.pid) {
    return { state };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== "running") {
    const stoppedState: PharoNexusMcpServiceState = {
      ...runtimeState,
      status: "stopped",
      updatedAt: now(),
    };
    savePharoNexusMcpState(homePath, stoppedState);
    return { state: stoppedState };
  }

  if (!runtimeState.pid) {
    throw new PharoNexusMcpServiceError(
      "PharoNexus MCP state is running but has no pid",
    );
  }

  const stop = await stopProcessByPid(runtimeState.pid, {
    force: options.force ?? true,
    timeoutMs: options.timeoutMs ?? 5_000,
    pollIntervalMs: options.pollIntervalMs ?? 100,
  });
  const stoppedState: PharoNexusMcpServiceState = {
    ...runtimeState,
    status: stop.stopped ? "stopped" : "running",
    updatedAt: now(),
  };
  if (stop.stopped) {
    delete stoppedState.pid;
  }

  savePharoNexusMcpState(homePath, stoppedState);

  return {
    state: stoppedState,
    stop,
  };
}

export function defaultPharoNexusMcpConfig(): { host: string } {
  return {
    host: defaultPharoNexusMcpHost,
  };
}
