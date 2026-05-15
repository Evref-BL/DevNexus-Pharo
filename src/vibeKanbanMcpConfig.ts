import {
  getVibeKanbanMcpConfig,
  mergeMcpServerConfig,
  normalizeVibeKanbanExecutor,
  updateVibeKanbanMcpConfig,
  type VibeKanbanApiOptions,
  type VibeKanbanExecutor,
  type VibeKanbanMcpServerConfig,
} from "dev-nexus";
import {
  loadHomeConfig,
  resolveNexusHome,
  type NexusHomeConfig,
} from "./config.js";

export const defaultPharoNexusMcpServerName = "pharo_nexus";
export const defaultPlexusMcpServerName = "plexus";

export interface InstallPlexusMcpConfigOptions extends VibeKanbanApiOptions {
  homePath: string;
  config?: NexusHomeConfig;
  executor: string;
  serverName?: string;
  dryRun?: boolean;
}

export interface InstallPlexusMcpConfigResult {
  executor: VibeKanbanExecutor;
  serverName: string;
  server: VibeKanbanMcpServerConfig;
  servers: Record<string, VibeKanbanMcpServerConfig>;
  updated: boolean;
  response?: unknown;
}

export interface InstallPharoNexusAndPlexusMcpConfigOptions
  extends VibeKanbanApiOptions {
  homePath: string;
  config?: NexusHomeConfig;
  executor: string;
  nexusServerName?: string;
  plexusServerName?: string;
  dryRun?: boolean;
}

export interface InstallPharoNexusAndPlexusMcpConfigResult {
  executor: VibeKanbanExecutor;
  pharoNexus: {
    serverName: string;
    server: VibeKanbanMcpServerConfig;
  };
  plexus: {
    serverName: string;
    server: VibeKanbanMcpServerConfig;
  };
  servers: Record<string, VibeKanbanMcpServerConfig>;
  updated: boolean;
  response?: unknown;
}

export function buildPlexusMcpServerConfig(
  _homePath: string,
  config: NexusHomeConfig,
): VibeKanbanMcpServerConfig {
  return {
    type: "http",
    url: `http://${config.mcp.host}:${config.ports.plexusMcp}/mcp`,
  };
}

export function buildPharoNexusMcpServerConfig(
  _homePath: string,
  config: NexusHomeConfig,
): VibeKanbanMcpServerConfig {
  return {
    type: "http",
    url: `http://${config.mcp.host}:${config.ports.pharoNexusMcp}/mcp`,
  };
}

export async function installPlexusMcpForExecutor(
  options: InstallPlexusMcpConfigOptions,
): Promise<InstallPlexusMcpConfigResult> {
  const homePath = resolveNexusHome(options.homePath);
  const config = options.config ?? loadHomeConfig(homePath);
  const executor = normalizeVibeKanbanExecutor(options.executor);
  const serverName = options.serverName ?? defaultPlexusMcpServerName;
  const server = buildPlexusMcpServerConfig(homePath, config);
  const existing = await getVibeKanbanMcpConfig({
    ...options,
    executor,
    port: options.port,
  });
  const servers = mergeMcpServerConfig(
    existing.mcpConfig.servers,
    serverName,
    server,
  );

  if (options.dryRun) {
    return {
      executor,
      serverName,
      server,
      servers,
      updated: false,
    };
  }

  const response = await updateVibeKanbanMcpConfig({
    ...options,
    executor,
    servers,
  });

  return {
    executor,
    serverName,
    server,
    servers,
    updated: true,
    response,
  };
}

export async function installPharoNexusAndPlexusMcpForExecutor(
  options: InstallPharoNexusAndPlexusMcpConfigOptions,
): Promise<InstallPharoNexusAndPlexusMcpConfigResult> {
  const homePath = resolveNexusHome(options.homePath);
  const config = options.config ?? loadHomeConfig(homePath);
  const executor = normalizeVibeKanbanExecutor(options.executor);
  const nexusServerName =
    options.nexusServerName ??
    config.integrations.vibeKanban.nexusMcpServerName ??
    defaultPharoNexusMcpServerName;
  const plexusServerName =
    options.plexusServerName ??
    config.integrations.vibeKanban.plexusMcpServerName ??
    defaultPlexusMcpServerName;
  const pharoNexusServer = buildPharoNexusMcpServerConfig(homePath, config);
  const plexusServer = buildPlexusMcpServerConfig(homePath, config);
  const existing = await getVibeKanbanMcpConfig({
    ...options,
    executor,
    port: options.port,
  });
  const servers = mergeMcpServerConfig(
    mergeMcpServerConfig(
      existing.mcpConfig.servers,
      nexusServerName,
      pharoNexusServer,
    ),
    plexusServerName,
    plexusServer,
  );

  if (options.dryRun) {
    return {
      executor,
      pharoNexus: {
        serverName: nexusServerName,
        server: pharoNexusServer,
      },
      plexus: {
        serverName: plexusServerName,
        server: plexusServer,
      },
      servers,
      updated: false,
    };
  }

  const response = await updateVibeKanbanMcpConfig({
    ...options,
    executor,
    servers,
  });

  return {
    executor,
    pharoNexus: {
      serverName: nexusServerName,
      server: pharoNexusServer,
    },
    plexus: {
      serverName: plexusServerName,
      server: plexusServer,
    },
    servers,
    updated: true,
    response,
  };
}
