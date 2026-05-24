import {
  loadProjectConfigIfExists as loadDevNexusProjectConfigIfExists,
  loadProjectConfig as loadDevNexusProjectConfig,
  saveProjectConfig as saveDevNexusProjectConfig,
  type NexusProjectConfig,
} from "dev-nexus";
import {
  persistPluginMcpRoutingMetadata,
  restorePluginMcpRoutingMetadata,
} from "./projectMcpRoutingMetadata.js";

export function saveProjectConfig(
  projectRootPath: string,
  config: NexusProjectConfig,
): string {
  const configPath = saveDevNexusProjectConfig(projectRootPath, config);
  persistPluginMcpRoutingMetadata(configPath, config);
  return configPath;
}

export function loadProjectConfig(projectRootPath: string): NexusProjectConfig {
  return restorePluginMcpRoutingMetadata(
    projectRootPath,
    loadDevNexusProjectConfig(projectRootPath),
  );
}

export function loadProjectConfigIfExists(
  projectRootPath: string,
): NexusProjectConfig | undefined {
  const config = loadDevNexusProjectConfigIfExists(projectRootPath);
  return config
    ? restorePluginMcpRoutingMetadata(projectRootPath, config)
    : undefined;
}
