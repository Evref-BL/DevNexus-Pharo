import fs from "node:fs";
import path from "node:path";
import {
  loadHomeConfig,
  nexusLogsDirectoryName,
  resolveNexusHome,
  type NexusHomeConfig,
} from "./config.js";
import {
  defaultDevNexusPharoMcpHealthPath,
  defaultDevNexusPharoMcpHost,
} from "./devNexusPharoMcpProtocol.js";
import {
  checkHttpPort,
  defaultDetachedForPersistentService,
  isProcessRunning,
  startManagedProcess,
  stopProcessByPid,
  type HttpPortHealthCheckResult,
  type ProcessLogPaths,
  type StopProcessByPidResult,
} from "dev-nexus";

export const devNexusPharoMcpServiceName = "dev-nexus-pharo-mcp";
export const devNexusPharoMcpStateFileName = "dev-nexus-pharo-mcp.json";

export type DevNexusPharoMcpRuntimeStatus = "running" | "stopped" | "stale";

export interface DevNexusPharoMcpServiceState {
  service: typeof devNexusPharoMcpServiceName;
  status: DevNexusPharoMcpRuntimeStatus;
  pid?: number;
  host: string;
  port: number;
  command: string;
  args: string[];
  startedAt?: string;
  updatedAt: string;
  logPaths?: ProcessLogPaths;
}

export interface DevNexusPharoMcpStartOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  appendLogs?: boolean;
  release?: boolean;
  extraEnv?: NodeJS.ProcessEnv;
}

export interface DevNexusPharoMcpStopOptions {
  homePath: string;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface DevNexusPharoMcpStatusOptions {
  homePath: string;
  checkHealth?: boolean;
  healthPath?: string;
  healthTimeoutMs?: number;
}

export interface DevNexusPharoMcpStatusResult {
  state?: DevNexusPharoMcpServiceState;
  running: boolean;
  stale: boolean;
  health?: HttpPortHealthCheckResult;
}

export interface DevNexusPharoMcpStopResult {
  state?: DevNexusPharoMcpServiceState;
  stop?: StopProcessByPidResult;
}

export interface DevNexusPharoMcpServiceCommand {
  command: string;
  args: string[];
}

export class DevNexusPharoMcpServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevNexus-PharoMcpServiceError";
  }
}

function now(): string {
  return new Date().toISOString();
}

function servicesStateDirectoryPath(homePath: string): string {
  return path.join(resolveNexusHome(homePath), "state", "services");
}

export function devNexusPharoMcpStatePath(homePath: string): string {
  return path.join(servicesStateDirectoryPath(homePath), devNexusPharoMcpStateFileName);
}

export function devNexusPharoMcpLogDirectoryPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    nexusLogsDirectoryName,
    devNexusPharoMcpServiceName,
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

function isDevNexusPharoEntrypoint(command: string, args: string[]): boolean {
  return args.some((arg) => {
    const normalizedArg = arg.replaceAll("\\", "/").toLowerCase();
    return normalizedArg.endsWith("/dist/cli.js");
  });
}

function hasDevNexusPharoMcpModeArg(args: string[]): boolean {
  return args.some((arg) => arg === "mcp" || arg === "mcp-stdio");
}

export function buildDevNexusPharoMcpServiceArgs(
  command: string,
  args: string[],
): string[] {
  if (
    !isDevNexusPharoEntrypoint(command, args) ||
    hasDevNexusPharoMcpModeArg(args)
  ) {
    return [...args];
  }

  return [...args, "mcp"];
}

export function resolveDevNexusPharoMcpServiceCommand(
  command: string,
  args: string[],
): DevNexusPharoMcpServiceCommand {
  if (normalizedCommandName(command) === "dev-nexus-pharo") {
    throw new DevNexusPharoMcpServiceError(
      'DevNexus-Pharo MCP config uses obsolete bare command "dev-nexus-pharo". Regenerate the MCP config through current DevNexus/DevNexus-Pharo setup so it uses the current Node executable and CLI entrypoint.',
    );
  }

  return {
    command,
    args: buildDevNexusPharoMcpServiceArgs(command, args),
  };
}

function validateState(value: unknown): DevNexusPharoMcpServiceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new DevNexusPharoMcpServiceError("DevNexus-Pharo MCP state must be an object");
  }

  const record = value as Record<string, unknown>;
  if (record.service !== devNexusPharoMcpServiceName) {
    throw new DevNexusPharoMcpServiceError(
      `DevNexus-Pharo MCP state service must be ${devNexusPharoMcpServiceName}`,
    );
  }

  if (
    record.status !== "running" &&
    record.status !== "stopped" &&
    record.status !== "stale"
  ) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state status must be running, stopped, or stale",
    );
  }

  if (typeof record.host !== "string" || record.host.trim().length === 0) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state host must be a non-empty string",
    );
  }

  if (
    typeof record.port !== "number" ||
    !Number.isInteger(record.port) ||
    record.port < 1 ||
    record.port > 65_535
  ) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state port must be an integer between 1 and 65535",
    );
  }

  if (typeof record.command !== "string" || record.command.length === 0) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state command must be a non-empty string",
    );
  }

  if (
    !Array.isArray(record.args) ||
    record.args.some((arg) => typeof arg !== "string")
  ) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state args must be an array of strings",
    );
  }

  if (typeof record.updatedAt !== "string" || record.updatedAt.length === 0) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state updatedAt must be a non-empty string",
    );
  }

  const pid = record.pid;
  if (
    pid !== undefined &&
    (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
  ) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state pid must be a positive integer",
    );
  }

  return record as unknown as DevNexusPharoMcpServiceState;
}

export function loadDevNexusPharoMcpState(
  homePath: string,
): DevNexusPharoMcpServiceState | undefined {
  const filePath = devNexusPharoMcpStatePath(homePath);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return validateState(
    JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function saveDevNexusPharoMcpState(
  homePath: string,
  state: DevNexusPharoMcpServiceState,
): string {
  const filePath = devNexusPharoMcpStatePath(homePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(validateState(state), null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

function stateWithRuntimeStatus(
  state: DevNexusPharoMcpServiceState,
): DevNexusPharoMcpServiceState {
  if (state.status === "stopped" || !state.pid) {
    return state;
  }

  return {
    ...state,
    status: isProcessRunning(state.pid) ? "running" : "stale",
  };
}

export async function startDevNexusPharoMcp(
  options: DevNexusPharoMcpStartOptions,
): Promise<DevNexusPharoMcpServiceState> {
  const homePath = resolveNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const existingState = loadDevNexusPharoMcpState(homePath);
  const existingRuntimeState = existingState
    ? stateWithRuntimeStatus(existingState)
    : undefined;

  if (existingRuntimeState?.status === "running" && existingRuntimeState.pid) {
    if (!options.force) {
      throw new DevNexusPharoMcpServiceError(
        `DevNexus-Pharo MCP is already running with pid ${existingRuntimeState.pid}`,
      );
    }

    await stopProcessByPid(existingRuntimeState.pid, {
      force: true,
      timeoutMs: 5_000,
    });
  }

  const serviceCommand = resolveDevNexusPharoMcpServiceCommand(
    config.tools.nexus.command,
    config.tools.nexus.args,
  );
  const host = config.mcp.host;
  const port = config.ports.devNexusPharoMcp;
  const handle = startManagedProcess({
    name: devNexusPharoMcpServiceName,
    command: serviceCommand.command,
    args: serviceCommand.args,
    logDirectory: devNexusPharoMcpLogDirectoryPath(homePath),
    appendLogs: options.appendLogs ?? true,
    release: options.release ?? true,
    detached: defaultDetachedForPersistentService(),
    env: {
      DEV_NEXUS_PHARO_HOME: homePath,
      DEV_NEXUS_PHARO_MCP_HOST: host,
      DEV_NEXUS_PHARO_MCP_PORT: String(port),
      HOST: host,
      PORT: String(port),
      ...options.extraEnv,
    },
  });

  const state: DevNexusPharoMcpServiceState = {
    service: devNexusPharoMcpServiceName,
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
  saveDevNexusPharoMcpState(homePath, state);

  return state;
}

export async function getDevNexusPharoMcpStatus(
  options: DevNexusPharoMcpStatusOptions,
): Promise<DevNexusPharoMcpStatusResult> {
  const state = loadDevNexusPharoMcpState(options.homePath);
  if (!state) {
    return {
      running: false,
      stale: false,
    };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== state.status) {
    saveDevNexusPharoMcpState(options.homePath, {
      ...runtimeState,
      updatedAt: now(),
    });
  }

  const health =
    options.checkHealth && runtimeState.status === "running"
      ? await checkHttpPort({
          host: runtimeState.host,
          port: runtimeState.port,
          path: options.healthPath ?? defaultDevNexusPharoMcpHealthPath,
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

export async function stopDevNexusPharoMcp(
  options: DevNexusPharoMcpStopOptions,
): Promise<DevNexusPharoMcpStopResult> {
  const homePath = resolveNexusHome(options.homePath);
  const state = loadDevNexusPharoMcpState(homePath);
  if (!state || !state.pid) {
    return { state };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== "running") {
    const stoppedState: DevNexusPharoMcpServiceState = {
      ...runtimeState,
      status: "stopped",
      updatedAt: now(),
    };
    saveDevNexusPharoMcpState(homePath, stoppedState);
    return { state: stoppedState };
  }

  if (!runtimeState.pid) {
    throw new DevNexusPharoMcpServiceError(
      "DevNexus-Pharo MCP state is running but has no pid",
    );
  }

  const stop = await stopProcessByPid(runtimeState.pid, {
    force: options.force ?? true,
    timeoutMs: options.timeoutMs ?? 5_000,
    pollIntervalMs: options.pollIntervalMs ?? 100,
  });
  const stoppedState: DevNexusPharoMcpServiceState = {
    ...runtimeState,
    status: stop.stopped ? "stopped" : "running",
    updatedAt: now(),
  };
  if (stop.stopped) {
    delete stoppedState.pid;
  }

  saveDevNexusPharoMcpState(homePath, stoppedState);

  return {
    state: stoppedState,
    stop,
  };
}

export function defaultDevNexusPharoMcpConfig(): { host: string } {
  return {
    host: defaultDevNexusPharoMcpHost,
  };
}
