import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  openBrowser as defaultBrowserOpener,
  type BrowserOpenResult,
  type BrowserOpener,
} from "./browserOpener.js";
import {
  ensureControlProject,
  legacyControlProjectRootPath,
  loadHomeConfig,
  pharoNexusControlProjectId,
  pharoNexusControlProjectName,
  projectConfigPath,
  resolvePharoNexusHome,
  saveHomeConfig,
  saveProjectConfig,
  type NexusHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  getPharoNexusMcpStatus,
  startPharoNexusMcp,
  stopPharoNexusMcp,
  type PharoNexusMcpServiceState,
  type PharoNexusMcpStatusResult,
  type PharoNexusMcpStopResult,
} from "./pharoNexusMcpService.js";
import { defaultPharoNexusMcpHealthPath } from "./mcpServer.js";
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
} from "./processSupervisor.js";
import {
  installPharoNexusAndPlexusMcpForExecutor,
  type InstallPharoNexusAndPlexusMcpConfigResult,
} from "./vibeKanbanMcpConfig.js";
import {
  ensureVibeKanbanSelfHostedLogin,
  type VibeKanbanAutoLoginResult,
} from "./vibeKanbanAuth.js";
import {
  ensureVibeKanbanBoard,
  type EnsureVibeKanbanBoardResult,
} from "./vibeKanbanBoardAdapter.js";
import {
  listVibeKanbanProjects,
  registerVibeKanbanProject,
  type ListVibeKanbanProjectsResult,
  type RegisterVibeKanbanProjectResult,
} from "./vibeKanbanProjectAdapter.js";
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

export type PharoNexusProgressReporter = (message: string) => void;

export interface PharoNexusStartOptions {
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
  progress?: PharoNexusProgressReporter;
}

export interface PharoNexusStartResult {
  homePath: string;
  controlProject: PharoNexusControlProjectStartResult;
  services: {
    vibeKanbanBackend?: VibeKanbanBackendServiceState;
    pharoNexusMcp: PharoNexusMcpServiceState;
    plexusGateway: PlexusGatewayServiceState;
    vibeKanban: VibeKanbanServiceState;
  };
  health: {
    vibeKanbanBackend?: HttpPortHealthCheckResult;
    pharoNexusMcp: HttpPortHealthCheckResult;
    vibeKanban: HttpPortHealthCheckResult;
  };
  auth?: {
    vibeKanban?: VibeKanbanAutoLoginResult;
  };
  browser?: BrowserOpenResult;
  mcpConfig?: InstallPharoNexusAndPlexusMcpConfigResult;
}

export interface PharoNexusControlProjectStartResult {
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

export interface PharoNexusStatusOptions {
  homePath: string;
  config?: NexusHomeConfig;
  checkHealth?: boolean;
  healthTimeoutMs?: number;
}

export interface PharoNexusStatusResult {
  homePath: string;
  running: boolean;
  stale: boolean;
  services: {
    vibeKanbanBackend: VibeKanbanBackendStatusResult;
    pharoNexusMcp: PharoNexusMcpStatusResult;
    plexusGateway: PlexusGatewayStatusResult;
    vibeKanban: VibeKanbanStatusResult;
  };
}

export interface PharoNexusStopOptions {
  homePath: string;
  config?: NexusHomeConfig;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
  progress?: PharoNexusProgressReporter;
}

export interface PharoNexusStopResult {
  homePath: string;
  services: {
    vibeKanban: VibeKanbanStopResult;
    pharoNexusMcp: PharoNexusMcpStopResult;
    plexusGateway: PlexusGatewayStopResult;
    vibeKanbanBackend?: VibeKanbanBackendStopResult | VibeKanbanBackendStatusResult;
  };
}

export class PharoNexusRuntimeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PharoNexusRuntimeError";
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
  progress?: PharoNexusProgressReporter,
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

async function ensurePharoNexusMcpStarted(
  homePath: string,
  config: NexusHomeConfig,
  force: boolean | undefined,
  progress?: PharoNexusProgressReporter,
): Promise<PharoNexusMcpServiceState> {
  const status = await getPharoNexusMcpStatus({ homePath });
  if (status.running && status.state && !force) {
    progress?.(
      `PharoNexus MCP is already running with pid ${status.state.pid}.`,
    );
    return status.state;
  }

  progress?.("Starting PharoNexus MCP...");
  return startPharoNexusMcp({ homePath, config, force });
}

async function ensureVibeKanbanStarted(
  homePath: string,
  config: NexusHomeConfig,
  force: boolean | undefined,
  progress?: PharoNexusProgressReporter,
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
  if (backendConfig.startOnPharoNexusStart) {
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

function migrateLegacyControlProject(
  homePath: string,
  config: NexusHomeConfig,
): void {
  if (config.controlProject.id !== pharoNexusControlProjectId) {
    return;
  }

  const legacyRoot = legacyControlProjectRootPath(homePath);
  const currentRoot = path.resolve(config.controlProject.root);
  const targetRoot = path.join(homePath, pharoNexusControlProjectName);
  const usesLegacyDefaultRoot = samePath(currentRoot, legacyRoot);
  if (!usesLegacyDefaultRoot && config.controlProject.name === pharoNexusControlProjectName) {
    return;
  }

  if (usesLegacyDefaultRoot) {
    if (
      fs.existsSync(legacyRoot) &&
      !fs.existsSync(projectConfigPath(targetRoot))
    ) {
      fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
      fs.renameSync(legacyRoot, targetRoot);
    }

    config.controlProject.root = targetRoot;
    config.controlProject.vibeKanbanProjectId = null;
    config.controlProject.vibeKanbanRepoId = null;
  }

  config.controlProject.name = pharoNexusControlProjectName;
  saveHomeConfig(homePath, config);

  const migratedProjectConfigPath = projectConfigPath(config.controlProject.root);
  if (fs.existsSync(migratedProjectConfigPath)) {
    const migratedProject = ensureControlProject(homePath, config.controlProject);
    const updatedProject: NexusProjectConfig = {
      ...migratedProject.config,
      name: pharoNexusControlProjectName,
      kanban: {
        ...migratedProject.config.kanban,
        projectId: config.controlProject.vibeKanbanProjectId,
      },
    };
    saveProjectConfig(migratedProject.projectPath, updatedProject);
  }
}

function projectPathMatchesRepo(
  projectPath: string,
  repo: { path?: string; name?: string; display_name?: string },
): boolean {
  if (typeof repo.path === "string" && samePath(projectPath, repo.path)) {
    return true;
  }

  return repo.name === pharoNexusControlProjectName ||
    repo.display_name === pharoNexusControlProjectName;
}

async function resolveControlProjectRepoId(
  homePath: string,
  config: NexusHomeConfig,
  projectPath: string,
): Promise<{
  repoId: string | null;
  repos?: ListVibeKanbanProjectsResult;
  migratedProjectIdFromRepo: boolean;
}> {
  const configuredRepoId = config.controlProject.vibeKanbanRepoId;
  if (configuredRepoId) {
    return {
      repoId: configuredRepoId,
      migratedProjectIdFromRepo: false,
    };
  }

  const repos = await listVibeKanbanProjects({
    port: config.ports.vibeKanban,
  });
  const configuredProjectId = config.controlProject.vibeKanbanProjectId;
  const legacyRepo =
    configuredProjectId
      ? repos.projects.find(
          (repo) =>
            repo.id === configuredProjectId &&
            projectPathMatchesRepo(projectPath, repo),
        )
      : undefined;
  const repo =
    legacyRepo ??
    repos.projects.find((candidate) => projectPathMatchesRepo(projectPath, candidate));
  if (!repo) {
    return {
      repoId: null,
      repos,
      migratedProjectIdFromRepo: false,
    };
  }

  config.controlProject.vibeKanbanRepoId = repo.id;
  if (legacyRepo) {
    config.controlProject.vibeKanbanProjectId = null;
  }
  saveHomeConfig(homePath, config);

  return {
    repoId: repo.id,
    repos,
    migratedProjectIdFromRepo: Boolean(legacyRepo),
  };
}

async function ensureControlProjectLinked(
  homePath: string,
  config: NexusHomeConfig,
): Promise<PharoNexusControlProjectStartResult> {
  migrateLegacyControlProject(homePath, config);
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
        ...controlProject.config.kanban,
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

export async function startPharoNexus(
  options: PharoNexusStartOptions,
): Promise<PharoNexusStartResult> {
  const homePath = resolvePharoNexusHome(options.homePath);
  options.progress?.(`Using PharoNexus home: ${homePath}`);
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
    throw new PharoNexusRuntimeError(
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
      throw new PharoNexusRuntimeError(
        [
          "Failed to sign into Vibe Kanban with managed self-hosted local auth.",
          "If the backend env file changed while Vibe was running, restart PharoNexus so the backend reloads it.",
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
  const pharoNexusMcp = await ensurePharoNexusMcpStarted(
    homePath,
    config,
    options.force,
    options.progress,
  );
  options.progress?.(
    `Waiting for PharoNexus MCP health at http://${pharoNexusMcp.host}:${pharoNexusMcp.port}${defaultPharoNexusMcpHealthPath}...`,
  );
  const pharoNexusMcpHealth = await waitForHttpPort({
    host: pharoNexusMcp.host,
    port: pharoNexusMcp.port,
    path: defaultPharoNexusMcpHealthPath,
    totalTimeoutMs: options.mcpHealthTimeoutMs ?? 30_000,
  });

  if (!pharoNexusMcpHealth.ok) {
    throw new PharoNexusRuntimeError(
      `PharoNexus MCP did not become healthy at ${pharoNexusMcpHealth.url}: ${
        pharoNexusMcpHealth.error ?? "unhealthy response"
      }`,
    );
  }
  options.progress?.("PharoNexus MCP is healthy.");
  options.progress?.("Ensuring PharoNexus control project and Vibe links...");
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
      ? await installPharoNexusAndPlexusMcpForExecutor({
          homePath,
          config,
          executor,
          plexusServerName:
            options.serverName ?? config.integrations.vibeKanban.plexusMcpServerName,
          pharoNexusServerName:
            config.integrations.vibeKanban.pharoNexusMcpServerName,
          port: config.ports.vibeKanban,
        })
      : undefined;
  options.progress?.("PharoNexus start complete.");

  return {
    homePath,
    controlProject,
    services: {
      ...(vibeKanbanBackend.state
        ? { vibeKanbanBackend: vibeKanbanBackend.state }
        : {}),
      pharoNexusMcp,
      plexusGateway,
      vibeKanban,
    },
    health: {
      ...(vibeKanbanBackend.health
        ? { vibeKanbanBackend: vibeKanbanBackend.health }
        : {}),
      pharoNexusMcp: pharoNexusMcpHealth,
      vibeKanban: vibeKanbanHealth,
    },
    auth: {
      vibeKanban: vibeKanbanAuth,
    },
    ...(browser ? { browser } : {}),
    ...(mcpConfig ? { mcpConfig } : {}),
  };
}

export async function getPharoNexusStatus(
  options: PharoNexusStatusOptions,
): Promise<PharoNexusStatusResult> {
  const homePath = resolvePharoNexusHome(options.homePath);
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
  const pharoNexusMcp = await getPharoNexusMcpStatus({
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
      pharoNexusMcp.running &&
      plexusGateway.running &&
      vibeKanban.running,
    stale:
      vibeKanbanBackend.stale ||
      pharoNexusMcp.stale ||
      plexusGateway.stale ||
      vibeKanban.stale,
    services: {
      vibeKanbanBackend,
      pharoNexusMcp,
      plexusGateway,
      vibeKanban,
    },
  };
}

export async function stopPharoNexus(
  options: PharoNexusStopOptions,
): Promise<PharoNexusStopResult> {
  const homePath = resolvePharoNexusHome(options.homePath);
  options.progress?.(`Using PharoNexus home: ${homePath}`);
  const config = loadConfig(homePath, options.config);
  options.progress?.("Stopping Vibe Kanban app...");
  const vibeKanban = await stopVibeKanban({
    homePath,
    force: options.force,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  options.progress?.("Vibe Kanban app stopped.");
  options.progress?.("Stopping PharoNexus MCP...");
  const pharoNexusMcp = await stopPharoNexusMcp({
    homePath,
    force: options.force,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });
  options.progress?.("PharoNexus MCP stopped.");
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
    backendConfig.stopOnPharoNexusStop
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
  options.progress?.("PharoNexus stop complete.");

  return {
    homePath,
    services: {
      vibeKanban,
      pharoNexusMcp,
      plexusGateway,
      vibeKanbanBackend,
    },
  };
}
