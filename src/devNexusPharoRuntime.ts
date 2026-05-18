import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  ensureVibeKanbanBoard,
  listVibeKanbanProjects,
  openBrowser as defaultBrowserOpener,
  registerVibeKanbanProject,
  type BrowserOpenResult,
  type BrowserOpener,
  type EnsureVibeKanbanBoardResult,
  type ListVibeKanbanProjectsResult,
  type RegisterVibeKanbanProjectResult,
} from "dev-nexus";
import {
  ensureControlProject,
  loadHomeConfig,
  devNexusPharoControlProjectName,
  resolveNexusHome,
  saveHomeConfig,
  saveProjectConfig,
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
import { defaultDevNexusPharoMcpHealthPath } from "./mcpServer.js";
import {
  getPlexusGatewayStatus,
  startPlexusGateway,
  stopPlexusGateway,
  type PlexusGatewayStatusResult,
  type PlexusGatewayServiceState,
  type PlexusGatewayStopResult,
} from "./plexusGatewayService.js";
import {
  waitForHttpPort,
  type HttpPortHealthCheckResult,
} from "dev-nexus";
import {
  installDevNexusPharoAndPlexusMcpForExecutor,
  type InstallDevNexusPharoAndPlexusMcpConfigResult,
} from "./vibeKanbanMcpConfig.js";
import {
  ensureVibeKanbanSelfHostedLogin,
  type VibeKanbanAutoLoginResult,
} from "./vibeKanbanAuth.js";
import {
  getVibeKanbanStatus,
  startVibeKanban,
  stopVibeKanban,
  type VibeKanbanStatusResult,
  type VibeKanbanServiceState,
  type VibeKanbanStopResult,
} from "./vibeKanbanService.js";
import {
  getVibeKanbanBackendStatus,
  startVibeKanbanBackend,
  stopVibeKanbanBackend,
  type VibeKanbanBackendProgressReporter,
  type VibeKanbanBackendServiceState,
  type VibeKanbanBackendStatusResult,
  type VibeKanbanBackendStopResult,
} from "./vibeKanbanBackendService.js";

export type DevNexusPharoProgressReporter = (message: string) => void;

export interface DevNexusPharoStartOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  executor?: string;
  serverName?: string;
  skipMcpConfig?: boolean;
  openBrowser?: boolean;
  browserOpener?: BrowserOpener;
  vibeHealthTimeoutMs?: number;
  mcpHealthTimeoutMs?: number;
  backendHealthTimeoutMs?: number;
  progress?: DevNexusPharoProgressReporter;
}

export interface DevNexusPharoStartResult {
  homePath: string;
  controlProject: DevNexusPharoControlProjectStartResult;
  services: {
    vibeKanbanBackend?: VibeKanbanBackendServiceState;
    devNexusPharoMcp: DevNexusPharoMcpServiceState;
    plexusGateway: PlexusGatewayServiceState;
    vibeKanban: VibeKanbanServiceState;
  };
  health: {
    vibeKanbanBackend?: HttpPortHealthCheckResult;
    devNexusPharoMcp: HttpPortHealthCheckResult;
    vibeKanban: HttpPortHealthCheckResult;
  };
  auth?: {
    vibeKanban?: VibeKanbanAutoLoginResult;
  };
  browser?: BrowserOpenResult;
  mcpConfig?: InstallDevNexusPharoAndPlexusMcpConfigResult;
}

export interface DevNexusPharoControlProjectStartResult {
  projectPath: string;
  configPath: string;
  config: NexusProjectConfig;
  linked: boolean;
  vibeKanbanProjectId: string | null;
  vibeKanbanRepoId?: string | null;
  vibeKanbanRepo?: RegisterVibeKanbanProjectResult;
  vibeKanbanRepos?: ListVibeKanbanProjectsResult;
  vibeKanbanBoard?: EnsureVibeKanbanBoardResult;
  linkError?: string;
  repoError?: string;
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
    vibeKanbanBackend: VibeKanbanBackendStatusResult;
    devNexusPharoMcp: DevNexusPharoMcpStatusResult;
    plexusGateway: PlexusGatewayStatusResult;
    vibeKanban: VibeKanbanStatusResult;
  };
}

export interface DevNexusPharoStopOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  progress?: DevNexusPharoProgressReporter;
}

export interface DevNexusPharoStopResult {
  homePath: string;
  services: {
    vibeKanban: VibeKanbanStopResult;
    devNexusPharoMcp: DevNexusPharoMcpStopResult;
    plexusGateway: PlexusGatewayStopResult;
    vibeKanbanBackend?: VibeKanbanBackendStopResult | VibeKanbanBackendStatusResult;
  };
}

export class DevNexusPharoRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevNexus-PharoRuntimeError";
  }
}

interface EnsuredVibeKanbanService {
  state: VibeKanbanServiceState;
  autoOpenedBrowser: boolean;
}

function loadConfig(
  homePath: string,
  config: NexusHomeConfig | undefined,
): NexusHomeConfig {
  return config ?? loadHomeConfig(homePath);
}

export function vibeKanbanToolOpensBrowserOnStart(
  tool: NexusHomeConfig["tools"]["vibeKanban"],
): boolean {
  const commandName =
    tool.command.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  const args = tool.args.map((arg) => arg.toLowerCase());
  const runsViaNpx =
    commandName === "npx" ||
    commandName === "npx.cmd" ||
    commandName === "npx.exe";
  const runsVibeKanbanBinary =
    commandName === "vibe-kanban" ||
    commandName === "vibe-kanban.cmd" ||
    commandName === "vibe-kanban.exe";

  return (
    runsVibeKanbanBinary ||
    (runsViaNpx && args.some((arg) => arg === "vibe-kanban" || arg.startsWith("vibe-kanban@")))
  );
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

async function ensureVibeKanbanStarted(
  homePath: string,
  config: NexusHomeConfig,
  force: boolean | undefined,
  progress?: DevNexusPharoProgressReporter,
): Promise<EnsuredVibeKanbanService> {
  const status = await getVibeKanbanStatus({ homePath });
  if (status.running && status.state && !force) {
    progress?.(`Vibe Kanban app is already running with pid ${status.state.pid}.`);
    return {
      state: status.state,
      autoOpenedBrowser: false,
    };
  }

  progress?.("Starting Vibe Kanban app...");
  const state = await startVibeKanban({ homePath, config, force });
  return {
    state,
    autoOpenedBrowser: vibeKanbanToolOpensBrowserOnStart(config.tools.vibeKanban),
  };
}

async function ensureVibeKanbanBackendReady(
  homePath: string,
  config: NexusHomeConfig,
  force: boolean | undefined,
  backendHealthTimeoutMs: number | undefined,
  progress?: VibeKanbanBackendProgressReporter,
): Promise<VibeKanbanBackendStatusResult> {
  const backendConfig = config.integrations.vibeKanban.backend;
  if (backendConfig.startOnDevNexusPharoStart) {
    progress?.("Preparing Vibe Kanban backend...");
    await startVibeKanbanBackend({
      homePath,
      config,
      force,
      healthTimeoutMs: backendHealthTimeoutMs,
      progress,
    });
  }

  return getVibeKanbanBackendStatus({
    homePath,
    config,
    checkHealth: true,
    healthTimeoutMs: backendHealthTimeoutMs,
  });
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

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function projectPathMatchesRepo(
  projectPath: string,
  repo: { path?: string; name?: string; display_name?: string },
): boolean {
  if (typeof repo.path === "string" && samePath(projectPath, repo.path)) {
    return true;
  }

  return repo.name === devNexusPharoControlProjectName ||
    repo.display_name === devNexusPharoControlProjectName;
}

async function resolveControlProjectRepoId(
  homePath: string,
  config: NexusHomeConfig,
  projectPath: string,
): Promise<{
  repoId: string | null;
  repos?: ListVibeKanbanProjectsResult;
}> {
  const configuredRepoId = config.controlProject.vibeKanbanRepoId;
  if (configuredRepoId) {
    return {
      repoId: configuredRepoId,
    };
  }

  const repos = await listVibeKanbanProjects({
    port: config.ports.vibeKanban,
  });
  const configuredProjectId = config.controlProject.vibeKanbanProjectId;
  const repoFromConfiguredProjectId =
    configuredProjectId
      ? repos.projects.find(
          (repo) =>
            repo.id === configuredProjectId &&
            projectPathMatchesRepo(projectPath, repo),
        )
      : undefined;
  const repo =
    repoFromConfiguredProjectId ??
    repos.projects.find((candidate) => projectPathMatchesRepo(projectPath, candidate));
  if (!repo) {
    return {
      repoId: null,
      repos,
    };
  }

  config.controlProject.vibeKanbanRepoId = repo.id;
  if (repoFromConfiguredProjectId) {
    config.controlProject.vibeKanbanProjectId = null;
  }
  saveHomeConfig(homePath, config);

  return {
    repoId: repo.id,
    repos,
  };
}

async function ensureControlProjectLinked(
  homePath: string,
  config: NexusHomeConfig,
): Promise<DevNexusPharoControlProjectStartResult> {
  const controlProject = ensureControlProject(homePath, config.controlProject);
  const git = ensureGitRepository(controlProject.projectPath);

  if (git.error) {
    return {
      projectPath: controlProject.projectPath,
      configPath: controlProject.configPath,
      config: controlProject.config,
      linked: false,
      vibeKanbanProjectId: null,
      vibeKanbanRepoId: config.controlProject.vibeKanbanRepoId,
      gitInitialized: git.initialized,
      gitError: git.error,
      linkError: `Cannot register control project because git init failed: ${git.error}`,
    };
  }

  let repoId: string | null = config.controlProject.vibeKanbanRepoId;
  let repos: ListVibeKanbanProjectsResult | undefined;
  let repo: RegisterVibeKanbanProjectResult | undefined;
  let repoError: string | undefined;
  try {
    const resolvedRepo = await resolveControlProjectRepoId(
      homePath,
      config,
      controlProject.projectPath,
    );
    repoId = resolvedRepo.repoId;
    repos = resolvedRepo.repos;
    if (!repoId) {
      repo = await registerVibeKanbanProject({
        port: config.ports.vibeKanban,
        projectRoot: controlProject.projectPath,
        name: config.controlProject.name,
      });
      repoId = repo.projectId;
      config.controlProject.vibeKanbanRepoId = repoId;
      saveHomeConfig(homePath, config);
    }
  } catch (error) {
    repoError = error instanceof Error ? error.message : String(error);
  }

  try {
    const board = await ensureVibeKanbanBoard({
      port: config.ports.vibeKanban,
      name: config.controlProject.name,
    });
    const updatedConfig: NexusProjectConfig = {
      ...controlProject.config,
      name: config.controlProject.name,
      kanban: {
        provider: "vibe-kanban",
        projectId: board.boardId,
      },
    };
    config.controlProject.vibeKanbanProjectId = board.boardId;
    config.controlProject.vibeKanbanRepoId = repoId;
    saveProjectConfig(controlProject.projectPath, updatedConfig);
    saveHomeConfig(homePath, config);

    return {
      projectPath: controlProject.projectPath,
      configPath: controlProject.configPath,
      config: updatedConfig,
      linked: true,
      vibeKanbanProjectId: board.boardId,
      vibeKanbanRepoId: repoId,
      gitInitialized: git.initialized,
      vibeKanbanBoard: board,
      ...(repo ? { vibeKanbanRepo: repo } : {}),
      ...(repos ? { vibeKanbanRepos: repos } : {}),
      ...(repoError ? { repoError } : {}),
    };
  } catch (error) {
    const linkError = error instanceof Error ? error.message : String(error);
    return {
      projectPath: controlProject.projectPath,
      configPath: controlProject.configPath,
      config: controlProject.config,
      linked: false,
      vibeKanbanProjectId: null,
      vibeKanbanRepoId: repoId,
      gitInitialized: git.initialized,
      ...(repo ? { vibeKanbanRepo: repo } : {}),
      ...(repos ? { vibeKanbanRepos: repos } : {}),
      ...(repoError ? { repoError } : {}),
      linkError,
    };
  }
}

function vibeKanbanProjectUrl(port: number, projectId: string | null): string {
  const baseUrl = `http://127.0.0.1:${port}/`;
  return projectId ? `${baseUrl}projects/${projectId}` : baseUrl;
}

export async function startDevNexusPharo(
  options: DevNexusPharoStartOptions,
): Promise<DevNexusPharoStartResult> {
  const homePath = resolveNexusHome(options.homePath);
  options.progress?.(`Using DevNexus-Pharo home: ${homePath}`);
  const config = loadConfig(homePath, options.config);
  const vibeKanbanBackend = await ensureVibeKanbanBackendReady(
    homePath,
    config,
    options.force,
    options.backendHealthTimeoutMs,
    options.progress,
  );
  const ensuredVibeKanban = await ensureVibeKanbanStarted(
    homePath,
    config,
    options.force,
    options.progress,
  );
  const vibeKanban = ensuredVibeKanban.state;
  options.progress?.(
    `Waiting for Vibe Kanban app health at http://127.0.0.1:${config.ports.vibeKanban}/...`,
  );
  const vibeKanbanHealth = await waitForHttpPort({
    port: config.ports.vibeKanban,
    totalTimeoutMs: options.vibeHealthTimeoutMs ?? 30_000,
  });

  if (!vibeKanbanHealth.ok) {
    throw new DevNexusPharoRuntimeError(
      `Vibe Kanban did not become healthy at ${vibeKanbanHealth.url}: ${
        vibeKanbanHealth.error ?? "unhealthy response"
      }`,
    );
  }
  options.progress?.("Vibe Kanban app is healthy.");
  const vibeKanbanAuth = await (async () => {
    try {
      return await ensureVibeKanbanSelfHostedLogin({
        port: config.ports.vibeKanban,
        config,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DevNexusPharoRuntimeError(
        [
          "Failed to sign into Vibe Kanban with managed self-hosted local auth.",
          "If the backend env file changed while Vibe was running, restart DevNexus-Pharo so the backend reloads it.",
          detail,
        ].join(" "),
      );
    }
  })();
  if (vibeKanbanAuth.status === "logged-in") {
    options.progress?.(
      `Signed into Vibe Kanban with self-hosted local auth as ${vibeKanbanAuth.email}.`,
    );
  } else if (vibeKanbanAuth.status === "already-logged-in") {
    options.progress?.("Vibe Kanban is already signed in.");
  }

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
  options.progress?.("Ensuring DevNexus-Pharo control project and Vibe links...");
  const controlProject = await ensureControlProjectLinked(homePath, config);
  const browserUrl = vibeKanbanProjectUrl(
    config.ports.vibeKanban,
    controlProject.vibeKanbanProjectId,
  );
  const shouldOpenBrowser =
    options.openBrowser ?? config.integrations.vibeKanban.openBrowserOnStart;
  const shouldUseExplicitBrowserOpen =
    shouldOpenBrowser && !ensuredVibeKanban.autoOpenedBrowser;
  if (shouldUseExplicitBrowserOpen) {
    options.progress?.(`Opening Vibe Kanban at ${browserUrl}...`);
  } else if (shouldOpenBrowser && ensuredVibeKanban.autoOpenedBrowser) {
    options.progress?.(
      "Vibe Kanban opened the browser during app startup; skipping duplicate browser open.",
    );
  }
  const browser = shouldUseExplicitBrowserOpen
    ? await (options.browserOpener ?? defaultBrowserOpener)(browserUrl)
    : undefined;
  const executor = options.executor ?? config.integrations.vibeKanban.executor;
  const shouldInstallMcpConfig =
    !options.skipMcpConfig &&
    config.integrations.vibeKanban.installMcpOnStart;
  if (shouldInstallMcpConfig) {
    options.progress?.(`Installing MCP server config for ${executor}...`);
  }
  const mcpConfig =
    shouldInstallMcpConfig
      ? await installDevNexusPharoAndPlexusMcpForExecutor({
          homePath,
          config,
          executor,
          plexusServerName:
            options.serverName ?? config.integrations.vibeKanban.plexusMcpServerName,
          nexusServerName:
            config.integrations.vibeKanban.nexusMcpServerName,
          port: config.ports.vibeKanban,
        })
      : undefined;
  options.progress?.("DevNexus-Pharo start complete.");

  return {
    homePath,
    controlProject,
    services: {
      ...(vibeKanbanBackend.state
        ? { vibeKanbanBackend: vibeKanbanBackend.state }
        : {}),
      devNexusPharoMcp,
      plexusGateway,
      vibeKanban,
    },
    health: {
      ...(vibeKanbanBackend.health
        ? { vibeKanbanBackend: vibeKanbanBackend.health }
        : {}),
      devNexusPharoMcp: devNexusPharoMcpHealth,
      vibeKanban: vibeKanbanHealth,
    },
    auth: {
      vibeKanban: vibeKanbanAuth,
    },
    ...(browser ? { browser } : {}),
    ...(mcpConfig ? { mcpConfig } : {}),
  };
}

export async function getDevNexusPharoStatus(
  options: DevNexusPharoStatusOptions,
): Promise<DevNexusPharoStatusResult> {
  const homePath = resolveNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const vibeKanbanBackend = await getVibeKanbanBackendStatus({
    homePath,
    config,
    checkHealth: options.checkHealth,
    healthTimeoutMs: options.healthTimeoutMs,
  });
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
  const vibeKanban = await getVibeKanbanStatus({
    homePath,
    checkHealth: options.checkHealth,
    healthTimeoutMs: options.healthTimeoutMs,
  });

  return {
    homePath,
    running:
      vibeKanbanBackend.running &&
      devNexusPharoMcp.running &&
      plexusGateway.running &&
      vibeKanban.running,
    stale:
      vibeKanbanBackend.stale ||
      devNexusPharoMcp.stale ||
      plexusGateway.stale ||
      vibeKanban.stale,
    services: {
      vibeKanbanBackend,
      devNexusPharoMcp,
      plexusGateway,
      vibeKanban,
    },
  };
}

export async function stopDevNexusPharo(
  options: DevNexusPharoStopOptions,
): Promise<DevNexusPharoStopResult> {
  const homePath = resolveNexusHome(options.homePath);
  options.progress?.(`Using DevNexus-Pharo home: ${homePath}`);
  const config = loadConfig(homePath, options.config);
  options.progress?.("Stopping Vibe Kanban app...");
  const vibeKanban = await stopVibeKanban({
    homePath,
    force: options.force,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  options.progress?.("Vibe Kanban app stopped.");
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
  const backendConfig = config.integrations.vibeKanban.backend;
  const vibeKanbanBackend =
    backendConfig.stopOnDevNexusPharoStop
      ? await (async () => {
          options.progress?.("Stopping Vibe Kanban backend...");
          const result = await stopVibeKanbanBackend({
            homePath,
            config,
            timeoutMs: options.timeoutMs,
          });
          options.progress?.("Vibe Kanban backend stopped.");
          return result;
        })()
      : await (async () => {
          options.progress?.("Leaving Vibe Kanban backend running by configuration.");
          return getVibeKanbanBackendStatus({
            homePath,
            config,
            checkHealth: false,
          });
        })();
  options.progress?.("DevNexus-Pharo stop complete.");

  return {
    homePath,
    services: {
      vibeKanban,
      devNexusPharoMcp,
      plexusGateway,
      vibeKanbanBackend,
    },
  };
}
