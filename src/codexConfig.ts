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
  buildPlexusProjectGatewayConfig,
  defaultPlexusGatewayAgentMcpServerName,
  devNexusPharoProjectExtensionConfig,
  type PlexusProjectConfig,
  type PlexusProjectGatewayConfig,
} from "./devNexusPharoExtension.js";
import {
  ensureSharedPlexusProjectConfig,
  inspectSharedPlexusImageProfiles,
  inspectSharedPlexusProjectConfig,
  loadPlexusProjectConfigIfExists,
} from "./codexSharedPlexusProjectConfig.js";
import { devNexusPharoPluginId } from "./devNexusPharoPlugin.js";
import { defaultDevNexusPharoMcpHealthPath } from "./devNexusPharoMcpProtocol.js";
import {
  hasManagedServerSection,
  mergeCodexMcpServersIntoToml,
  type CodexMcpServerConfig,
} from "./codexConfigToml.js";
import {
  checkHttpMcpServer,
  type HttpMcpServerCheck,
} from "./codexDoctorHttp.js";

export {
  mergeCodexMcpServersIntoToml,
  type CodexMcpServerConfig,
} from "./codexConfigToml.js";

export const codexConfigDirectoryName = ".codex";
export const codexConfigFileName = "config.toml";
export const defaultDevNexusCodexMcpServerName = "dev_nexus";
export const defaultDevNexusPharoCodexMcpServerName = "dev_nexus_pharo";
export const defaultPlexusProjectCodexMcpServerName = "plexus_project";
export const defaultPharoLauncherCodexMcpServerName = "pharo_launcher";
export const legacyGatewayCodexMcpServerName = "gateway";
export const defaultGatewayCodexMcpServerName =
  defaultPlexusGatewayAgentMcpServerName;
export const defaultRouteControlCodexMcpServerName = "route_control";
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
      config.ports.devNexusPharoMcp,
      config.ports.plexusMcp,
    ]);
  const pharoGatewayServerName =
    gateway.agentMcpServerName || defaultGatewayCodexMcpServerName;

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
    [pharoGatewayServerName]: {
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
  const host = config.mcp.host;
  const projectConfig =
    workspaceProjectConfig(options.workspacePath) ??
    workspaceProjectConfig(options.projectRoot);
  if (projectUsesSharedDevNexusMcp(projectConfig)) {
    return buildSharedDevNexusPharoMcpServers(config, options, projectConfig);
  }

  const pharoServer = buildPharoMcpServer(config, options, projectConfig);

  return {
    [defaultDevNexusPharoCodexMcpServerName]: {
      type: "http",
      enabled: true,
      required: true,
      url: `http://${host}:${config.ports.devNexusPharoMcp}/mcp`,
      defaultToolsApprovalMode: "approve",
    },
    ["plexus"]: {
      type: "http",
      enabled: true,
      url: `http://${host}:${config.ports.plexusMcp}/mcp`,
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
          "plexus",
          defaultPharoCodexMcpServerName,
          legacyGatewayCodexMcpServerName,
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
    checks.push(inspectSharedPlexusImageProfiles(workspacePath, projectConfig));

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

  const httpChecks: HttpMcpServerCheck[] = [
    {
      name: defaultDevNexusPharoCodexMcpServerName,
      url: servers[defaultDevNexusPharoCodexMcpServerName]?.url ?? "",
      healthPath: defaultDevNexusPharoMcpHealthPath,
      expectedTools: [
        "pharo_project_create",
        "pharo_project_import",
        "pharo_project_status",
      ],
    },
    {
      name: "plexus",
      url: servers.plexus?.url ?? "",
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
