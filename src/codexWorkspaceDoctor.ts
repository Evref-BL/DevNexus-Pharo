import fs from "node:fs";
import path from "node:path";
import {
  loadHomeConfig,
  resolveNexusHome,
  type NexusHomeConfig,
} from "./config.js";
import {
  hasManagedServerSection,
} from "./codexConfigToml.js";
import {
  checkHttpMcpServer,
  type HttpMcpServerCheck,
} from "./codexDoctorHttp.js";
import {
  inspectSharedPlexusImageProfiles,
  inspectSharedPlexusProjectConfig,
} from "./codexSharedPlexusProjectConfig.js";
import { codexConfigPath } from "./codexConfigPaths.js";
import {
  buildCodexMcpServers,
  defaultDevNexusPharoCodexMcpServerName,
  defaultPharoCodexMcpServerName,
  projectUsesSharedDevNexusMcp,
  workspaceProjectConfig,
} from "./codexMcpServers.js";
import { defaultDevNexusPharoMcpHealthPath } from "./devNexusPharoMcpProtocol.js";

export type CodexDoctorCheckStatus = "ok" | "failed" | "skipped";

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
