import fs from "node:fs";
import path from "node:path";
import {
  loadProjectConfigIfExists,
  type NexusHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  buildPlexusProjectGatewayConfig,
  defaultPlexusGatewayAgentMcpServerName,
  type PlexusProjectConfig,
  type PlexusProjectGatewayConfig,
} from "./devNexusPharoExtension.js";
import {
  loadPlexusProjectConfigIfExists,
} from "./codexSharedPlexusProjectConfig.js";
import { devNexusPharoPluginId } from "./devNexusPharoPlugin.js";
import type {
  CodexMcpServerConfig,
} from "./codexConfigToml.js";

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

export function projectUsesSharedDevNexusMcp(
  projectConfig: NexusProjectConfig | undefined,
): projectConfig is NexusProjectConfig {
  return Boolean(projectUsesDevNexusPharo(projectConfig));
}

export function workspaceProjectConfig(
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
