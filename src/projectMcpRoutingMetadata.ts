import fs from "node:fs";
import {
  projectConfigPath,
  type NexusProjectConfig,
} from "dev-nexus";

const mcpExposureModes = new Set(["direct", "gateway", "hidden"]);
const mcpTransportModes = new Set(["stdio", "http"]);

type JsonRecord = Record<string, unknown>;

export function restorePluginMcpRoutingMetadata(
  projectRootPath: string,
  config: NexusProjectConfig,
): NexusProjectConfig {
  const rawConfig = readRawProjectConfig(projectRootPath);
  if (!rawConfig || !Array.isArray(rawConfig.plugins) || !config.plugins) {
    return config;
  }

  for (const plugin of config.plugins) {
    const rawPlugin = rawConfig.plugins.find(
      (candidate): candidate is JsonRecord =>
        isRecord(candidate) && candidate.id === plugin.id,
    );
    if (!rawPlugin || !Array.isArray(rawPlugin.capabilities)) {
      continue;
    }
    for (const capability of plugin.capabilities) {
      if (capability.kind !== "mcp_server") {
        continue;
      }
      const rawCapability = rawPlugin.capabilities.find(
        (candidate): candidate is JsonRecord =>
          isRecord(candidate) &&
          candidate.kind === "mcp_server" &&
          candidate.id === capability.id,
      );
      if (!rawCapability) {
        continue;
      }
      restoreOptionalString(
        capability,
        rawCapability,
        "transport",
        mcpTransportModes,
      );
      restoreOptionalString(capability, rawCapability, "command");
      restoreOptionalStringArray(capability, rawCapability, "args");
      restoreOptionalString(capability, rawCapability, "url");
      restoreOptionalStringArray(capability, rawCapability, "targetAgents");
      restoreOptionalString(
        capability,
        rawCapability,
        "exposure",
        mcpExposureModes,
      );
    }
  }

  return config;
}

function readRawProjectConfig(projectRootPath: string): JsonRecord | undefined {
  const configPath = projectConfigPath(projectRootPath);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  return isRecord(parsed) ? parsed : undefined;
}

export function persistPluginMcpRoutingMetadata(
  configPath: string,
  config: NexusProjectConfig,
): void {
  if (!config.plugins) {
    return;
  }
  const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) {
    return;
  }

  for (const plugin of config.plugins) {
    const rawPlugin = parsed.plugins.find(
      (candidate): candidate is JsonRecord =>
        isRecord(candidate) && candidate.id === plugin.id,
    );
    if (!rawPlugin || !Array.isArray(rawPlugin.capabilities)) {
      continue;
    }
    for (const capability of plugin.capabilities) {
      if (capability.kind !== "mcp_server") {
        continue;
      }
      const rawCapability = rawPlugin.capabilities.find(
        (candidate): candidate is JsonRecord =>
          isRecord(candidate) &&
          candidate.kind === "mcp_server" &&
          candidate.id === capability.id,
      );
      if (!rawCapability) {
        continue;
      }
      const source = capability as unknown as JsonRecord;
      persistOptionalString(
        rawCapability,
        source,
        "transport",
        mcpTransportModes,
      );
      persistOptionalString(rawCapability, source, "command");
      persistOptionalStringArray(rawCapability, source, "args");
      persistOptionalString(rawCapability, source, "url");
      persistOptionalStringArray(rawCapability, source, "targetAgents");
      persistOptionalString(
        rawCapability,
        source,
        "exposure",
        mcpExposureModes,
      );
    }
  }

  fs.writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function restoreOptionalString(
  target: object,
  source: JsonRecord,
  field: string,
  allowedValues?: ReadonlySet<string>,
): void {
  const value = source[field];
  if (
    typeof value === "string" &&
    (!allowedValues || allowedValues.has(value))
  ) {
    (target as JsonRecord)[field] = value;
  }
}

function restoreOptionalStringArray(
  target: object,
  source: JsonRecord,
  field: string,
): void {
  const value = source[field];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    (target as JsonRecord)[field] = [...value];
  }
}

function persistOptionalString(
  target: JsonRecord,
  source: JsonRecord,
  field: string,
  allowedValues?: ReadonlySet<string>,
): void {
  const value = source[field];
  if (
    typeof value === "string" &&
    (!allowedValues || allowedValues.has(value))
  ) {
    target[field] = value;
  }
}

function persistOptionalStringArray(
  target: JsonRecord,
  source: JsonRecord,
  field: string,
): void {
  const value = source[field];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    target[field] = [...value];
  }
}
