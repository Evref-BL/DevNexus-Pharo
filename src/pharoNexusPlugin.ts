import type { NexusProjectPluginConfig } from "dev-nexus";

export const pharoNexusPluginId = "pharo-nexus";
export const pharoNexusPluginName = "PharoNexus";
export const pharoNexusPluginVersion = "0.1.0";

export function pharoNexusDevNexusPluginConfig(): NexusProjectPluginConfig {
  return {
    id: pharoNexusPluginId,
    name: pharoNexusPluginName,
    version: pharoNexusPluginVersion,
    enabled: true,
    capabilities: [],
  };
}
