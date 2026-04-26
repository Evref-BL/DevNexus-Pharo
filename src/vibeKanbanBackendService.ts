import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  loadHomeConfig,
  pharoNexusLogsDirectoryName,
  resolvePharoNexusHome,
  type PharoNexusHomeConfig,
  type VibeKanbanBackendConfig,
  type VibeKanbanDindBackendConfig,
  type VibeKanbanDockerBackendConfig,
} from "./config.js";
import { type HttpPortHealthCheckResult } from "./processSupervisor.js";

export const vibeKanbanBackendServiceName = "vibe-kanban-backend";
export const vibeKanbanBackendStateDirectoryName = "state";
export const vibeKanbanBackendServicesStateDirectoryName = "services";
export const vibeKanbanBackendStateFileName = "vibe-kanban-backend.json";
const dindSshAgentSocketPath = "/tmp/pharo-nexus-ssh-agent.sock";
const vibeKanbanBackendStartTimeoutMs = 15 * 60 * 1_000;

export type VibeKanbanBackendRuntimeStatus =
  | "running"
  | "stopped"
  | "failed"
  | "external";

export interface VibeKanbanBackendCommandResult {
  command: string;
  args: string[];
  cwd?: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  error?: string;
}

export type VibeKanbanBackendProgressReporter = (message: string) => void;

export interface VibeKanbanBackendServiceState {
  service: typeof vibeKanbanBackendServiceName;
  mode: VibeKanbanBackendConfig["mode"];
  status: VibeKanbanBackendRuntimeStatus;
  sharedApiBase: string;
  healthPath: string;
  command?: string;
  args?: string[];
  workingDirectory?: string;
  startedAt?: string;
  updatedAt: string;
  bootstrap?: VibeKanbanBackendBootstrapResult;
  lastCommand?: VibeKanbanBackendCommandResult;
}

export interface VibeKanbanBackendBootstrapResult {
  sourceRoot: string;
  cloned: boolean;
  generatedEnvFile: boolean;
  cloneCommand?: VibeKanbanBackendCommandResult;
}

export interface VibeKanbanBackendCommandRunnerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export type VibeKanbanBackendCommandRunner = (
  command: string,
  args: readonly string[],
  options?: VibeKanbanBackendCommandRunnerOptions,
) => VibeKanbanBackendCommandResult;

export interface VibeKanbanBackendStartOptions {
  homePath: string;
  config?: PharoNexusHomeConfig;
  force?: boolean;
  commandRunner?: VibeKanbanBackendCommandRunner;
  progress?: VibeKanbanBackendProgressReporter;
  fetch?: typeof fetch;
  healthTimeoutMs?: number;
  healthIntervalMs?: number;
}

export interface VibeKanbanBackendStopOptions {
  homePath: string;
  config?: PharoNexusHomeConfig;
  commandRunner?: VibeKanbanBackendCommandRunner;
  timeoutMs?: number;
}

export interface VibeKanbanBackendStatusOptions {
  homePath: string;
  config?: PharoNexusHomeConfig;
  checkHealth?: boolean;
  fetch?: typeof fetch;
  healthTimeoutMs?: number;
}

export interface VibeKanbanBackendStatusResult {
  state?: VibeKanbanBackendServiceState;
  running: boolean;
  stale: boolean;
  health?: HttpPortHealthCheckResult;
}

export interface VibeKanbanBackendStopResult {
  state?: VibeKanbanBackendServiceState;
  command?: VibeKanbanBackendCommandResult;
}

export class VibeKanbanBackendServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeKanbanBackendServiceError";
  }
}

interface ResolvedComposeCommand {
  command: string;
  argsPrefix: string[];
}

function now(): string {
  return new Date().toISOString();
}

function loadConfig(
  homePath: string,
  config: PharoNexusHomeConfig | undefined,
): PharoNexusHomeConfig {
  return config ?? loadHomeConfig(homePath);
}

export function vibeKanbanBackendStateDirectoryPath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    vibeKanbanBackendStateDirectoryName,
    vibeKanbanBackendServicesStateDirectoryName,
  );
}

export function vibeKanbanBackendStatePath(homePath: string): string {
  return path.join(
    vibeKanbanBackendStateDirectoryPath(homePath),
    vibeKanbanBackendStateFileName,
  );
}

export function vibeKanbanBackendLogDirectoryPath(homePath: string): string {
  return path.join(
    resolvePharoNexusHome(homePath),
    pharoNexusLogsDirectoryName,
    vibeKanbanBackendServiceName,
  );
}

function validateState(value: unknown): VibeKanbanBackendServiceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VibeKanbanBackendServiceError(
      "Vibe Kanban backend state must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  if (record.service !== vibeKanbanBackendServiceName) {
    throw new VibeKanbanBackendServiceError(
      `Vibe Kanban backend state service must be ${vibeKanbanBackendServiceName}`,
    );
  }

  if (
    record.mode !== "docker" &&
    record.mode !== "dind" &&
    record.mode !== "external"
  ) {
    throw new VibeKanbanBackendServiceError(
      "Vibe Kanban backend state mode must be docker, dind, or external",
    );
  }

  if (
    record.status !== "running" &&
    record.status !== "stopped" &&
    record.status !== "failed" &&
    record.status !== "external"
  ) {
    throw new VibeKanbanBackendServiceError(
      "Vibe Kanban backend state status must be running, stopped, failed, or external",
    );
  }

  for (const key of ["sharedApiBase", "healthPath", "updatedAt"]) {
    if (typeof record[key] !== "string" || record[key].length === 0) {
      throw new VibeKanbanBackendServiceError(
        `Vibe Kanban backend state ${key} must be a non-empty string`,
      );
    }
  }

  return record as unknown as VibeKanbanBackendServiceState;
}

export function loadVibeKanbanBackendState(
  homePath: string,
): VibeKanbanBackendServiceState | undefined {
  const filePath = vibeKanbanBackendStatePath(homePath);
  if (!fs.existsSync(filePath)) {
    return undefined;
  }

  return validateState(
    JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "")),
  );
}

export function saveVibeKanbanBackendState(
  homePath: string,
  state: VibeKanbanBackendServiceState,
): string {
  const filePath = vibeKanbanBackendStatePath(homePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    `${JSON.stringify(validateState(state), null, 2)}\n`,
    "utf8",
  );
  return filePath;
}

function writeCommandLogs(
  homePath: string,
  result: VibeKanbanBackendCommandResult,
): void {
  const logDirectory = vibeKanbanBackendLogDirectoryPath(homePath);
  fs.mkdirSync(logDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(logDirectory, "vibe-kanban-backend.stdout.log"),
    result.stdout,
    "utf8",
  );
  fs.writeFileSync(
    path.join(logDirectory, "vibe-kanban-backend.stderr.log"),
    result.stderr,
    "utf8",
  );
  fs.appendFileSync(
    path.join(logDirectory, "vibe-kanban-backend.lifecycle.log"),
    `${JSON.stringify({ timestamp: now(), event: "command", result })}\n`,
    "utf8",
  );
}

export function defaultVibeKanbanBackendCommandRunner(
  command: string,
  args: readonly string[],
  options: VibeKanbanBackendCommandRunnerOptions = {},
): VibeKanbanBackendCommandResult {
  const startedAt = Date.now();
  const result = spawnSync(command, [...args], {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env,
    shell: false,
    timeout: options.timeoutMs,
    windowsHide: true,
  });

  return {
    command,
    args: [...args],
    ...(options.cwd ? { cwd: options.cwd } : {}),
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
    durationMs: Date.now() - startedAt,
    ...(result.error ? { error: result.error.message } : {}),
  };
}

function isSuccessfulCommand(result: VibeKanbanBackendCommandResult): boolean {
  return !result.error && result.exitCode === 0;
}

function composeBuildEnvironment(): NodeJS.ProcessEnv {
  return {
    DOCKER_BUILDKIT: "1",
    COMPOSE_DOCKER_CLI_BUILD: "1",
  };
}

function assertBuildxAvailable(
  runner: VibeKanbanBackendCommandRunner,
): void {
  const dockerPlugin = runner("docker", ["buildx", "version"], {
    env: composeBuildEnvironment(),
    timeoutMs: 5_000,
  });
  if (isSuccessfulCommand(dockerPlugin)) {
    return;
  }

  const buildxBinary = runner("docker-buildx", ["version"], {
    env: composeBuildEnvironment(),
    timeoutMs: 5_000,
  });
  if (isSuccessfulCommand(buildxBinary)) {
    return;
  }

  throw new VibeKanbanBackendServiceError(
    [
      "Docker Buildx is required to build the Vibe Kanban backend image.",
      "Install or enable the Docker buildx plugin, then retry `pharo-nexus start`.",
      `docker buildx: ${dockerPlugin.error ?? dockerPlugin.stderr.trim() ?? dockerPlugin.exitCode}`,
      `docker-buildx: ${buildxBinary.error ?? buildxBinary.stderr.trim() ?? buildxBinary.exitCode}`,
    ].join(" "),
  );
}

function dockerComposeCommandNeedsComposeArg(command: string): boolean {
  const executable = path.basename(command).toLowerCase();
  return executable === "docker" || executable === "docker.exe";
}

function resolveComposeCommand(
  config: VibeKanbanDockerBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
): ResolvedComposeCommand {
  if (config.composeCommand !== "auto") {
    return {
      command: config.composeCommand,
      argsPrefix: [
        ...(dockerComposeCommandNeedsComposeArg(config.composeCommand)
          ? ["compose"]
          : []),
        ...config.composeArgs,
      ],
    };
  }

  const dockerProbe = runner("docker", ["compose", "version"], {
    timeoutMs: 5_000,
  });
  if (isSuccessfulCommand(dockerProbe)) {
    return {
      command: "docker",
      argsPrefix: ["compose", ...config.composeArgs],
    };
  }

  const dockerComposeProbe = runner("docker-compose", ["--version"], {
    timeoutMs: 5_000,
  });
  if (isSuccessfulCommand(dockerComposeProbe)) {
    return {
      command: "docker-compose",
      argsPrefix: [...config.composeArgs],
    };
  }

  throw new VibeKanbanBackendServiceError(
    [
      "Cannot find a usable Docker Compose command.",
      "Tried `docker compose version` and `docker-compose --version`.",
      "Install Docker Compose, start your Docker engine, or set",
      "integrations.vibeKanban.backend.composeCommand in pharo-nexus.home.json.",
      `docker compose: ${dockerProbe.error ?? dockerProbe.stderr.trim() ?? dockerProbe.exitCode}`,
      `docker-compose: ${dockerComposeProbe.error ?? dockerComposeProbe.stderr.trim() ?? dockerComposeProbe.exitCode}`,
    ].join(" "),
  );
}

function sourceRootFromDockerBackend(
  config: VibeKanbanDockerBackendConfig,
): string {
  return path.resolve(config.workingDirectory, "..", "..");
}

function randomSecret(byteLength = 48): string {
  return randomBytes(byteLength).toString("base64");
}

function firstEnvValue(
  env: NodeJS.ProcessEnv,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

function gitConfigValue(key: string): string | undefined {
  const result = spawnSync("git", ["config", "--global", "--get", key], {
    encoding: "utf8",
    shell: false,
    timeout: 5_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }

  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}

function localAuthEmail(env: NodeJS.ProcessEnv = process.env): string {
  return (
    firstEnvValue(env, [
      "PHARO_NEXUS_VIBE_LOCAL_AUTH_EMAIL",
      "PHARO_NEXUS_GIT_USER_EMAIL",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_EMAIL",
    ]) ??
    gitConfigValue("user.email") ??
    "admin@pharo-nexus.local"
  );
}

function githubOAuthCredentials(env: NodeJS.ProcessEnv = process.env):
  | {
      clientId: string;
      clientSecret: string;
    }
  | undefined {
  const clientId = firstEnvValue(env, [
    "PHARO_NEXUS_GITHUB_OAUTH_CLIENT_ID",
    "GITHUB_OAUTH_CLIENT_ID",
  ]);
  const clientSecret = firstEnvValue(env, [
    "PHARO_NEXUS_GITHUB_OAUTH_CLIENT_SECRET",
    "GITHUB_OAUTH_CLIENT_SECRET",
  ]);

  if (!clientId || !clientSecret) {
    return undefined;
  }

  return { clientId, clientSecret };
}

function localBackendPort(
  config: Pick<VibeKanbanBackendConfig, "sharedApiBase">,
): string {
  try {
    const parsed = new URL(config.sharedApiBase);
    return parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  } catch {
    return "3100";
  }
}

function localBackendHost(
  config: Pick<VibeKanbanBackendConfig, "sharedApiBase">,
): string {
  try {
    return new URL(config.sharedApiBase).hostname || "127.0.0.1";
  } catch {
    return "127.0.0.1";
  }
}

function defaultEnvRemoteContent(
  config: Pick<VibeKanbanBackendConfig, "sharedApiBase">,
  options: { bindHost?: string } = {},
): string {
  const port = localBackendPort(config);
  const host = options.bindHost ?? localBackendHost(config);
  const localAuthPassword = randomSecret(24);
  const githubOAuth = githubOAuthCredentials();

  return [
    "# Generated by PharoNexus. Do not commit this file.",
    `VIBEKANBAN_REMOTE_JWT_SECRET=${randomSecret(48)}`,
    `ELECTRIC_ROLE_PASSWORD=${randomSecret(32)}`,
    `DB_PASSWORD=${randomSecret(32)}`,
    `PUBLIC_BASE_URL=${config.sharedApiBase}`,
    `REMOTE_SERVER_PORTS=${host}:${port}:8081`,
    "VITE_RELAY_API_BASE_URL=http://127.0.0.1:8082",
    `GITHUB_OAUTH_CLIENT_ID=${githubOAuth?.clientId ?? ""}`,
    `GITHUB_OAUTH_CLIENT_SECRET=${githubOAuth?.clientSecret ?? ""}`,
    "GOOGLE_OAUTH_CLIENT_ID=",
    "GOOGLE_OAUTH_CLIENT_SECRET=",
    `SELF_HOST_LOCAL_AUTH_EMAIL=${localAuthEmail()}`,
    `SELF_HOST_LOCAL_AUTH_PASSWORD=${localAuthPassword}`,
    "LOOPS_EMAIL_API_KEY=",
    "LOOPS_INVITE_TEMPLATE_ID=cmhvy2wgs3s13z70i1pxakij9",
    "LOOPS_REVIEW_READY_TEMPLATE_ID=cmj47k5ge16990iylued9by17",
    "LOOPS_REVIEW_FAILED_TEMPLATE_ID=cmj49ougk1c8s0iznavijdqpo",
    "AZURE_STORAGE_ACCOUNT_NAME=",
    "AZURE_STORAGE_ACCOUNT_KEY=",
    "AZURE_STORAGE_CONTAINER_NAME=issue-attachments",
    "AZURE_STORAGE_ENDPOINT_URL=",
    "AZURE_STORAGE_PUBLIC_ENDPOINT_URL=",
    "",
  ].join("\n");
}

function readEnvValue(content: string, key: string): string | undefined {
  const prefix = `${key}=`;
  const line = content
    .split(/\r?\n/u)
    .find((entry) => entry.startsWith(prefix));

  return line?.slice(prefix.length);
}

function setEnvValue(
  content: string,
  key: string,
  value: string,
): { content: string; changed: boolean } {
  const lines = content.split(/\r?\n/u);
  const prefix = `${key}=`;
  let changed = false;
  let found = false;

  const updatedLines = lines.map((line) => {
    if (!line.startsWith(prefix)) {
      return line;
    }

    found = true;
    const nextLine = `${prefix}${value}`;
    if (line !== nextLine) {
      changed = true;
    }

    return nextLine;
  });

  if (!found) {
    const insertAt =
      updatedLines.at(-1) === "" ? updatedLines.length - 1 : updatedLines.length;
    updatedLines.splice(insertAt, 0, `${prefix}${value}`);
    changed = true;
  }

  return {
    content: updatedLines.join("\n"),
    changed,
  };
}

function syncAuthDefaultsIntoEnvFile(envFile: string): boolean {
  if (!fs.existsSync(envFile)) {
    return false;
  }

  let content = fs.readFileSync(envFile, "utf8").replace(/^\uFEFF/u, "");
  let changed = false;
  const githubOAuth = githubOAuthCredentials();

  if (
    githubOAuth &&
    !readEnvValue(content, "GITHUB_OAUTH_CLIENT_ID") &&
    !readEnvValue(content, "GITHUB_OAUTH_CLIENT_SECRET")
  ) {
    let update = setEnvValue(
      content,
      "GITHUB_OAUTH_CLIENT_ID",
      githubOAuth.clientId,
    );
    content = update.content;
    changed ||= update.changed;
    update = setEnvValue(
      content,
      "GITHUB_OAUTH_CLIENT_SECRET",
      githubOAuth.clientSecret,
    );
    content = update.content;
    changed ||= update.changed;
  }

  if (
    readEnvValue(content, "SELF_HOST_LOCAL_AUTH_EMAIL") ===
    "admin@pharo-nexus.local"
  ) {
    const email = localAuthEmail();
    if (email !== "admin@pharo-nexus.local") {
      const update = setEnvValue(content, "SELF_HOST_LOCAL_AUTH_EMAIL", email);
      content = update.content;
      changed ||= update.changed;
    }
  }

  if (changed) {
    fs.writeFileSync(envFile, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  }

  return changed;
}

type VibeKanbanManagedSourceBackendConfig =
  | VibeKanbanDockerBackendConfig
  | VibeKanbanDindBackendConfig;

function sourceRootFromManagedBackend(
  config: VibeKanbanManagedSourceBackendConfig,
): string {
  return config.mode === "dind"
    ? config.sourceRoot
    : sourceRootFromDockerBackend(config);
}

function bootstrapManagedSourceBackend(
  homePath: string,
  config: VibeKanbanManagedSourceBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
  progress?: VibeKanbanBackendProgressReporter,
): VibeKanbanBackendBootstrapResult {
  const sourceRoot = sourceRootFromManagedBackend(config);
  let cloned = false;
  let generatedEnvFile = false;
  let cloneCommand: VibeKanbanBackendCommandResult | undefined;

  if (!fs.existsSync(config.workingDirectory)) {
    if (!config.autoBootstrap) {
      return { sourceRoot, cloned, generatedEnvFile };
    }

    if (fs.existsSync(sourceRoot)) {
      throw new VibeKanbanBackendServiceError(
        [
          "Cannot bootstrap Vibe Kanban backend because the source directory exists",
          `but does not contain the expected remote stack: ${config.workingDirectory}.`,
          "Fix the directory or update integrations.vibeKanban.backend in pharo-nexus.home.json.",
        ].join(" "),
      );
    }

    fs.mkdirSync(path.dirname(sourceRoot), { recursive: true });
    progress?.(
      `Cloning Vibe Kanban from ${config.sourceRepositoryUrl} into ${sourceRoot}...`,
    );
    cloneCommand = runner(
      "git",
      ["clone", "--depth", "1", config.sourceRepositoryUrl, sourceRoot],
      {
        timeoutMs: 120_000,
      },
    );
    writeCommandLogs(homePath, cloneCommand);
    if (!isSuccessfulCommand(cloneCommand)) {
      throw new VibeKanbanBackendServiceError(
        [
          "Failed to clone Vibe Kanban for the Docker backend.",
          `${cloneCommand.command} ${cloneCommand.args.join(" ")}`,
          cloneCommand.error ??
            cloneCommand.stderr.trim() ??
            cloneCommand.stdout.trim(),
        ].join(" "),
      );
    }

    cloned = true;
    progress?.("Vibe Kanban repository cloned.");
  }

  if (!fs.existsSync(config.envFile)) {
    progress?.(`Generating Vibe Kanban backend env file at ${config.envFile}...`);
    fs.mkdirSync(path.dirname(config.envFile), { recursive: true });
    fs.writeFileSync(
      config.envFile,
      defaultEnvRemoteContent(config, {
        bindHost: config.mode === "dind" ? "0.0.0.0" : undefined,
      }),
      "utf8",
    );
    generatedEnvFile = true;
    progress?.("Vibe Kanban backend env file generated.");
  } else if (syncAuthDefaultsIntoEnvFile(config.envFile)) {
    progress?.("Vibe Kanban backend auth env file updated.");
  }

  return {
    sourceRoot,
    cloned,
    generatedEnvFile,
    ...(cloneCommand ? { cloneCommand } : {}),
  };
}

function assertManagedSourceBackendPaths(
  config: VibeKanbanManagedSourceBackendConfig,
): void {
  const missing: string[] = [];
  if (!fs.existsSync(config.workingDirectory)) {
    missing.push(`workingDirectory=${config.workingDirectory}`);
  }

  if (!fs.existsSync(config.composeFile)) {
    missing.push(`composeFile=${config.composeFile}`);
  }

  if (!fs.existsSync(config.envFile)) {
    missing.push(`envFile=${config.envFile}`);
  }

  if (missing.length > 0) {
    throw new VibeKanbanBackendServiceError(
      [
        "Vibe Kanban Docker backend is not configured yet.",
        `Missing: ${missing.join(", ")}.`,
        "Automatic bootstrap did not create the expected files.",
        "Check the previous clone error, or update integrations.vibeKanban.backend in pharo-nexus.home.json.",
      ].join(" "),
    );
  }
}

function composeArgs(
  config: VibeKanbanDockerBackendConfig,
  resolved: ResolvedComposeCommand,
  action: "up" | "down",
): string[] {
  const sharedArgs = [
    ...resolved.argsPrefix,
    "--env-file",
    config.envFile,
    "-f",
    config.composeFile,
    "-p",
    config.projectName,
  ];

  if (action === "up") {
    return [...sharedArgs, "up", "-d", "--build"];
  }

  return [...sharedArgs, "down"];
}

function dindContainerPortPublish(config: VibeKanbanDindBackendConfig): string {
  const host = localBackendHost(config);
  const port = localBackendPort(config);
  return `${host}:${port}:${port}`;
}

function dindComposeEnvironment(
  config: VibeKanbanDindBackendConfig,
): NodeJS.ProcessEnv {
  return {
    DOCKER_BUILDKIT: "1",
    COMPOSE_DOCKER_CLI_BUILD: "1",
    PUBLIC_BASE_URL: config.sharedApiBase,
    REMOTE_SERVER_PORTS: `0.0.0.0:${localBackendPort(config)}:8081`,
    SSH_AUTH_SOCK: dindSshAgentSocketPath,
  };
}

function dockerExecEnvArgs(env: NodeJS.ProcessEnv): string[] {
  const args: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      args.push("-e", `${key}=${value}`);
    }
  }

  return args;
}

function dindComposeArgs(
  config: VibeKanbanDindBackendConfig,
  action: "up" | "down",
): string[] {
  const sharedArgs = [
    "exec",
    "-w",
    config.containerWorkingDirectory,
    ...dockerExecEnvArgs(dindComposeEnvironment(config)),
    config.containerName,
    "docker",
    "compose",
    "--env-file",
    config.containerEnvFile,
    "-f",
    config.containerComposeFile,
    "-p",
    config.projectName,
  ];

  if (action === "up") {
    return [...sharedArgs, "up", "-d", "--build"];
  }

  return [...sharedArgs, "down", "--remove-orphans"];
}

function composeNamedVolume(projectName: string, volumeName: string): string {
  return `${projectName}_${volumeName}`;
}

function isMissingDockerVolume(result: VibeKanbanBackendCommandResult): boolean {
  const output = `${result.stdout}\n${result.stderr}\n${result.error ?? ""}`;
  return /no such volume/i.test(output);
}

function clearDindElectricDataVolume(
  config: VibeKanbanDindBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
  progress?: VibeKanbanBackendProgressReporter,
): VibeKanbanBackendCommandResult {
  const volumeName = composeNamedVolume(config.projectName, "electric-data");
  progress?.(
    `Clearing Vibe Kanban Electric derived sync cache volume ${volumeName}...`,
  );
  const result = runner(
    config.dockerCommand,
    ["exec", config.containerName, "docker", "volume", "rm", volumeName],
    { cwd: config.workingDirectory, timeoutMs: 30_000 },
  );

  if (!isSuccessfulCommand(result) && !isMissingDockerVolume(result)) {
    throw new VibeKanbanBackendServiceError(
      [
        "Failed to clear the Vibe Kanban Electric derived sync cache.",
        `${result.command} ${result.args.join(" ")}`,
        result.error ?? result.stderr.trim() ?? result.stdout.trim(),
      ].join(" "),
    );
  }

  return result;
}

function inspectDindContainer(
  config: VibeKanbanDindBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
): "running" | "stopped" | "missing" {
  const result = runner(
    config.dockerCommand,
    ["inspect", "--format", "{{.State.Running}}", config.containerName],
    { timeoutMs: 10_000 },
  );
  if (!isSuccessfulCommand(result)) {
    return "missing";
  }

  return result.stdout.trim() === "true" ? "running" : "stopped";
}

function startDindContainer(
  config: VibeKanbanDindBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
  progress?: VibeKanbanBackendProgressReporter,
): VibeKanbanBackendCommandResult | undefined {
  const containerState = inspectDindContainer(config, runner);
  if (containerState === "running") {
    progress?.(`Vibe Kanban DinD container ${config.containerName} is already running.`);
    return undefined;
  }

  if (containerState === "stopped") {
    progress?.(`Starting existing Vibe Kanban DinD container ${config.containerName}...`);
    const result = runner(config.dockerCommand, ["start", config.containerName], {
      timeoutMs: 30_000,
    });
    if (!isSuccessfulCommand(result)) {
      throw new VibeKanbanBackendServiceError(
        [
          "Failed to start the Vibe Kanban DinD container.",
          `${result.command} ${result.args.join(" ")}`,
          result.error ?? result.stderr.trim() ?? result.stdout.trim(),
        ].join(" "),
      );
    }

    return result;
  }

  progress?.(`Creating Vibe Kanban DinD container ${config.containerName}...`);
  const result = runner(
    config.dockerCommand,
    [
      "run",
      "-d",
      "--privileged",
      "--name",
      config.containerName,
      "-e",
      "DOCKER_TLS_CERTDIR=",
      "-p",
      dindContainerPortPublish(config),
      "-v",
      `${config.sourceRoot}:${config.containerSourceRoot}`,
      "-v",
      `${config.dataVolume}:/var/lib/docker`,
      config.dindImage,
    ],
    { timeoutMs: 60_000 },
  );
  if (!isSuccessfulCommand(result)) {
    throw new VibeKanbanBackendServiceError(
      [
        "Failed to create the Vibe Kanban DinD container.",
        `${result.command} ${result.args.join(" ")}`,
        result.error ?? result.stderr.trim() ?? result.stdout.trim(),
      ].join(" "),
    );
  }

  return result;
}

async function waitForDindDocker(
  config: VibeKanbanDindBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
  progress?: VibeKanbanBackendProgressReporter,
  timeoutMs = 60_000,
): Promise<VibeKanbanBackendCommandResult> {
  const startedAt = Date.now();
  let lastResult: VibeKanbanBackendCommandResult | undefined;
  progress?.("Waiting for Docker daemon inside the DinD container...");

  while (Date.now() - startedAt <= timeoutMs) {
    lastResult = runner(
      config.dockerCommand,
      ["exec", config.containerName, "docker", "info"],
      { timeoutMs: 5_000 },
    );
    if (isSuccessfulCommand(lastResult)) {
      return lastResult;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new VibeKanbanBackendServiceError(
    [
      "Docker daemon inside the Vibe Kanban DinD container did not become ready.",
      lastResult
        ? (lastResult.error ?? lastResult.stderr.trim() ?? lastResult.stdout.trim())
        : "No docker info result was captured.",
    ].join(" "),
  );
}

function ensureDindComposeAvailable(
  config: VibeKanbanDindBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
): VibeKanbanBackendCommandResult {
  const probe = runner(
    config.dockerCommand,
    ["exec", config.containerName, "docker", "compose", "version"],
    { timeoutMs: 10_000 },
  );
  if (isSuccessfulCommand(probe)) {
    return probe;
  }

  const install = runner(
    config.dockerCommand,
    ["exec", config.containerName, "apk", "add", "--no-cache", "docker-cli-compose"],
    { timeoutMs: 120_000 },
  );
  if (!isSuccessfulCommand(install)) {
    throw new VibeKanbanBackendServiceError(
      [
        "Docker Compose is not available inside the Vibe Kanban DinD container,",
        "and automatic installation failed.",
        `docker compose: ${probe.error ?? probe.stderr.trim() ?? probe.exitCode}`,
        `apk add docker-cli-compose: ${
          install.error ?? install.stderr.trim() ?? install.exitCode
        }`,
      ].join(" "),
    );
  }

  const afterInstall = runner(
    config.dockerCommand,
    ["exec", config.containerName, "docker", "compose", "version"],
    { timeoutMs: 10_000 },
  );
  if (!isSuccessfulCommand(afterInstall)) {
    throw new VibeKanbanBackendServiceError(
      [
        "Docker Compose installation inside the Vibe Kanban DinD container did not produce",
        "a usable `docker compose` command.",
        afterInstall.error ?? afterInstall.stderr.trim() ?? afterInstall.exitCode,
      ].join(" "),
    );
  }

  return afterInstall;
}

function ensureDindSshAgent(
  config: VibeKanbanDindBackendConfig,
  runner: VibeKanbanBackendCommandRunner,
): VibeKanbanBackendCommandResult {
  runner(
    config.dockerCommand,
    ["exec", config.containerName, "rm", "-f", dindSshAgentSocketPath],
    { timeoutMs: 10_000 },
  );
  let agent = runner(
    config.dockerCommand,
    ["exec", config.containerName, "ssh-agent", "-a", dindSshAgentSocketPath],
    { timeoutMs: 10_000 },
  );
  if (isSuccessfulCommand(agent)) {
    return agent;
  }

  const install = runner(
    config.dockerCommand,
    ["exec", config.containerName, "apk", "add", "--no-cache", "openssh-client"],
    { timeoutMs: 120_000 },
  );
  if (!isSuccessfulCommand(install)) {
    throw new VibeKanbanBackendServiceError(
      [
        "Vibe's Docker build requests an SSH agent, but openssh-client could not",
        "be installed inside the Vibe Kanban DinD container.",
        install.error ?? install.stderr.trim() ?? install.exitCode,
      ].join(" "),
    );
  }

  runner(
    config.dockerCommand,
    ["exec", config.containerName, "rm", "-f", dindSshAgentSocketPath],
    { timeoutMs: 10_000 },
  );
  agent = runner(
    config.dockerCommand,
    ["exec", config.containerName, "ssh-agent", "-a", dindSshAgentSocketPath],
    { timeoutMs: 10_000 },
  );
  if (!isSuccessfulCommand(agent)) {
    throw new VibeKanbanBackendServiceError(
      [
        "Failed to start an SSH agent inside the Vibe Kanban DinD container.",
        agent.error ?? agent.stderr.trim() ?? agent.stdout.trim(),
      ].join(" "),
    );
  }

  return agent;
}

function stateFromConfig(
  config: VibeKanbanBackendConfig,
  status: VibeKanbanBackendRuntimeStatus,
  commandResult?: VibeKanbanBackendCommandResult,
  bootstrap?: VibeKanbanBackendBootstrapResult,
): VibeKanbanBackendServiceState {
  return {
    service: vibeKanbanBackendServiceName,
    mode: config.mode,
    status,
    sharedApiBase: config.sharedApiBase,
    healthPath: config.healthPath,
    ...(config.mode === "docker" || config.mode === "dind"
      ? { workingDirectory: config.workingDirectory }
      : {}),
    ...(commandResult
      ? {
          command: commandResult.command,
          args: commandResult.args,
          lastCommand: commandResult,
        }
      : {}),
    ...(status === "running" ? { startedAt: now() } : {}),
    ...(bootstrap ? { bootstrap } : {}),
    updatedAt: now(),
  };
}

function healthUrl(config: Pick<VibeKanbanBackendConfig, "sharedApiBase" | "healthPath">): string {
  const base = config.sharedApiBase.endsWith("/")
    ? config.sharedApiBase
    : `${config.sharedApiBase}/`;
  const pathName = config.healthPath.startsWith("/")
    ? config.healthPath.slice(1)
    : config.healthPath;

  return new URL(pathName, base).toString();
}

export async function checkHttpUrl(
  url: string,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    healthyStatusMin?: number;
    healthyStatusMax?: number;
  } = {},
): Promise<HttpPortHealthCheckResult> {
  const startedAt = Date.now();
  const healthyStatusMin = options.healthyStatusMin ?? 200;
  const healthyStatusMax = options.healthyStatusMax ?? 399;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 1_000);
  timeout.unref?.();

  try {
    const response = await (options.fetch ?? fetch)(url, {
      signal: controller.signal,
    });
    return {
      ok:
        response.status >= healthyStatusMin &&
        response.status <= healthyStatusMax,
      url,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      ok: false,
      url,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHttpUrl(
  url: string,
  options: {
    fetch?: typeof fetch;
    timeoutMs?: number;
    intervalMs?: number;
    totalTimeoutMs?: number;
  } = {},
): Promise<HttpPortHealthCheckResult> {
  const startedAt = Date.now();
  const totalTimeoutMs = options.totalTimeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 250;
  let lastResult: HttpPortHealthCheckResult | undefined;

  while (Date.now() - startedAt <= totalTimeoutMs) {
    lastResult = await checkHttpUrl(url, {
      fetch: options.fetch,
      timeoutMs: options.timeoutMs,
    });
    if (lastResult.ok) {
      return lastResult;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return {
    ok: false,
    url,
    durationMs: Date.now() - startedAt,
    statusCode: lastResult?.statusCode,
    error: lastResult?.error ?? "Timed out waiting for HTTP URL",
  };
}

export async function startVibeKanbanBackend(
  options: VibeKanbanBackendStartOptions,
): Promise<VibeKanbanBackendServiceState> {
  const homePath = resolvePharoNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const backend = config.integrations.vibeKanban.backend;

  if (backend.mode === "external") {
    options.progress?.(
      `Using external Vibe Kanban backend at ${backend.sharedApiBase}.`,
    );
    const state = stateFromConfig(backend, "external");
    saveVibeKanbanBackendState(homePath, state);
    return state;
  }

  const existingState = loadVibeKanbanBackendState(homePath);
  if (existingState?.status === "running" && !options.force) {
    options.progress?.("Vibe Kanban Docker backend is already marked running.");
    return existingState;
  }

  const runner = options.commandRunner ?? defaultVibeKanbanBackendCommandRunner;
  options.progress?.("Checking Vibe Kanban Docker backend files...");
  const bootstrap = bootstrapManagedSourceBackend(
    homePath,
    backend,
    runner,
    options.progress,
  );
  assertManagedSourceBackendPaths(backend);

  let result: VibeKanbanBackendCommandResult;
  if (backend.mode === "docker") {
    options.progress?.("Resolving Docker Compose command...");
    const resolved = resolveComposeCommand(backend, runner);
    options.progress?.("Checking Docker BuildKit/buildx availability...");
    assertBuildxAvailable(runner);
    const args = composeArgs(backend, resolved, "up");
    options.progress?.(
      `Starting Vibe Kanban Docker backend with ${resolved.command}...`,
    );
    result = runner(resolved.command, args, {
      cwd: backend.workingDirectory,
      env: composeBuildEnvironment(),
      timeoutMs: vibeKanbanBackendStartTimeoutMs,
    });
  } else {
    const dindStart = startDindContainer(backend, runner, options.progress);
    if (dindStart) {
      writeCommandLogs(homePath, dindStart);
    }
    await waitForDindDocker(backend, runner, options.progress);
    options.progress?.("Checking Docker Compose inside the DinD container...");
    ensureDindComposeAvailable(backend, runner);
    options.progress?.("Preparing SSH agent inside the DinD container for BuildKit...");
    ensureDindSshAgent(backend, runner);
    options.progress?.("Cleaning any previous Vibe Kanban DinD Compose state...");
    const cleanup = runner(backend.dockerCommand, dindComposeArgs(backend, "down"), {
      cwd: backend.workingDirectory,
      timeoutMs: 120_000,
    });
    writeCommandLogs(homePath, cleanup);
    const clearElectric = clearDindElectricDataVolume(
      backend,
      runner,
      options.progress,
    );
    writeCommandLogs(homePath, clearElectric);
    const args = dindComposeArgs(backend, "up");
    options.progress?.("Starting Vibe Kanban backend inside the DinD container...");
    result = runner(backend.dockerCommand, args, {
      cwd: backend.workingDirectory,
      timeoutMs: vibeKanbanBackendStartTimeoutMs,
    });
  }
  writeCommandLogs(homePath, result);

  if (!isSuccessfulCommand(result)) {
    const state = stateFromConfig(backend, "failed", result, bootstrap);
    saveVibeKanbanBackendState(homePath, state);
    throw new VibeKanbanBackendServiceError(
      [
        `Failed to start Vibe Kanban ${backend.mode} backend.`,
        `${result.command} ${result.args.join(" ")}`,
        result.error ?? result.stderr.trim() ?? result.stdout.trim(),
      ].join(" "),
    );
  }

  const state = stateFromConfig(backend, "running", result, bootstrap);
  saveVibeKanbanBackendState(homePath, state);
  const backendHealthUrl = healthUrl(backend);
  options.progress?.(
    `Waiting for Vibe Kanban backend health at ${backendHealthUrl}...`,
  );
  const health = await waitForHttpUrl(backendHealthUrl, {
    fetch: options.fetch,
    totalTimeoutMs: options.healthTimeoutMs ?? 30_000,
    intervalMs: options.healthIntervalMs ?? 250,
  });

  if (!health.ok) {
    const failedState = {
      ...state,
      status: "failed" as const,
      updatedAt: now(),
    };
    saveVibeKanbanBackendState(homePath, failedState);
    throw new VibeKanbanBackendServiceError(
      `Vibe Kanban Docker backend started but did not become healthy at ${health.url}: ${
        health.error ?? "unhealthy response"
      }`,
    );
  }

  options.progress?.("Vibe Kanban backend is healthy.");
  return state;
}

export async function getVibeKanbanBackendStatus(
  options: VibeKanbanBackendStatusOptions,
): Promise<VibeKanbanBackendStatusResult> {
  const homePath = resolvePharoNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const backend = config.integrations.vibeKanban.backend;
  const storedState = loadVibeKanbanBackendState(homePath);
  const state =
    storedState ??
    (backend.mode === "external"
      ? stateFromConfig(backend, "external")
      : undefined);
  const health =
    options.checkHealth
      ? await checkHttpUrl(healthUrl(backend), {
          fetch: options.fetch,
          timeoutMs: options.healthTimeoutMs ?? 1_000,
        })
      : undefined;
  const running =
    backend.mode === "external"
      ? health
        ? health.ok
        : true
      : state?.status === "running" && (!health || health.ok);

  return {
    ...(state ? { state } : {}),
    running,
    stale: backend.mode !== "external" && state?.status === "running" && health?.ok === false,
    ...(health ? { health } : {}),
  };
}

export async function stopVibeKanbanBackend(
  options: VibeKanbanBackendStopOptions,
): Promise<VibeKanbanBackendStopResult> {
  const homePath = resolvePharoNexusHome(options.homePath);
  const config = loadConfig(homePath, options.config);
  const backend = config.integrations.vibeKanban.backend;

  if (backend.mode === "external") {
    const state = stateFromConfig(backend, "external");
    saveVibeKanbanBackendState(homePath, state);
    return { state };
  }

  const runner = options.commandRunner ?? defaultVibeKanbanBackendCommandRunner;
  let result: VibeKanbanBackendCommandResult;
  if (backend.mode === "docker") {
    const resolved = resolveComposeCommand(backend, runner);
    const args = composeArgs(backend, resolved, "down");
    result = runner(resolved.command, args, {
      cwd: backend.workingDirectory,
      timeoutMs: options.timeoutMs ?? 120_000,
    });
  } else {
    const containerState = inspectDindContainer(backend, runner);
    if (containerState === "missing" || containerState === "stopped") {
      result = {
        command: backend.dockerCommand,
        args: ["inspect", "--format", "{{.State.Running}}", backend.containerName],
        stdout: "",
        stderr: "",
        exitCode: 0,
        durationMs: 0,
      };
    } else {
      if (containerState === "running") {
        const down = runner(backend.dockerCommand, dindComposeArgs(backend, "down"), {
          cwd: backend.workingDirectory,
          timeoutMs: options.timeoutMs ?? 120_000,
        });
        writeCommandLogs(homePath, down);
      }

      result = runner(backend.dockerCommand, ["stop", backend.containerName], {
        timeoutMs: options.timeoutMs ?? 120_000,
      });
    }
  }
  writeCommandLogs(homePath, result);

  const state = stateFromConfig(
    backend,
    isSuccessfulCommand(result) ? "stopped" : "failed",
    result,
  );
  saveVibeKanbanBackendState(homePath, state);

  if (!isSuccessfulCommand(result)) {
    throw new VibeKanbanBackendServiceError(
      [
        `Failed to stop Vibe Kanban ${backend.mode} backend.`,
        `${result.command} ${result.args.join(" ")}`,
        result.error ?? result.stderr.trim() ?? result.stdout.trim(),
      ].join(" "),
    );
  }

  return {
    state,
    command: result,
  };
}
