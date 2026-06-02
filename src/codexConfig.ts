import fs from "node:fs";
import path from "node:path";
import {
  loadHomeConfig,
  resolveNexusHome,
  type NexusHomeConfig,
} from "./config.js";
import {
  ensureSharedPlexusProjectConfig,
} from "./codexSharedPlexusProjectConfig.js";
import {
  mergeCodexMcpServersIntoToml,
  type CodexMcpServerConfig,
} from "./codexConfigToml.js";
import { codexConfigPath } from "./codexConfigPaths.js";
import {
  buildCodexMcpServers,
  defaultPharoCodexMcpServerName,
  legacyGatewayCodexMcpServerName,
  projectUsesSharedDevNexusMcp,
  resolveCodexWorkspaceContext,
  type DevNexusWorkerDependencyProjection,
  workspaceProjectConfig,
} from "./codexMcpServers.js";
import {
  inferPlexusRepositoryWorkspaceProjection,
} from "./plexusRepositoryWorkspaceProjection.js";
import type {
  PlexusRepositoryWorkspaceConfig,
} from "./plexusProjectConfig.js";

export {
  mergeCodexMcpServersIntoToml,
  type CodexMcpServerConfig,
} from "./codexConfigToml.js";
export * from "./codexConfigPaths.js";
export * from "./codexMcpServers.js";
export * from "./codexWorkspaceDoctor.js";

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

function worktreeRepositoryWorkspaceProjection(
  projectConfig: NonNullable<ReturnType<typeof workspaceProjectConfig>>,
  workspaceContext: ReturnType<typeof resolveCodexWorkspaceContext>,
): PlexusRepositoryWorkspaceConfig | undefined {
  const workerContext = workspaceContext.workerContext;
  const worktree = workerContext?.worktree ?? workerContext?.ownership;
  const componentId = worktree?.componentId ?? workerContext?.component?.id;
  if (!workerContext || !componentId) {
    return undefined;
  }

  return inferPlexusRepositoryWorkspaceProjection({
    projectConfig,
    workspaceSourcePath: workspaceContext.workspaceSourcePath,
    componentId,
    ...(worktree?.branchName ? { branchName: worktree.branchName } : {}),
  });
}

function relativeOriginPath(
  workspaceSourcePath: string,
  originPath: string,
): string {
  const relativePath = path.relative(
    path.resolve(workspaceSourcePath),
    path.resolve(originPath),
  );
  return relativePath.length > 0 ? relativePath : ".";
}

function dependencyRepositoryWorkspaceProjection(
  projectConfig: NonNullable<ReturnType<typeof workspaceProjectConfig>>,
  workspaceContext: ReturnType<typeof resolveCodexWorkspaceContext>,
  dependencyProjection: DevNexusWorkerDependencyProjection,
  primaryComponentId: string | undefined,
): PlexusRepositoryWorkspaceConfig | undefined {
  if (
    dependencyProjection.sourceControl !== "source" ||
    dependencyProjection.status === "skipped"
  ) {
    return undefined;
  }

  const componentId = dependencyProjection.sourceComponent?.id;
  const dependencyPath =
    dependencyProjection.targetPath ?? dependencyProjection.sourcePath;
  if (!componentId || !dependencyPath || componentId === primaryComponentId) {
    return undefined;
  }

  return inferPlexusRepositoryWorkspaceProjection({
    projectConfig,
    workspaceSourcePath: dependencyPath,
    componentId,
    originPath: relativeOriginPath(
      workspaceContext.workspaceSourcePath,
      dependencyPath,
    ),
  });
}

function worktreeRepositoryWorkspaceProjections(
  projectConfig: NonNullable<ReturnType<typeof workspaceProjectConfig>>,
  workspaceContext: ReturnType<typeof resolveCodexWorkspaceContext>,
): PlexusRepositoryWorkspaceConfig[] | undefined {
  const workerContext = workspaceContext.workerContext;
  const worktree = workerContext?.worktree ?? workerContext?.ownership;
  const primaryComponentId = worktree?.componentId ?? workerContext?.component?.id;
  const projections = [
    worktreeRepositoryWorkspaceProjection(projectConfig, workspaceContext),
    ...(
      workerContext?.dependencySupport?.pluginDependencyProjections ?? []
    ).map((dependencyProjection) =>
      dependencyRepositoryWorkspaceProjection(
        projectConfig,
        workspaceContext,
        dependencyProjection,
        primaryComponentId,
      ),
    ),
  ].filter(
    (
      projection,
    ): projection is PlexusRepositoryWorkspaceConfig =>
      projection !== undefined,
  );

  const seen = new Set<string>();
  const uniqueProjections = projections.filter((projection) => {
    const repositoryId = projection.repository.id;
    if (seen.has(repositoryId)) {
      return false;
    }
    seen.add(repositoryId);
    return true;
  });
  return uniqueProjections.length > 0 ? uniqueProjections : undefined;
}

export function initCodexWorkspace(
  options: InitCodexWorkspaceOptions,
): InitCodexWorkspaceResult {
  const workspacePath = path.resolve(options.workspacePath);
  const homePath = resolveNexusHome(options.homePath);
  const config = options.config ?? loadHomeConfig(homePath);
  const configPath = codexConfigPath(workspacePath);
  const workspaceContext = resolveCodexWorkspaceContext({
    workspacePath,
    projectRoot: options.projectRoot,
  });
  const projectConfig =
    workspaceProjectConfig(workspacePath) ??
    workspaceProjectConfig(options.projectRoot);
  const plexusProjectRoot = workspaceContext.projectRoot;
  const plexusProjectConfig = projectUsesSharedDevNexusMcp(projectConfig)
    ? ensureSharedPlexusProjectConfig(
        plexusProjectRoot,
        projectConfig,
        config,
        options.dryRun,
        worktreeRepositoryWorkspaceProjections(projectConfig, workspaceContext),
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
