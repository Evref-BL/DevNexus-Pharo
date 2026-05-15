import fs from "node:fs";
import path from "node:path";
import {
  loadHomeConfig,
  nexusLogsDirectoryName,
  resolveNexusHome,
  type NexusHomeConfig,
} from "./config.js";
import {
  checkHttpPort,
  defaultDetachedForPersistentService,
  findExecutablePath,
  isProcessRunning,
  isWindowsPlatform,
  startManagedProcess,
  stopProcessByPid,
  type HttpPortHealthCheckResult,
  type ProcessLogPaths,
  type StopProcessByPidResult,
} from "./processSupervisor.js";

export const plexusGatewayServiceName = "plexus-gateway";
export const pharoNexusStateDirectoryName = "state";
export const pharoNexusServicesStateDirectoryName = "services";
export const plexusGatewayStateFileName = "plexus-gateway.json";

export type PlexusGatewayRuntimeStatus = "running" | "stopped" | "stale";

export interface PlexusGatewayServiceState {
  service: typeof plexusGatewayServiceName;
  status: PlexusGatewayRuntimeStatus;
  pid?: number;
  port: number;
  command: string;
  args: string[];
  startedAt?: string;
  updatedAt: string;
  logPaths?: ProcessLogPaths;
}

export interface PlexusGatewayStartOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  appendLogs?: boolean;
  release?: boolean;
  extraEnv?: NodeJS.ProcessEnv;
}

export interface PlexusGatewayStopOptions {
  homePath: string;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface PlexusGatewayStatusOptions {
  homePath: string;
  checkHealth?: boolean;
  healthPath?: string;
  healthTimeoutMs?: number;
}

export interface PlexusGatewayStatusResult {
  state?: PlexusGatewayServiceState;
  running: boolean;
  stale: boolean;
  health?: HttpPortHealthCheckResult;
}

export interface PlexusGatewayStopResult {
  state?: PlexusGatewayServiceState;
  stop?: StopProcessByPidResult;
}

export class PlexusGatewayServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlexusGatewayServiceError";
  }
}

export interface PlexusGatewayServiceCommand {
  command: string;
  args: string[];
}

export function plexusGatewayStateDirectoryPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    pharoNexusStateDirectoryName,
    pharoNexusServicesStateDirectoryName,
  );
}

export function plexusGatewayStatePath(homePath: string): string {
  return path.join(
    plexusGatewayStateDirectoryPath(homePath),
    plexusGatewayStateFileName,
  );
}

export function plexusGatewayLogDirectoryPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    nexusLogsDirectoryName,
    plexusGatewayServiceName,
  );
}

function now(): string {
  return new Date().toISOString();
}

function normalizedCommandName(command: string): string {
  return path
    .basename(command)
    .toLowerCase()
    .replace(/\.(cmd|exe|ps1)$/u, "");
}

function isPlexusGatewayEntrypoint(command: string, args: string[]): boolean {
  if (normalizedCommandName(command) === plexusGatewayServiceName) {
    return true;
  }

  return args.some((arg) => {
    const normalizedArg = arg.replaceAll("\\", "/").toLowerCase();
    return normalizedArg.endsWith(
      "/packages/plexus-gateway/dist/index.js",
    );
  });
}

function hasPlexusGatewayModeArg(args: string[]): boolean {
  return args.some(
    (arg) =>
      arg === "serve" ||
      arg === "http" ||
      arg === "--http" ||
      arg === "--stdio",
  );
}

export function buildPlexusGatewayServiceArgs(
  command: string,
  args: string[],
): string[] {
  if (
    !isPlexusGatewayEntrypoint(command, args) ||
    hasPlexusGatewayModeArg(args)
  ) {
    return [...args];
  }

  return [...args, "serve"];
}

function resolvePlexusGatewayNpmShim(
  command: string,
  env: NodeJS.ProcessEnv,
): PlexusGatewayServiceCommand | undefined {
  if (!isWindowsPlatform()) {
    return undefined;
  }

  const commandPath = findExecutablePath(command, env);
  if (!commandPath || path.extname(commandPath).toLowerCase() !== ".cmd") {
    return undefined;
  }

  const shimSource = fs.readFileSync(commandPath, "utf8");
  const entrypointMatch = shimSource.match(
    /"%dp0%\\(?<entrypoint>node_modules\\plexus\\packages\\plexus-gateway\\dist\\index\.js)"\s+%[*]/iu,
  );
  const entrypoint = entrypointMatch?.groups?.entrypoint;
  if (!entrypoint) {
    return undefined;
  }

  const shimDirectory = path.dirname(commandPath);
  const entrypointPath = path.join(
    shimDirectory,
    ...entrypoint.split("\\"),
  );
  if (!fs.existsSync(entrypointPath)) {
    return undefined;
  }

  const siblingNode = path.join(shimDirectory, "node.exe");
  return {
    command: fs.existsSync(siblingNode) ? siblingNode : process.execPath,
    args: [entrypointPath],
  };
}

export function resolvePlexusGatewayServiceCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): PlexusGatewayServiceCommand {
  const resolvedShim = resolvePlexusGatewayNpmShim(command, env);
  const resolvedCommand = resolvedShim?.command ?? command;
  const resolvedArgs = resolvedShim ? [...resolvedShim.args, ...args] : args;

  return {
    command: resolvedCommand,
    args: buildPlexusGatewayServiceArgs(resolvedCommand, resolvedArgs),
  };
}

function loadConfig(
  homePath: string,
  config: NexusHomeConfig | undefined,
): NexusHomeConfig {
  return config ?? loadHomeConfig(homePath);
}

function validateState(value: unknown): PlexusGatewayServiceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlexusGatewayServiceError("PLexus gateway state must be an object");
  }

  const record = value as Record<string, unknown>;
  if (record.service !== plexusGatewayServiceName) {
    throw new PlexusGatewayServiceError(
      `PLexus gateway state service must be ${plexusGatewayServiceName}`,
    );
  }

  if (
    record.status !== "running" &&
    record.status !== "stopped" &&
    record.status !== "stale"
  ) {
    throw new PlexusGatewayServiceError(
      "PLexus gateway state status must be running, stopped, or stale",
    );
  }

  if (
    typeof record.port !== "number" ||
    !Number.isInteger(record.port) ||
    record.port < 1 ||
    record.port > 65_535
  ) {
    throw new PlexusGatewayServiceError(
      "PLexus gateway state port must be an integer between 1 and 65535",
    );
  }

  if (typeof record.command !== "string" || record.command.length === 0) {
    throw new PlexusGatewayServiceError(
      "PLexus gateway state command must be a non-empty string",
    );
  }

  if (
    !Array.isArray(record.args) ||
    record.args.some((arg) => typeof arg !== "string")
  ) {
    throw new PlexusGatewayServiceError(
      "PLexus gateway state args must be an array of strings",
    );
  }

  if (typeof record.updatedAt !== "string" || record.updatedAt.length === 0) {
    throw new PlexusGatewayServiceError(
      "PLexus gateway state updatedAt must be a non-empty string",
    );
  }

  const pid = record.pid;
  if (
    pid !== undefined &&
    (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0)
  ) {
    throw new PlexusGatewayServiceError(
      "PLexus gateway state pid must be a positive integer",
    );
  }

  return record as unknown as PlexusGatewayServiceState;
}

export function loadPlexusGatewayState(
  homePath: string,
): PlexusGatewayServiceState | undefined {
  const filePath = plexusGatewayStatePath(homePath);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return validateState(
    JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function savePlexusGatewayState(
  homePath: string,
  state: PlexusGatewayServiceState,
): string {
  const filePath = plexusGatewayStatePath(homePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(validateState(state), null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

function stateWithRuntimeStatus(
  state: PlexusGatewayServiceState,
): PlexusGatewayServiceState {
  if (state.status === "stopped" || !state.pid) {
    return state;
  }

  return {
    ...state,
    status: isProcessRunning(state.pid) ? "running" : "stale",
  };
}

export async function startPlexusGateway(
  options: PlexusGatewayStartOptions,
): Promise<PlexusGatewayServiceState> {
  const homePath = resolveNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const existingState = loadPlexusGatewayState(homePath);
  const existingRuntimeState = existingState
    ? stateWithRuntimeStatus(existingState)
    : undefined;

  if (existingRuntimeState?.status === "running" && existingRuntimeState.pid) {
    if (!options.force) {
      throw new PlexusGatewayServiceError(
        `PLexus gateway is already running with pid ${existingRuntimeState.pid}`,
      );
    }

    await stopProcessByPid(existingRuntimeState.pid, {
      force: true,
      timeoutMs: 5_000,
    });
  }

  const serviceCommand = resolvePlexusGatewayServiceCommand(
    config.tools.plexus.command,
    config.tools.plexus.args,
  );
  const handle = startManagedProcess({
    name: plexusGatewayServiceName,
    command: serviceCommand.command,
    args: serviceCommand.args,
    logDirectory: plexusGatewayLogDirectoryPath(homePath),
    appendLogs: options.appendLogs ?? true,
    release: options.release ?? true,
    detached: defaultDetachedForPersistentService(),
    env: {
      PHARO_NEXUS_HOME: homePath,
      PLEXUS_HOST: config.mcp.host,
      PLEXUS_STATE_ROOT: config.paths.plexusStateRoot,
      PLEXUS_MCP_PORT: String(config.ports.plexusMcp),
      PORT: String(config.ports.plexusMcp),
      ...options.extraEnv,
    },
  });

  const state: PlexusGatewayServiceState = {
    service: plexusGatewayServiceName,
    status: "running",
    pid: handle.pid,
    port: config.ports.plexusMcp,
    command: handle.command,
    args: handle.args,
    startedAt: handle.startedAt,
    updatedAt: now(),
    logPaths: handle.logPaths,
  };
  savePlexusGatewayState(homePath, state);

  return state;
}

export async function getPlexusGatewayStatus(
  options: PlexusGatewayStatusOptions,
): Promise<PlexusGatewayStatusResult> {
  const state = loadPlexusGatewayState(options.homePath);
  if (!state) {
    return {
      running: false,
      stale: false,
    };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== state.status) {
    savePlexusGatewayState(options.homePath, {
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

export async function stopPlexusGateway(
  options: PlexusGatewayStopOptions,
): Promise<PlexusGatewayStopResult> {
  const homePath = resolveNexusHome(options.homePath);
  const state = loadPlexusGatewayState(homePath);
  if (!state || !state.pid) {
    return { state };
  }

  const runtimeState = stateWithRuntimeStatus(state);
  if (runtimeState.status !== "running") {
    const stoppedState: PlexusGatewayServiceState = {
      ...runtimeState,
      status: "stopped",
      updatedAt: now(),
    };
    savePlexusGatewayState(homePath, stoppedState);
    return { state: stoppedState };
  }

  if (!runtimeState.pid) {
    throw new PlexusGatewayServiceError(
      "PLexus gateway state is running but has no pid",
    );
  }

  const stop = await stopProcessByPid(runtimeState.pid, {
    force: options.force ?? true,
    timeoutMs: options.timeoutMs ?? 5_000,
    pollIntervalMs: options.pollIntervalMs ?? 100,
  });
  const stoppedState: PlexusGatewayServiceState = {
    ...runtimeState,
    status: stop.stopped ? "stopped" : "running",
    updatedAt: now(),
  };
  if (stop.stopped) {
    delete stoppedState.pid;
  }

  savePlexusGatewayState(homePath, stoppedState);

  return {
    state: stoppedState,
    stop,
  };
}
