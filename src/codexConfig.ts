import fs from "node:fs";
import path from "node:path";
import {
  loadProjectConfigIfExists,
  loadHomeConfig,
  resolveNexusHome,
  type NexusHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  buildPlexusProjectConfig,
  buildPlexusProjectGatewayConfig,
  normalizePlexusProjectConfig,
  projectPlexusConfigPath,
  plexusProjectConfigFileName,
  type PlexusProjectConfig,
  type PlexusProjectGatewayConfig,
} from "./devNexusPharoExtension.js";
import { devNexusPharoPluginId } from "./devNexusPharoPlugin.js";
import { defaultDevNexusPharoMcpHealthPath } from "./mcpServer.js";

export const codexConfigDirectoryName = ".codex";
export const codexConfigFileName = "config.toml";
export const defaultDevNexusCodexMcpServerName = "dev_nexus";
export const defaultDevNexusPharoCodexMcpServerName = "dev_nexus_pharo";
export const defaultPlexusProjectCodexMcpServerName = "plexus_project";
export const defaultPharoLauncherCodexMcpServerName = "pharo_launcher";
export const defaultGatewayCodexMcpServerName = "gateway";
export const defaultRouteControlCodexMcpServerName = "route_control";
export const defaultVibeKanbanCodexMcpServerName = "vibe_kanban";
export const defaultPharoCodexMcpServerName = "pharo";

const devNexusPharoExtensionConfigKey = "dev-nexus-pharo";

export interface PharoMcpToolContract {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export const defaultPharoMcpToolContract: readonly PharoMcpToolContract[] = [
  {
    name: "pharo_eval",
    description: "Evaluate Smalltalk code in a routed Pharo image.",
    inputSchema: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "Smalltalk code to evaluate.",
        },
      },
      required: ["code"],
      additionalProperties: false,
    },
  },
];

export type CodexDoctorCheckStatus = "ok" | "failed" | "skipped";

export interface CodexMcpServerConfig {
  type?: string;
  enabled?: boolean;
  required?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  defaultToolsApprovalMode?: string;
}

export interface InitCodexWorkspaceOptions {
  workspacePath: string;
  homePath: string;
  config?: NexusHomeConfig;
  dryRun?: boolean;
  platform?: NodeJS.Platform;
  projectRoot?: string;
  projectId?: string;
  workspaceId?: string;
  targetId?: string;
  includePharo?: boolean;
}

export interface InitCodexWorkspaceResult {
  workspacePath: string;
  configPath: string;
  plexusProjectConfigPath?: string;
  plexusProjectConfigCreated?: boolean;
  servers: Record<string, CodexMcpServerConfig>;
  updated: boolean;
  content: string;
}

export interface DoctorCodexWorkspaceOptions {
  workspacePath: string;
  homePath: string;
  config?: NexusHomeConfig;
  fetch?: typeof fetch;
  timeoutMs?: number;
  platform?: NodeJS.Platform;
}

export interface CodexDoctorCheck {
  name: string;
  status: CodexDoctorCheckStatus;
  message: string;
}

export interface DoctorCodexWorkspaceResult {
  workspacePath: string;
  configPath: string;
  ok: boolean;
  checks: CodexDoctorCheck[];
}

interface HttpMcpServerCheck {
  name: string;
  url: string;
  healthPath: string;
  expectedTools: string[];
}

export interface BuildCodexMcpServersOptions {
  platform?: NodeJS.Platform;
  workspacePath?: string;
  projectRoot?: string;
  projectId?: string;
  workspaceId?: string;
  targetId?: string;
  pharoTools?: readonly PharoMcpToolContract[];
  includePharo?: boolean;
  plexusProjectConfig?: PlexusProjectConfig;
}

export function codexConfigPath(workspacePath: string): string {
  return path.join(path.resolve(workspacePath), codexConfigDirectoryName, codexConfigFileName);
}

function tomlString(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function renderServerBlock(name: string, server: CodexMcpServerConfig): string {
  const lines = [`[mcp_servers.${name}]`];
  if (server.type) {
    lines.push(`type = ${tomlString(server.type)}`);
  }
  if (server.enabled !== undefined) {
    lines.push(`enabled = ${server.enabled ? "true" : "false"}`);
  }
  if (server.required !== undefined) {
    lines.push(`required = ${server.required ? "true" : "false"}`);
  }
  if (server.url) {
    lines.push(`url = ${tomlString(server.url)}`);
  }
  if (server.command) {
    lines.push(`command = ${tomlString(server.command)}`);
  }
  if (server.args) {
    lines.push(`args = ${tomlStringArray(server.args)}`);
  }
  if (server.defaultToolsApprovalMode) {
    lines.push(
      `default_tools_approval_mode = ${tomlString(server.defaultToolsApprovalMode)}`,
    );
  }
  if (server.env && Object.keys(server.env).length > 0) {
    lines.push("", `[mcp_servers.${name}.env]`);
    for (const [key, value] of Object.entries(server.env)) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function isManagedMcpHeader(line: string, managedServerNames: Set<string>): boolean {
  const match = line.match(/^\s*\[(?<name>[^\]]+)\]\s*(?:#.*)?$/u);
  const tableName = match?.groups?.name;
  if (!tableName) {
    return false;
  }

  for (const serverName of managedServerNames) {
    if (
      tableName === `mcp_servers.${serverName}` ||
      tableName.startsWith(`mcp_servers.${serverName}.`)
    ) {
      return true;
    }
  }

  return false;
}

function isTomlHeader(line: string): boolean {
  return /^\s*\[[^\]]+\]\s*(?:#.*)?$/u.test(line);
}

export function mergeCodexMcpServersIntoToml(
  existingToml: string,
  servers: Record<string, CodexMcpServerConfig>,
  extraManagedServerNames: string[] = [],
): string {
  const managedServerNames = new Set([
    ...Object.keys(servers),
    ...extraManagedServerNames,
  ]);
  const keptLines: string[] = [];
  let skippingManagedBlock = false;

  for (const line of existingToml.split(/\r?\n/u)) {
    if (isManagedMcpHeader(line, managedServerNames)) {
      skippingManagedBlock = true;
      continue;
    }

    if (isTomlHeader(line)) {
      skippingManagedBlock = false;
    }

    if (!skippingManagedBlock) {
      keptLines.push(line);
    }
  }

  const preserved = keptLines.join("\n").trimEnd();
  const renderedServers = Object.entries(servers)
    .map(([name, server]) => renderServerBlock(name, server).trimEnd())
    .join("\n\n");

  return `${preserved ? `${preserved}\n\n` : ""}${renderedServers}\n`;
}

function withVibeKanbanMcpMode(args: string[]): string[] {
  return args.includes("--mcp") ? [...args] : [...args, "--mcp"];
}

function withPlexusGatewayStdio(args: string[]): string[] {
  return args.includes("--stdio") ? [...args] : [...args, "--stdio"];
}

function commandLooksPathQualified(command: string): boolean {
  return path.isAbsolute(command) || command.includes("/") || command.includes("\\");
}

function projectLocalRuntimeBinCommand(
  workspacePath: string | undefined,
  command: string,
  platform: NodeJS.Platform | undefined,
): string {
  if (!workspacePath || commandLooksPathQualified(command)) {
    return command;
  }

  const binDirectory = path.join(
    path.resolve(workspacePath),
    ".dev-nexus",
    "runtime",
    "npm-tools",
    "node_modules",
    ".bin",
  );
  const candidates =
    platform === "win32"
      ? [`${command}.cmd`, `${command}.exe`, command]
      : [command];
  for (const candidate of candidates) {
    const candidatePath = path.join(binDirectory, candidate);
    if (fs.existsSync(candidatePath)) {
      return candidatePath;
    }
  }

  return command;
}

function plexusCoreCommandFromConfiguredPlexusCommand(command: string): string {
  const parsed = path.parse(command);
  const executable = parsed.name.toLowerCase();
  if (executable !== "plexus-gateway") {
    return command;
  }

  return path.join(parsed.dir, `plexus${parsed.ext}`);
}

function sanitizeRuntimeId(value: string): string {
  const sanitized = value.trim().replace(/[^A-Za-z0-9._-]+/gu, "-");
  return sanitized.replace(/^-+|-+$/gu, "") || "default";
}

function defaultTargetId(projectId: string, workspaceId: string): string {
  return `${projectId}--${workspaceId}`;
}

function projectUsesDevNexusPharo(projectConfig: NexusProjectConfig | undefined): boolean {
  return Boolean(
    projectConfig?.extensions?.[devNexusPharoExtensionConfigKey] ||
      projectConfig?.plugins?.some(
        (plugin) =>
          plugin.id === devNexusPharoPluginId && plugin.enabled !== false,
      ),
  );
}

function projectUsesSharedDevNexusMcp(
  projectConfig: NexusProjectConfig | undefined,
): projectConfig is NexusProjectConfig {
  return Boolean(projectUsesDevNexusPharo(projectConfig));
}

function sharedPlexusProjectConfigPath(
  workspacePath: string,
  projectConfig?: NexusProjectConfig,
): string {
  return projectConfig
    ? projectPlexusConfigPath(path.resolve(workspacePath), projectConfig)
    : path.join(path.resolve(workspacePath), plexusProjectConfigFileName);
}

function ensureSharedPlexusProjectConfig(
  workspacePath: string,
  projectConfig: NexusProjectConfig,
  homeConfig: NexusHomeConfig,
  dryRun: boolean | undefined,
): { configPath: string; created: boolean; config: PlexusProjectConfig } {
  const configPath = sharedPlexusProjectConfigPath(workspacePath, projectConfig);
  const created = !fs.existsSync(configPath);
  const reservedGatewayPorts = reservedPlexusGatewayPorts(
    homeConfig,
    workspacePath,
  );
  const existing = created
    ? (buildPlexusProjectConfig(
        projectConfig.name,
        projectConfig.id,
        projectConfig.kanban?.projectId ?? null,
        undefined,
        reservedGatewayPorts,
      ) as unknown as Record<string, unknown>)
    : JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "")) as Record<string, unknown>;
  const normalized = normalizePlexusProjectConfig(
    existing,
    projectConfig.name,
    projectConfig.id,
    projectConfig.kanban?.projectId ?? null,
    undefined,
    reservedGatewayPorts,
  );
  const nextContent = `${JSON.stringify(normalized, null, 2)}\n`;
  const existingContent = created
    ? ""
    : fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "");
  if (!dryRun) {
    if (created || existingContent !== nextContent) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, nextContent, "utf8");
    }
  }

  return { configPath, created, config: normalized };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inspectSharedPlexusProjectConfig(
  workspacePath: string,
  projectConfig?: NexusProjectConfig,
): CodexDoctorCheck {
  const configPath = sharedPlexusProjectConfigPath(workspacePath, projectConfig);
  if (!fs.existsSync(configPath)) {
    return {
      name: "plexus_project:config",
      status: "failed",
      message: `Missing ${plexusProjectConfigFileName}. Run "dev-nexus-pharo codex init ${workspacePath}" to materialize scoped PLexus project config.`,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    const kanban = isRecord(parsed) ? parsed.kanban : undefined;
    const valid =
      isRecord(parsed) &&
      typeof parsed.name === "string" &&
      isRecord(kanban) &&
      kanban.provider === "vibe-kanban" &&
      typeof kanban.projectId === "string" &&
      Array.isArray(parsed.images);
    return {
      name: "plexus_project:config",
      status: valid ? "ok" : "failed",
      message: valid
        ? `Found ${plexusProjectConfigFileName}`
        : `${plexusProjectConfigFileName} is missing required name, kanban, or images fields.`,
    };
  } catch (error) {
    return {
      name: "plexus_project:config",
      status: "failed",
      message: `Could not read ${plexusProjectConfigFileName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function sameResolvedPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function gatewayPortFromPlexusProjectConfig(filePath: string): number | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "")) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.runtime) || !isRecord(parsed.runtime.gateway)) {
      return undefined;
    }
    const port = parsed.runtime.gateway.port;
    return typeof port === "number" && Number.isInteger(port) ? port : undefined;
  } catch {
    return undefined;
  }
}

function reservedPlexusGatewayPorts(
  homeConfig: NexusHomeConfig,
  currentProjectRoot: string,
): number[] {
  const ports = new Set([
    homeConfig.ports.vibeKanban,
    homeConfig.ports.devNexusPharoMcp,
    homeConfig.ports.plexusMcp,
  ]);
  for (const project of homeConfig.projects) {
    if (sameResolvedPath(project.projectRoot, currentProjectRoot)) {
      continue;
    }
    const projectConfig = loadProjectConfigIfExists(project.projectRoot);
    const configPath = sharedPlexusProjectConfigPath(
      project.projectRoot,
      projectConfig,
    );
    const port = gatewayPortFromPlexusProjectConfig(configPath);
    if (port !== undefined) {
      ports.add(port);
    }
  }

  return [...ports];
}

function loadPlexusProjectConfigIfExists(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): PlexusProjectConfig | undefined {
  const configPath = sharedPlexusProjectConfigPath(projectRoot, projectConfig);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "")) as Record<string, unknown>;
  return normalizePlexusProjectConfig(
    parsed,
    projectConfig.name,
    projectConfig.id,
    projectConfig.kanban?.projectId ?? null,
  );
}

function workspaceProjectConfig(
  workspacePath: string | undefined,
): NexusProjectConfig | undefined {
  if (!workspacePath) {
    return undefined;
  }

  return loadProjectConfigIfExists(path.resolve(workspacePath)) as
    | NexusProjectConfig
    | undefined;
}

function shouldIncludePharoMcp(
  options: BuildCodexMcpServersOptions,
  projectConfig: NexusProjectConfig | undefined,
): boolean {
  if (options.includePharo !== undefined) {
    return options.includePharo;
  }

  return projectUsesDevNexusPharo(projectConfig);
}

function buildPharoMcpServer(
  config: NexusHomeConfig,
  options: BuildCodexMcpServersOptions,
  projectConfig: NexusProjectConfig | undefined,
): CodexMcpServerConfig | undefined {
  if (!shouldIncludePharoMcp(options, projectConfig)) {
    return undefined;
  }

  const projectRoot = path.resolve(
    options.projectRoot ?? options.workspacePath ?? ".",
  );
  const workspaceRoot = path.resolve(options.workspacePath ?? projectRoot);
  const projectId = options.projectId ?? projectConfig?.id;
  if (!projectId) {
    return undefined;
  }

  const workspaceId = sanitizeRuntimeId(
    options.workspaceId ?? path.basename(workspaceRoot),
  );
  const targetId = options.targetId ?? defaultTargetId(projectId, workspaceId);

  return {
    enabled: true,
    command: config.tools.plexus.command,
    args: withPlexusGatewayStdio(config.tools.plexus.args),
    env: {
      PLEXUS_GATEWAY_SURFACE: "pharo",
      PLEXUS_PROJECT_ROOT: projectRoot,
      PLEXUS_PROJECT_ID: projectId,
      PLEXUS_WORKSPACE_ID: workspaceId,
      PLEXUS_WORKSPACE_ROOT: workspaceRoot,
      VIBE_KANBAN_WORKSPACE_ID: workspaceId,
      PLEXUS_TARGET_ID: targetId,
      PLEXUS_STATE_ROOT: config.paths.plexusStateRoot,
      PLEXUS_PHARO_TOOLS_JSON: JSON.stringify(
        options.pharoTools ?? defaultPharoMcpToolContract,
      ),
    },
    defaultToolsApprovalMode: "approve",
  };
}

function codexProjectMcpTarget(
  projectConfig: NexusProjectConfig,
): NonNullable<NonNullable<NexusProjectConfig["mcp"]>["agentTargets"]>[number] | undefined {
  return projectConfig.mcp?.agentTargets?.find(
    (target) => target.agent === "codex" && target.enabled !== false,
  );
}

function buildSharedDevNexusMcpServer(
  projectConfig: NexusProjectConfig,
  platform: NodeJS.Platform,
): CodexMcpServerConfig {
  const target = codexProjectMcpTarget(projectConfig);
  const mcpConfig = projectConfig.mcp;
  const command = target?.command ?? mcpConfig?.command ?? "dev-nexus";

  return {
    enabled: true,
    command: windowsDevNexusCommand(command, platform),
    args: [
      ...(target?.args ?? mcpConfig?.args ?? ["mcp-stdio"]),
    ],
    defaultToolsApprovalMode:
      target?.defaultToolsApprovalMode ??
      mcpConfig?.defaultToolsApprovalMode ??
      "approve",
  };
}

function windowsDevNexusCommand(
  command: string,
  platform: NodeJS.Platform,
): string {
  if (
    platform === "win32" &&
    command === "dev-nexus" &&
    !command.includes("/") &&
    !command.includes("\\") &&
    path.extname(command) === ""
  ) {
    return "dev-nexus.cmd";
  }
  return command;
}

function plexusSharedEnvironment(
  config: NexusHomeConfig,
  options: BuildCodexMcpServersOptions,
  projectConfig: NexusProjectConfig,
): Record<string, string> {
  const projectRoot = path.resolve(
    options.projectRoot ?? options.workspacePath ?? ".",
  );
  const workspaceRoot = path.resolve(options.workspacePath ?? projectRoot);
  const workspaceId = sanitizeRuntimeId(
    options.workspaceId ?? path.basename(workspaceRoot),
  );
  const targetId =
    options.targetId ?? defaultTargetId(projectConfig.id, workspaceId);

  return {
    PLEXUS_PROJECT_ROOT: projectRoot,
    PLEXUS_PROJECT_ID: projectConfig.id,
    PLEXUS_WORKSPACE_ID: workspaceId,
    PLEXUS_WORKSPACE_ROOT: workspaceRoot,
    VIBE_KANBAN_WORKSPACE_ID: workspaceId,
    PLEXUS_TARGET_ID: targetId,
    PLEXUS_STATE_ROOT: config.paths.plexusStateRoot,
  };
}

function buildSharedDevNexusPharoMcpServers(
  config: NexusHomeConfig,
  options: BuildCodexMcpServersOptions,
  projectConfig: NexusProjectConfig,
): Record<string, CodexMcpServerConfig> {
  const projectRoot = path.resolve(
    options.projectRoot ?? options.workspacePath ?? ".",
  );
  const plexusEnv = plexusSharedEnvironment(config, options, projectConfig);
  const platform = options.platform ?? process.platform;
  const devNexusPharoCommand = projectLocalRuntimeBinCommand(
    options.workspacePath,
    "dev-nexus-pharo",
    platform,
  );
  const plexusCoreCommand = projectLocalRuntimeBinCommand(
    options.workspacePath,
    plexusCoreCommandFromConfiguredPlexusCommand(config.tools.plexus.command),
    platform,
  );
  const gateway =
    options.plexusProjectConfig?.runtime.gateway ??
    loadPlexusProjectConfigIfExists(projectRoot, projectConfig)?.runtime.gateway ??
    buildPlexusProjectGatewayConfig(projectConfig.id, [
      config.ports.vibeKanban,
      config.ports.devNexusPharoMcp,
      config.ports.plexusMcp,
    ]);

  return {
    [
      codexProjectMcpTarget(projectConfig)?.serverName ??
      projectConfig.mcp?.serverName ??
      defaultDevNexusCodexMcpServerName
    ]: buildSharedDevNexusMcpServer(projectConfig, platform),
    [defaultDevNexusPharoCodexMcpServerName]: {
      enabled: true,
      command: devNexusPharoCommand,
      args: ["mcp-stdio"],
      defaultToolsApprovalMode: "approve",
    },
    [defaultPlexusProjectCodexMcpServerName]: {
      enabled: true,
      command: plexusCoreCommand,
      args: ["mcp", "project"],
      env: plexusEnv,
      defaultToolsApprovalMode: "approve",
    },
    [defaultPharoLauncherCodexMcpServerName]: {
      enabled: true,
      command: plexusCoreCommand,
      args: ["mcp", "pharo-launcher", "--project-path", projectRoot],
      env: plexusEnv,
      defaultToolsApprovalMode: "approve",
    },
    [defaultRouteControlCodexMcpServerName]: {
      type: "http",
      enabled: true,
      url: gatewayUrl(gateway, gateway.routeControlMcpPath),
      defaultToolsApprovalMode: "approve",
    },
    [defaultGatewayCodexMcpServerName]: {
      type: "http",
      enabled: true,
      url: gatewayUrl(gateway, gateway.agentMcpPath),
      defaultToolsApprovalMode: "approve",
    },
  };
}

function gatewayUrl(gateway: PlexusProjectGatewayConfig, gatewayPath: string): string {
  return `http://${gateway.host}:${gateway.port}${gatewayPath}`;
}

export function buildCodexMcpServers(
  homePath: string,
  config: NexusHomeConfig,
  platformOrOptions: NodeJS.Platform | BuildCodexMcpServersOptions = process.platform,
): Record<string, CodexMcpServerConfig> {
  const options: BuildCodexMcpServersOptions =
    typeof platformOrOptions === "string"
      ? { platform: platformOrOptions }
      : platformOrOptions;
  const platform = options.platform ?? process.platform;
  const host = config.mcp.host;
  const nexusServerName = config.integrations.vibeKanban.nexusMcpServerName;
  const plexusServerName = config.integrations.vibeKanban.plexusMcpServerName;
  const vibeKanbanArgs = withVibeKanbanMcpMode(config.tools.vibeKanban.args);
  const projectConfig =
    workspaceProjectConfig(options.workspacePath) ??
    workspaceProjectConfig(options.projectRoot);
  if (projectUsesSharedDevNexusMcp(projectConfig)) {
    return buildSharedDevNexusPharoMcpServers(config, options, projectConfig);
  }

  const pharoServer = buildPharoMcpServer(config, options, projectConfig);

  return {
    [nexusServerName]: {
      type: "http",
      enabled: true,
      required: true,
      url: `http://${host}:${config.ports.devNexusPharoMcp}/mcp`,
      defaultToolsApprovalMode: "approve",
    },
    [plexusServerName]: {
      type: "http",
      enabled: true,
      url: `http://${host}:${config.ports.plexusMcp}/mcp`,
      defaultToolsApprovalMode: "approve",
    },
    [defaultVibeKanbanCodexMcpServerName]: {
      enabled: true,
      command:
        platform === "win32" ? "cmd" : config.tools.vibeKanban.command,
      args:
        platform === "win32"
          ? ["/c", config.tools.vibeKanban.command, ...vibeKanbanArgs]
          : vibeKanbanArgs,
      defaultToolsApprovalMode: "approve",
    },
    ...(pharoServer ? { [defaultPharoCodexMcpServerName]: pharoServer } : {}),
  };
}

export function initCodexWorkspace(
  options: InitCodexWorkspaceOptions,
): InitCodexWorkspaceResult {
  const workspacePath = path.resolve(options.workspacePath);
  const homePath = resolveNexusHome(options.homePath);
  const config = options.config ?? loadHomeConfig(homePath);
  const configPath = codexConfigPath(workspacePath);
  const projectConfig =
    workspaceProjectConfig(workspacePath) ??
    workspaceProjectConfig(options.projectRoot);
  const plexusProjectRoot = options.projectRoot ?? workspacePath;
  const plexusProjectConfig = projectUsesSharedDevNexusMcp(projectConfig)
    ? ensureSharedPlexusProjectConfig(
        plexusProjectRoot,
        projectConfig,
        config,
        options.dryRun,
      )
    : undefined;
  const existingToml = fs.existsSync(configPath)
    ? fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "")
    : "";
  const servers = buildCodexMcpServers(homePath, config, {
    platform: options.platform,
    workspacePath,
    projectRoot: options.projectRoot,
    projectId: options.projectId,
    workspaceId: options.workspaceId,
    targetId: options.targetId,
    includePharo: options.includePharo,
    plexusProjectConfig: plexusProjectConfig?.config,
  });
  const content = mergeCodexMcpServersIntoToml(
    existingToml,
    servers,
    projectUsesSharedDevNexusMcp(projectConfig)
      ? [
          config.integrations.vibeKanban.plexusMcpServerName,
          defaultVibeKanbanCodexMcpServerName,
          defaultPharoCodexMcpServerName,
        ]
      : [],
  );

  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, content, "utf8");
  }

  return {
    workspacePath,
    configPath,
    ...(plexusProjectConfig
      ? {
          plexusProjectConfigPath: plexusProjectConfig.configPath,
          plexusProjectConfigCreated: plexusProjectConfig.created,
        }
      : {}),
    servers,
    updated: existingToml !== content,
    content,
  };
}

function hasManagedServerSection(toml: string, serverName: string): boolean {
  return toml.split(/\r?\n/u).some((line) => {
    const match = line.match(/^\s*\[(?<name>[^\]]+)\]\s*(?:#.*)?$/u);
    return match?.groups?.name === `mcp_servers.${serverName}`;
  });
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonRpc(
  fetchImpl: typeof fetch,
  url: string,
  method: string,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(method === "initialize"
          ? {
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                  name: "dev-nexus-pharo-codex-doctor",
                  version: "0.1.0",
                },
              },
            }
          : {}),
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function jsonRpcResultRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP response is not an object");
  }

  const record = value as Record<string, unknown>;
  if (record.error) {
    throw new Error("MCP response contains an error");
  }
  if (!record.result || typeof record.result !== "object" || Array.isArray(record.result)) {
    throw new Error("MCP response result is not an object");
  }

  return record.result as Record<string, unknown>;
}

function listedToolNames(value: unknown): string[] {
  const result = jsonRpcResultRecord(value);
  const tools = result.tools;
  if (!Array.isArray(tools)) {
    throw new Error("tools/list response is missing tools");
  }

  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      return [];
    }

    const name = (tool as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
}

async function checkHttpMcpServer(
  options: HttpMcpServerCheck & {
    fetch: typeof fetch;
    timeoutMs: number;
  },
): Promise<CodexDoctorCheck[]> {
  const checks: CodexDoctorCheck[] = [];
  const healthUrl = new URL(options.healthPath, options.url).toString();

  try {
    const health = await fetchWithTimeout(options.fetch, healthUrl, {}, options.timeoutMs);
    if (!health.ok) {
      checks.push({
        name: `${options.name}:health`,
        status: "failed",
        message: `Health check failed with HTTP ${health.status}`,
      });
      return checks;
    }

    checks.push({
      name: `${options.name}:health`,
      status: "ok",
      message: `Health check passed at ${healthUrl}`,
    });
  } catch (error) {
    checks.push({
      name: `${options.name}:health`,
      status: "failed",
      message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }

  try {
    jsonRpcResultRecord(
      await postJsonRpc(options.fetch, options.url, "initialize", options.timeoutMs),
    );
    checks.push({
      name: `${options.name}:initialize`,
      status: "ok",
      message: "MCP initialize succeeded",
    });
  } catch (error) {
    checks.push({
      name: `${options.name}:initialize`,
      status: "failed",
      message: `MCP initialize failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }

  try {
    const toolNames = listedToolNames(
      await postJsonRpc(options.fetch, options.url, "tools/list", options.timeoutMs),
    );
    const missingTools = options.expectedTools.filter((tool) => !toolNames.includes(tool));
    checks.push({
      name: `${options.name}:tools`,
      status: missingTools.length === 0 ? "ok" : "failed",
      message:
        missingTools.length === 0
          ? `Found expected tools: ${options.expectedTools.join(", ")}`
          : `Missing expected tools: ${missingTools.join(", ")}`,
    });
  } catch (error) {
    checks.push({
      name: `${options.name}:tools`,
      status: "failed",
      message: `MCP tools/list failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return checks;
}

export async function doctorCodexWorkspace(
  options: DoctorCodexWorkspaceOptions,
): Promise<DoctorCodexWorkspaceResult> {
  const workspacePath = path.resolve(options.workspacePath);
  const homePath = resolveNexusHome(options.homePath);
  const config = options.config ?? loadHomeConfig(homePath);
  const configPath = codexConfigPath(workspacePath);
  const checks: CodexDoctorCheck[] = [];
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_000;

  if (!fs.existsSync(configPath)) {
    checks.push({
      name: "config",
      status: "failed",
      message: `Codex config is missing at ${configPath}. Run "dev-nexus-pharo codex init ${workspacePath}" first.`,
    });
    return {
      workspacePath,
      configPath,
      ok: false,
      checks,
    };
  }

  const toml = fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "");
  const projectConfig = workspaceProjectConfig(workspacePath);
  const servers = buildCodexMcpServers(homePath, config, {
    platform: options.platform,
    workspacePath,
  });
  for (const serverName of Object.keys(servers)) {
    checks.push({
      name: `config:${serverName}`,
      status: hasManagedServerSection(toml, serverName) ? "ok" : "failed",
      message: hasManagedServerSection(toml, serverName)
        ? `Found [mcp_servers.${serverName}]`
        : `Missing [mcp_servers.${serverName}]`,
    });
  }

  if (projectUsesSharedDevNexusMcp(projectConfig)) {
    checks.push(inspectSharedPlexusProjectConfig(workspacePath, projectConfig));

    for (const [serverName, server] of Object.entries(servers)) {
      checks.push({
        name: `${serverName}:${server.url ? "http" : "command"}`,
        status: "skipped",
        message: server.url
          ? "Shared DevNexus-Pharo live gateway reachability is runtime-profile dependent; doctor verifies the generated config entry only."
          : "Shared DevNexus-Pharo MCP server is command-based; doctor verifies the generated config entry but does not spawn it.",
      });
    }

    return {
      workspacePath,
      configPath,
      ok: checks.every((check) => check.status !== "failed"),
      checks,
    };
  }

  const hasPharoServerSection = hasManagedServerSection(
    toml,
    defaultPharoCodexMcpServerName,
  );
  if (!servers[defaultPharoCodexMcpServerName] && hasPharoServerSection) {
    checks.push({
      name: `config:${defaultPharoCodexMcpServerName}`,
      status: "ok",
      message: `Found [mcp_servers.${defaultPharoCodexMcpServerName}]`,
    });
  }

  const nexusServerName = config.integrations.vibeKanban.nexusMcpServerName;
  const plexusServerName = config.integrations.vibeKanban.plexusMcpServerName;
  const httpChecks: HttpMcpServerCheck[] = [
    {
      name: nexusServerName,
      url: servers[nexusServerName]?.url ?? "",
      healthPath: defaultDevNexusPharoMcpHealthPath,
      expectedTools: [
        "project_create",
        "project_import",
        "project_status",
      ],
    },
    {
      name: plexusServerName,
      url: servers[plexusServerName]?.url ?? "",
      healthPath: "/health",
      expectedTools: ["plexus_project_open", "plexus_project_status"],
    },
  ];

  for (const check of httpChecks) {
    checks.push(
      ...(await checkHttpMcpServer({
        ...check,
        fetch: fetchImpl,
        timeoutMs,
      })),
    );
  }

  checks.push({
    name: `${defaultVibeKanbanCodexMcpServerName}:command`,
    status: "skipped",
    message: "Vibe Kanban MCP is command-based; doctor verifies the generated config entry but does not spawn it.",
  });

  if (servers[defaultPharoCodexMcpServerName] || hasPharoServerSection) {
    checks.push({
      name: `${defaultPharoCodexMcpServerName}:command`,
      status: "skipped",
      message: "Pharo MCP is a PLexus gateway command facade; doctor verifies the generated config entry but does not spawn it or open live images.",
    });
  }

  return {
    workspacePath,
    configPath,
    ok: checks.every((check) => check.status !== "failed"),
    checks,
  };
}
