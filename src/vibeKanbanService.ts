import fs from "node:fs";
import path from "node:path";
import {
  loadHomeConfig,
  pharoNexusLogsDirectoryName,
  resolvePharoNexusHome,
  type NexusHomeConfig,
} from "./config.js";
import {
  checkHttpPort,
  findProcessListeningOnPort,
  isProcessRunning,
  isTcpPortListening,
  startManagedProcess,
  stopProcessByPid,
  type HttpPortHealthCheckResult,
  type ProcessLogPaths,
  type StopProcessByPidResult,
} from "./processSupervisor.js";

export const vibeKanbanServiceName = "vibe-kanban";
export const vibeKanbanStateDirectoryName = "state";
export const vibeKanbanServicesStateDirectoryName = "services";
export const vibeKanbanStateFileName = "vibe-kanban.json";

export type VibeKanbanRuntimeStatus = "running" | "stopped" | "stale";

export interface VibeKanbanServiceState {
  service: typeof vibeKanbanServiceName;
  status: VibeKanbanRuntimeStatus;
  pid?: number;
  port: number;
  command: string;
  args: string[];
  startedAt?: string;
  updatedAt: string;
  logPaths?: ProcessLogPaths;
}

export interface VibeKanbanStartOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  appendLogs?: boolean;
  release?: boolean;
  extraEnv?: NodeJS.ProcessEnv;
}

export interface VibeKanbanStopOptions {
  homePath: string;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface VibeKanbanStatusOptions {
  homePath: string;
  checkHealth?: boolean;
  healthPath?: string;
  healthTimeoutMs?: number;
}

export interface VibeKanbanStatusResult {
  state?: VibeKanbanServiceState;
  running: boolean;
  stale: boolean;
  health?: HttpPortHealthCheckResult;
}

export interface VibeKanbanStopResult {
  state?: VibeKanbanServiceState;
  stop?: StopProcessByPidResult;
}

export class VibeKanbanServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeKanbanServiceError";
  }
}

export function vibeKanbanStateDirectoryPath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    vibeKanbanStateDirectoryName,
    vibeKanbanServicesStateDirectoryName,
  );
}

export function vibeKanbanStatePath(homePath: string): string {
  return path.join(vibeKanbanStateDirectoryPath(homePath), vibeKanbanStateFileName);
}

export function vibeKanbanLogDirectoryPath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    pharoNexusLogsDirectoryName,
    vibeKanbanServiceName,
  );
}

function now(): string {
  return new Date().toISOString();
}

function loadConfig(
  homePath: string,
  config: NexusHomeConfig | undefined,
): NexusHomeConfig {
  return config ?? loadHomeConfig(homePath);
}

function validateState(value: unknown): VibeKanbanServiceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VibeKanbanServiceError("Vibe Kanban state must be an object");
  }

  const record = value as Record<string, unknown>;
  if (record.service !== vibeKanbanServiceName) {
    throw new VibeKanbanServiceError(
      `Vibe Kanban state service must be ${vibeKanbanServiceName}`,
    );
  }

  if (
    record.status !== "running" &&
    record.status !== "stopped" &&
    record.status !== "stale"
  ) {
    throw new VibeKanbanServiceError(
      "Vibe Kanban state status must be running, stopped, or stale",
    );
  }

  if (
    typeof record.port !== "number" ||
    !Number.isInteger(record.port) ||
    record.port < 1 ||
    record.port > 65_535
  ) {
    throw new VibeKanbanServiceError(
      "Vibe Kanban state port must be an integer between 1 and 65535",
    );
  }

  if (typeof record.command !== "string" || record.command.length === 0) {
    throw new VibeKanbanServiceError(
      "Vibe Kanban state command must be a non-empty string",
    );
  }

  if (
    !Array.isArray(record.args) ||
    record.args.some((arg) => typeof arg !== "string")
  ) {
    throw new VibeKanbanServiceError(
      "Vibe Kanban state args must be an array of strings",
    );
  }

  if (typeof record.updatedAt !== "string" || record.updatedAt.length === 0) {
    throw new VibeKanbanServiceError(
      "Vibe Kanban state updatedAt must be a non-empty string",
    );
  }

  const pid = record.pid;
  if (
    pid !== undefined &&
    (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
  ) {
    throw new VibeKanbanServiceError(
      "Vibe Kanban state pid must be a positive integer",
    );
  }

  return record as unknown as VibeKanbanServiceState;
}

export function loadVibeKanbanState(
  homePath: string,
): VibeKanbanServiceState | undefined {
  const filePath = vibeKanbanStatePath(homePath);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return validateState(
    JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function saveVibeKanbanState(
  homePath: string,
  state: VibeKanbanServiceState,
): string {
  const filePath = vibeKanbanStatePath(homePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(validateState(state), null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

function stateWithRuntimeStatus(
  state: VibeKanbanServiceState,
): VibeKanbanServiceState {
  if (state.status === "stopped" || !state.pid) {
    return state;
  }

  if (isProcessRunning(state.pid)) {
    return {
      ...state,
      status: "running",
    };
  }

  const portOwner = findVibeKanbanPortOwner(state.port);
  if (portOwner) {
    return {
      ...state,
      pid: portOwner.pid,
      status: "running",
    };
  }

  return {
    ...state,
    status: "stale",
  };
}

function findVibeKanbanPortOwner(port: number): { pid: number } | undefined {
  return findProcessListeningOnPort(port, {
    allowedProcessNames: ["*vibe-kanban*", "node", "npx"],
  });
}

async function stopVibeKanbanPortOwner(
  port: number,
  options: { timeoutMs?: number; pollIntervalMs?: number } = {},
): Promise<StopProcessByPidResult | undefined> {
  if (!(await isTcpPortListening(port))) {
    return undefined;
  }

  const portOwner = findVibeKanbanPortOwner(port);
  if (!portOwner) {
    return undefined;
  }

  return stopProcessByPid(portOwner.pid, {
    force: true,
    timeoutMs: options.timeoutMs ?? 5_000,
    pollIntervalMs: options.pollIntervalMs ?? 100,
  });
}

export async function startVibeKanban(
  options: VibeKanbanStartOptions,
): Promise<VibeKanbanServiceState> {
  const homePath = resolvePharoNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const existingState = loadVibeKanbanState(homePath);
  const existingRuntimeState = existingState
    ? stateWithRuntimeStatus(existingState)
    : undefined;

  if (existingRuntimeState?.status === "running" && existingRuntimeState.pid) {
    if (!options.force) {
      throw new VibeKanbanServiceError(
        `Vibe Kanban is already running with pid ${existingRuntimeState.pid}`,
      );
    }

    await stopProcessByPid(existingRuntimeState.pid, {
      force: true,
      timeoutMs: 5_000,
    });
  }

  if (existingRuntimeState?.status === "stale" || options.force) {
    await stopVibeKanbanPortOwner(config.ports.vibeKanban);
  }

  const handle = startManagedProcess({
    name: vibeKanbanServiceName,
    command: config.tools.vibeKanban.command,
    args: config.tools.vibeKanban.args,
    logDirectory: vibeKanbanLogDirectoryPath(homePath),
    appendLogs: options.appendLogs ?? true,
    release: options.release ?? true,
    env: {
      PHARO_NEXUS_HOME: homePath,
      PORT: String(config.ports.vibeKanban),
      HOST: "127.0.0.1",
      MCP_HOST: "127.0.0.1",
      MCP_PORT: String(config.ports.vibeKanban),
      VK_SHARED_API_BASE: config.integrations.vibeKanban.backend.sharedApiBase,
      ...options.extraEnv,
    },
  });

  const state: VibeKanbanServiceState = {
    service: vibeKanbanServiceName,
    status: "running",
    pid: handle.pid,
    port: config.ports.vibeKanban,
    command: handle.command,
    args: handle.args,
    startedAt: handle.startedAt,
    updatedAt: now(),
    logPaths: handle.logPaths,
  };
  saveVibeKanbanState(homePath, state);

  return state;
}

export async function getVibeKanbanStatus(
  options: VibeKanbanStatusOptions,
): Promise<VibeKanbanStatusResult> {
  const state = loadVibeKanbanState(options.homePath);
  if (!state) {
    return {
      running: false,
      stale: false,
    };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== state.status) {
    saveVibeKanbanState(options.homePath, {
      ...runtimeState,
      updatedAt: now(),
    });
  }

  const health =
    options.checkHealth && runtimeState.status === "running"
      ? await checkHttpPort({
          port: runtimeState.port,
          path: options.healthPath ?? "/",
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

export async function stopVibeKanban(
  options: VibeKanbanStopOptions,
): Promise<VibeKanbanStopResult> {
  const homePath = resolvePharoNexusHome(options.homePath);
  const config = loadConfig(homePath, undefined);
  const state = loadVibeKanbanState(homePath);
  if (!state || !state.pid) {
    const stop = await stopVibeKanbanPortOwner(config.ports.vibeKanban, {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
    });
    return { state, ...(stop ? { stop } : {}) };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== "running") {
    const stop = await stopVibeKanbanPortOwner(runtimeState.port, {
      timeoutMs: options.timeoutMs,
      pollIntervalMs: options.pollIntervalMs,
    });
    const stoppedState: VibeKanbanServiceState = {
      ...runtimeState,
      status: "stopped",
      updatedAt: now(),
    };
    saveVibeKanbanState(homePath, stoppedState);
    return { state: stoppedState, ...(stop ? { stop } : {}) };
  }

  if (!runtimeState.pid) {
    throw new VibeKanbanServiceError(
      "Vibe Kanban state is running but has no pid",
    );
  }

  const stop = await stopProcessByPid(runtimeState.pid, {
    force: options.force ?? true,
    timeoutMs: options.timeoutMs ?? 5_000,
    pollIntervalMs: options.pollIntervalMs ?? 100,
  });
  const orphanStop = await stopVibeKanbanPortOwner(runtimeState.port, {
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  const stoppedState: VibeKanbanServiceState = {
    ...runtimeState,
    status: stop.stopped && (!orphanStop || orphanStop.stopped) ? "stopped" : "running",
    updatedAt: now(),
  };
  if (stoppedState.status === "stopped") {
    delete stoppedState.pid;
  }

  saveVibeKanbanState(homePath, stoppedState);

  return {
    state: stoppedState,
    stop: orphanStop ?? stop,
  };
}
