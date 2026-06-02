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

interface DevNexusWorkerContext {
  projectRoot?: string;
  project?: {
    id?: string;
    name?: string;
    root?: string;
  };
  component?: {
    id?: string;
    sourceRoot?: string;
  };
  worktree?: {
    componentId?: string;
    sourceRoot?: string;
    worktreesRoot?: string;
    worktreePath?: string;
    branchName?: string;
    workItem?: {
      id?: string;
      title?: string;
    };
  };
  ownership?: {
    componentId?: string;
    sourceRoot?: string;
    worktreesRoot?: string;
    worktreePath?: string;
    branchName?: string;
    workItem?: {
      id?: string;
      title?: string;
    };
  };
  dependencySupport?: {
    pluginDependencyProjections?: DevNexusWorkerDependencyProjection[];
  };
}

export interface DevNexusWorkerDependencyProjection {
  id?: string;
  sourceControl?: "support" | "source";
  sourcePath?: string;
  targetPath?: string;
  status?: "linked" | "present" | "skipped";
  sourceComponent?: {
    id?: string;
    sourceRoot?: string;
  };
}

interface ResolvedCodexWorkspaceContext {
  projectRoot: string;
  workspaceRoot: string;
  workspaceSourcePath: string;
  workerContext?: DevNexusWorkerContext;
}

const devNexusWorkerContextJsonRelativePath = path.join(
  ".dev-nexus",
  "context",
  "context.json",
);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function optionalWorkerDependencyProjectionStatus(
  value: unknown,
): DevNexusWorkerDependencyProjection["status"] | undefined {
  return value === "linked" || value === "present" || value === "skipped"
    ? value
    : undefined;
}

function optionalWorkerDependencyProjectionSourceControl(
  value: unknown,
): DevNexusWorkerDependencyProjection["sourceControl"] | undefined {
  return value === "support" || value === "source" ? value : undefined;
}

function workerDependencyProjection(
  value: unknown,
): DevNexusWorkerDependencyProjection | undefined {
  const projection = optionalRecord(value);
  if (!projection) {
    return undefined;
  }

  const sourceComponent = optionalRecord(projection.sourceComponent);
  return {
    id: optionalString(projection.id),
    sourceControl: optionalWorkerDependencyProjectionSourceControl(
      projection.sourceControl,
    ),
    sourcePath: optionalString(projection.sourcePath),
    targetPath: optionalString(projection.targetPath),
    status: optionalWorkerDependencyProjectionStatus(projection.status),
    ...(sourceComponent
      ? {
          sourceComponent: {
            id: optionalString(sourceComponent.id),
            sourceRoot: optionalString(sourceComponent.sourceRoot),
          },
        }
      : {}),
  };
}

function workerDependencyProjections(
  value: unknown,
): DevNexusWorkerDependencyProjection[] | undefined {
  const projections = Array.isArray(value)
    ? value
        .map((projection) => workerDependencyProjection(projection))
        .filter(
          (
            projection,
          ): projection is DevNexusWorkerDependencyProjection =>
            projection !== undefined,
        )
    : undefined;
  return projections && projections.length > 0 ? projections : undefined;
}

function readDevNexusWorkerContext(
  workspacePath: string | undefined,
): DevNexusWorkerContext | undefined {
  if (!workspacePath) {
    return undefined;
  }

  const contextPath = path.join(
    path.resolve(workspacePath),
    devNexusWorkerContextJsonRelativePath,
  );
  if (!fs.existsSync(contextPath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(
      fs.readFileSync(contextPath, "utf8").replace(/^\uFEFF/u, ""),
    ) as unknown;
    if (!isRecord(parsed)) {
      return undefined;
    }
    const project = optionalRecord(parsed.project);
    const component = optionalRecord(parsed.component);
    const worktree = optionalRecord(parsed.worktree);
    const ownership = optionalRecord(parsed.ownership);
    const dependencySupport = optionalRecord(parsed.dependencySupport);
    const worktreeWorkItem = optionalRecord(worktree?.workItem);
    const ownershipWorkItem = optionalRecord(ownership?.workItem);
    const pluginDependencyProjections = workerDependencyProjections(
      dependencySupport?.pluginDependencyProjections,
    );

    const context = {
      projectRoot: optionalString(parsed.projectRoot),
      ...(project
        ? {
            project: {
              id: optionalString(project.id),
              name: optionalString(project.name),
              root: optionalString(project.root),
            },
          }
        : {}),
      ...(component
        ? {
            component: {
              id: optionalString(component.id),
              sourceRoot: optionalString(component.sourceRoot),
            },
          }
        : {}),
      ...(worktree
        ? {
            worktree: {
              componentId: optionalString(worktree.componentId),
              sourceRoot: optionalString(worktree.sourceRoot),
              worktreesRoot: optionalString(worktree.worktreesRoot),
              worktreePath: optionalString(worktree.worktreePath),
              branchName: optionalString(worktree.branchName),
              ...(worktreeWorkItem
                ? {
                    workItem: {
                      id: optionalString(worktreeWorkItem.id),
                      title: optionalString(worktreeWorkItem.title),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(ownership
        ? {
            ownership: {
              componentId: optionalString(ownership.componentId),
              sourceRoot: optionalString(ownership.sourceRoot),
              worktreesRoot: optionalString(ownership.worktreesRoot),
              worktreePath: optionalString(ownership.worktreePath),
              branchName: optionalString(ownership.branchName),
              ...(ownershipWorkItem
                ? {
                    workItem: {
                      id: optionalString(ownershipWorkItem.id),
                      title: optionalString(ownershipWorkItem.title),
                    },
                  }
                : {}),
            },
          }
        : {}),
      ...(pluginDependencyProjections
        ? {
            dependencySupport: {
              pluginDependencyProjections,
            },
          }
        : {}),
    };
    if (!context.worktree?.worktreePath && !context.ownership?.worktreePath) {
      return undefined;
    }

    return context;
  } catch {
    return undefined;
  }
}

export function resolveCodexWorkspaceContext(
  options: Pick<BuildCodexMcpServersOptions, "workspacePath" | "projectRoot">,
): ResolvedCodexWorkspaceContext {
  const workerContext = readDevNexusWorkerContext(options.workspacePath);
  const projectRoot = path.resolve(
    options.projectRoot ??
      workerContext?.projectRoot ??
      workerContext?.project?.root ??
      options.workspacePath ??
      ".",
  );
  const contextWorktreePath =
    workerContext?.worktree?.worktreePath ??
    workerContext?.ownership?.worktreePath;
  const workspaceRoot = path.resolve(
    contextWorktreePath ?? options.workspacePath ?? projectRoot,
  );
  const workspaceSourcePath = path.resolve(contextWorktreePath ?? workspaceRoot);

  return {
    projectRoot,
    workspaceRoot,
    workspaceSourcePath,
    ...(workerContext ? { workerContext } : {}),
  };
}

function devNexusWorktreeWorkspaceId(
  context: DevNexusWorkerContext | undefined,
): string | undefined {
  const worktree = context?.worktree ?? context?.ownership;
  const componentId = worktree?.componentId ?? context?.component?.id;
  const workItemId = worktree?.workItem?.id;
  if (componentId && workItemId) {
    return sanitizeRuntimeId(`${componentId}--${workItemId}`);
  }
  if (componentId && worktree?.branchName) {
    return sanitizeRuntimeId(`${componentId}--${worktree.branchName}`);
  }

  return undefined;
}

function workspaceIdForContext(
  options: Pick<BuildCodexMcpServersOptions, "workspaceId">,
  context: ResolvedCodexWorkspaceContext,
): string {
  return sanitizeRuntimeId(
    options.workspaceId ??
      devNexusWorktreeWorkspaceId(context.workerContext) ??
      path.basename(context.workspaceRoot),
  );
}

function workspaceSourcePathEnv(
  context: ResolvedCodexWorkspaceContext,
): Record<string, string> {
  return {
    PLEXUS_WORKSPACE_SOURCE_PATH: context.workspaceSourcePath,
  };
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

  const resolvedWorkspacePath = path.resolve(workspacePath);
  return (
    loadProjectConfigIfExists(resolvedWorkspacePath) ??
    loadProjectConfigIfExists(
      resolveCodexWorkspaceContext({ workspacePath }).projectRoot,
    )
  ) as NexusProjectConfig | undefined;
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

  const context = resolveCodexWorkspaceContext(options);
  const projectRoot = context.projectRoot;
  const workspaceRoot = context.workspaceRoot;
  const projectId = options.projectId ?? projectConfig?.id;
  if (!projectId) {
    return undefined;
  }

  const workspaceId = workspaceIdForContext(options, context);
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
      ...workspaceSourcePathEnv(context),
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
  const context = resolveCodexWorkspaceContext(options);
  const projectRoot = context.projectRoot;
  const workspaceRoot = context.workspaceRoot;
  const workspaceId = workspaceIdForContext(options, context);
  const targetId =
    options.targetId ?? defaultTargetId(projectConfig.id, workspaceId);

  return {
    PLEXUS_PROJECT_ROOT: projectRoot,
    PLEXUS_PROJECT_ID: projectConfig.id,
    PLEXUS_WORKSPACE_ID: workspaceId,
    PLEXUS_WORKSPACE_ROOT: workspaceRoot,
    ...workspaceSourcePathEnv(context),
    PLEXUS_TARGET_ID: targetId,
    PLEXUS_STATE_ROOT: config.paths.plexusStateRoot,
  };
}

function plexusImageLeaseEnvironment(
  options: BuildCodexMcpServersOptions,
  projectConfig: NexusProjectConfig,
): Record<string, string> {
  const context = resolveCodexWorkspaceContext(options);
  const workspaceId = workspaceIdForContext(options, context);
  const targetId =
    options.targetId ?? defaultTargetId(projectConfig.id, workspaceId);
  const branchName = context.workerContext?.worktree?.branchName ??
    context.workerContext?.ownership?.branchName;

  return {
    PLEXUS_IMAGE_LEASE_OWNER_ID: targetId,
    PLEXUS_IMAGE_LEASE_OWNER_KIND: "target",
    PLEXUS_IMAGE_LEASE_PURPOSE: "DevNexus-Pharo workspace image lifecycle",
    PLEXUS_IMAGE_LEASE_REPOSITORY_PATH: context.workspaceSourcePath,
    ...(branchName ? { PLEXUS_IMAGE_LEASE_BRANCH: branchName } : {}),
  };
}

function buildSharedDevNexusPharoMcpServers(
  config: NexusHomeConfig,
  options: BuildCodexMcpServersOptions,
  projectConfig: NexusProjectConfig,
): Record<string, CodexMcpServerConfig> {
  const context = resolveCodexWorkspaceContext(options);
  const projectRoot = context.projectRoot;
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
  const routeControlServers: Record<string, CodexMcpServerConfig> = context.workerContext
    ? {}
    : {
        [defaultRouteControlCodexMcpServerName]: {
          type: "http",
          enabled: true,
          url: gatewayUrl(gateway, gateway.routeControlMcpPath),
          defaultToolsApprovalMode: "approve",
        },
      };

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
      env: {
        ...plexusEnv,
        ...plexusImageLeaseEnvironment(options, projectConfig),
      },
      defaultToolsApprovalMode: "approve",
    },
    ...routeControlServers,
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
