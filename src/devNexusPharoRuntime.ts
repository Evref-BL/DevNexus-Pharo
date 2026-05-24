import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  waitForHttpPort,
  type HttpPortHealthCheckResult,
} from "dev-nexus";
import {
  ensureControlProject,
  loadHomeConfig,
  resolveNexusHome,
  type NexusHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  getDevNexusPharoMcpStatus,
  startDevNexusPharoMcp,
  stopDevNexusPharoMcp,
  type DevNexusPharoMcpServiceState,
  type DevNexusPharoMcpStatusResult,
  type DevNexusPharoMcpStopResult,
} from "./devNexusPharoMcpService.js";
import { defaultDevNexusPharoMcpHealthPath } from "./devNexusPharoMcpProtocol.js";
import {
  getPlexusGatewayStatus,
  startPlexusGateway,
  stopPlexusGateway,
  type PlexusGatewayStatusResult,
  type PlexusGatewayServiceState,
  type PlexusGatewayStopResult,
} from "./plexusGatewayService.js";

export type DevNexusPharoProgressReporter = (message: string) => void;

export interface DevNexusPharoStartOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  mcpHealthTimeoutMs?: number;
  progress?: DevNexusPharoProgressReporter;
}

export interface DevNexusPharoStartResult {
  homePath: string;
  controlProject: DevNexusPharoControlProjectStartResult;
  services: {
    devNexusPharoMcp: DevNexusPharoMcpServiceState;
    plexusGateway: PlexusGatewayServiceState;
  };
  health: {
    devNexusPharoMcp: HttpPortHealthCheckResult;
  };
}

export interface DevNexusPharoControlProjectStartResult {
  projectPath: string;
  configPath: string;
  config: NexusProjectConfig;
  gitInitialized?: boolean;
  gitError?: string;
}

export interface DevNexusPharoStatusOptions {
  homePath: string;
  config?: NexusHomeConfig;
  checkHealth?: boolean;
  healthTimeoutMs?: number;
}

export interface DevNexusPharoStatusResult {
  homePath: string;
  running: boolean;
  stale: boolean;
  services: {
    devNexusPharoMcp: DevNexusPharoMcpStatusResult;
    plexusGateway: PlexusGatewayStatusResult;
  };
}

export interface DevNexusPharoStopOptions {
  homePath: string;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  progress?: DevNexusPharoProgressReporter;
}

export interface DevNexusPharoStopResult {
  homePath: string;
  services: {
    devNexusPharoMcp: DevNexusPharoMcpStopResult;
    plexusGateway: PlexusGatewayStopResult;
  };
}

export class DevNexusPharoRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevNexus-PharoRuntimeError";
  }
}

function loadConfig(
  homePath: string,
  config: NexusHomeConfig | undefined,
): NexusHomeConfig {
  return config ?? loadHomeConfig(homePath);
}

async function ensurePlexusGatewayStarted(
  homePath: string,
  config: NexusHomeConfig,
  force: boolean | undefined,
  progress?: DevNexusPharoProgressReporter,
): Promise<PlexusGatewayServiceState> {
  const status = await getPlexusGatewayStatus({ homePath });
  if (status.running && status.state && !force) {
    progress?.(
      `PLexus gateway is already running with pid ${status.state.pid}.`,
    );
    return status.state;
  }

  progress?.("Starting PLexus gateway...");
  return startPlexusGateway({ homePath, config, force });
}

async function ensureDevNexusPharoMcpStarted(
  homePath: string,
  config: NexusHomeConfig,
  force: boolean | undefined,
  progress?: DevNexusPharoProgressReporter,
): Promise<DevNexusPharoMcpServiceState> {
  const status = await getDevNexusPharoMcpStatus({ homePath });
  if (status.running && status.state && !force) {
    progress?.(
      `DevNexus-Pharo MCP is already running with pid ${status.state.pid}.`,
    );
    return status.state;
  }

  progress?.("Starting DevNexus-Pharo MCP...");
  return startDevNexusPharoMcp({ homePath, config, force });
}

function isGitRepository(projectPath: string): boolean {
  if (fs.existsSync(path.join(projectPath, ".git"))) {
    return true;
  }

  const result = spawnSync(
    "git",
    ["-C", projectPath, "rev-parse", "--is-inside-work-tree"],
    {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    },
  );

  return result.status === 0 && result.stdout.trim() === "true";
}

function ensureGitRepository(projectPath: string): {
  initialized: boolean;
  error?: string;
} {
  if (isGitRepository(projectPath)) {
    return { initialized: false };
  }

  const result = spawnSync("git", ["-C", projectPath, "init"], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    return {
      initialized: false,
      error: result.error.message,
    };
  }

  if (result.status !== 0) {
    return {
      initialized: false,
      error: result.stderr.trim() || result.stdout.trim() || `exit code ${result.status}`,
    };
  }

  return { initialized: true };
}

function ensureControlProjectReady(
  homePath: string,
  config: NexusHomeConfig,
): DevNexusPharoControlProjectStartResult {
  const controlProject = ensureControlProject(homePath, config.controlProject);
  const git = ensureGitRepository(controlProject.projectPath);

  return {
    projectPath: controlProject.projectPath,
    configPath: controlProject.configPath,
    config: controlProject.config,
    gitInitialized: git.initialized,
    ...(git.error ? { gitError: git.error } : {}),
  };
}

export async function startDevNexusPharo(
  options: DevNexusPharoStartOptions,
): Promise<DevNexusPharoStartResult> {
  const homePath = resolveNexusHome(options.homePath);
  options.progress?.(`Using DevNexus-Pharo home: ${homePath}`);
  const config = loadConfig(homePath, options.config);

  options.progress?.("Ensuring DevNexus-Pharo control project...");
  const controlProject = ensureControlProjectReady(homePath, config);

  const plexusGateway = await ensurePlexusGatewayStarted(
    homePath,
    config,
    options.force,
    options.progress,
  );
  const devNexusPharoMcp = await ensureDevNexusPharoMcpStarted(
    homePath,
    config,
    options.force,
    options.progress,
  );
  options.progress?.(
    `Waiting for DevNexus-Pharo MCP health at http://${devNexusPharoMcp.host}:${devNexusPharoMcp.port}${defaultDevNexusPharoMcpHealthPath}...`,
  );
  const devNexusPharoMcpHealth = await waitForHttpPort({
    host: devNexusPharoMcp.host,
    port: devNexusPharoMcp.port,
    path: defaultDevNexusPharoMcpHealthPath,
    totalTimeoutMs: options.mcpHealthTimeoutMs ?? 30_000,
  });

  if (!devNexusPharoMcpHealth.ok) {
    throw new DevNexusPharoRuntimeError(
      `DevNexus-Pharo MCP did not become healthy at ${devNexusPharoMcpHealth.url}: ${
        devNexusPharoMcpHealth.error ?? "unhealthy response"
      }`,
    );
  }
  options.progress?.("DevNexus-Pharo MCP is healthy.");
  options.progress?.("DevNexus-Pharo start complete.");

  return {
    homePath,
    controlProject,
    services: {
      devNexusPharoMcp,
      plexusGateway,
    },
    health: {
      devNexusPharoMcp: devNexusPharoMcpHealth,
    },
  };
}

export async function getDevNexusPharoStatus(
  options: DevNexusPharoStatusOptions,
): Promise<DevNexusPharoStatusResult> {
  const homePath = resolveNexusHome(options.homePath);
  loadConfig(homePath, options.config);
  const plexusGateway = await getPlexusGatewayStatus({
    homePath,
    checkHealth: options.checkHealth,
    healthTimeoutMs: options.healthTimeoutMs,
  });
  const devNexusPharoMcp = await getDevNexusPharoMcpStatus({
    homePath,
    checkHealth: options.checkHealth,
    healthTimeoutMs: options.healthTimeoutMs,
  });

  return {
    homePath,
    running: devNexusPharoMcp.running && plexusGateway.running,
    stale: devNexusPharoMcp.stale || plexusGateway.stale,
    services: {
      devNexusPharoMcp,
      plexusGateway,
    },
  };
}

export async function stopDevNexusPharo(
  options: DevNexusPharoStopOptions,
): Promise<DevNexusPharoStopResult> {
  const homePath = resolveNexusHome(options.homePath);
  options.progress?.(`Using DevNexus-Pharo home: ${homePath}`);
  options.progress?.("Stopping DevNexus-Pharo MCP...");
  const devNexusPharoMcp = await stopDevNexusPharoMcp({
    homePath,
    force: options.force,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  options.progress?.("DevNexus-Pharo MCP stopped.");
  options.progress?.("Stopping PLexus gateway...");
  const plexusGateway = await stopPlexusGateway({
    homePath,
    force: options.force,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  options.progress?.("PLexus gateway stopped.");
  options.progress?.("DevNexus-Pharo stop complete.");

  return {
    homePath,
    services: {
      devNexusPharoMcp,
      plexusGateway,
    },
  };
}
