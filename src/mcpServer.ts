import { Buffer } from "node:buffer";
import http from "node:http";
import process from "node:process";
import { defaultNexusHomePath, type NexusProjectConfig } from "./config.js";
import {
  getNexusProjectStatus,
  listNexusProjects,
  type GitRunner,
  type NexusProjectStatus,
} from "./nexusProjectService.js";
import {
  getProjectSkillStatus,
  refreshProjectSkills,
} from "./nexusProjectSkillService.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
  type CreateDevNexusPharoProjectResult,
  type ImportDevNexusPharoProjectResult,
} from "./devNexusPharoProjectService.js";
import {
  providerCompatibleMcpTools,
  StdioJsonRpcTransport,
} from "dev-nexus";
import {
  defaultDevNexusPharoMcpEndpointPath,
  defaultDevNexusPharoMcpHealthPath,
  defaultDevNexusPharoMcpHost,
  devNexusPharoMcpProtocolVersion,
} from "./devNexusPharoMcpProtocol.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface DevNexusPharoMcpHttpServerOptions {
  host?: string;
  port: number;
  endpointPath?: string;
  healthPath?: string;
  allowedOrigins?: string[];
  requestBodyLimitBytes?: number;
}

export interface DevNexusPharoMcpHttpServer {
  server: http.Server;
  host: string;
  port: number;
  endpointPath: string;
  healthPath: string;
  url: string;
  healthUrl: string;
  close: () => Promise<void>;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DevNexusPharoMcpToolContext {
  gitRunner?: GitRunner;
  fetch?: typeof fetch;
}

type McpDetail = "summary" | "full";

const tools: McpTool[] = [
  {
    name: "pharo_project_create",
    description: "Create a DevNexus-Pharo project from scratch or by cloning a Git repository.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        name: { type: "string" },
        root: { type: "string" },
        remoteUrl: { type: "string" },
        from: { type: "string" },
        gitInit: { type: "boolean" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_import",
    description: "Import an existing local Git repository as a DevNexus-Pharo project without writing DevNexus-Pharo metadata into the source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        root: { type: "string" },
        projectRoot: { type: "string" },
        name: { type: "string" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_list",
    description: "List registered DevNexus-Pharo projects.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_status",
    description: "Show one DevNexus-Pharo project by registered id or filesystem path.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_skill_status",
    description: "Inspect installed DevNexus support skills for a DevNexus-Pharo project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_skill_refresh",
    description: "Refresh selected DevNexus support skills for a DevNexus-Pharo project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
];

function asRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string`);
  }

  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = optionalString(record, key, pathName);
  if (!value) {
    throw new Error(`${pathName}.${key} is required`);
  }

  return value;
}

function homePathFromArgs(args: Record<string, unknown>): string {
  return optionalString(args, "homePath", "arguments") ?? defaultNexusHomePath();
}

function remoteUrlFromCreateArgs(args: Record<string, unknown>): string | undefined {
  const remoteUrl = optionalString(args, "remoteUrl", "arguments");
  const from = optionalString(args, "from", "arguments");
  if (remoteUrl && from && remoteUrl !== from) {
    throw new Error("arguments.remoteUrl and arguments.from must match when both are provided");
  }

  return remoteUrl ?? from;
}

function mcpDetailFromArgs(args: Record<string, unknown>): McpDetail {
  const detail = optionalString(args, "detail", "arguments") ?? "summary";
  if (detail === "summary" || detail === "full") {
    return detail;
  }

  throw new Error("arguments.detail must be summary or full");
}

function toolResult(value: unknown, isError = false): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export function listDevNexusPharoMcpTools(): McpTool[] {
  return providerCompatibleMcpTools(tools);
}

export async function callDevNexusPharoMcpTool(
  name: string,
  argsValue: unknown,
  context: DevNexusPharoMcpToolContext = {},
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "pharo_project_create": {
        const detail = mcpDetailFromArgs(args);
        const homePath = homePathFromArgs(args);
        const created = createDevNexusPharoProject({
          homePath,
          name: requiredString(args, "name", "arguments"),
          root: optionalString(args, "root", "arguments"),
          from: remoteUrlFromCreateArgs(args),
          gitInit: optionalBoolean(args, "gitInit", "arguments"),
          gitRunner: context.gitRunner,
        });

        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? created
            : summarizeProjectSetupResult(created)),
        });
      }
      case "pharo_project_import": {
        const detail = mcpDetailFromArgs(args);
        const homePath = homePathFromArgs(args);
        const imported = importDevNexusPharoProject({
          homePath,
          root: requiredString(args, "root", "arguments"),
          projectRoot: optionalString(args, "projectRoot", "arguments"),
          name: optionalString(args, "name", "arguments"),
          gitRunner: context.gitRunner,
        });

        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? imported
            : summarizeProjectSetupResult(imported)),
        });
      }
      case "pharo_project_list": {
        const detail = mcpDetailFromArgs(args);
        const result = listNexusProjects({
          homePath: homePathFromArgs(args),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                projectCount: result.projects.length,
                projects: result.projects.map(summarizeProjectStatus),
              }),
        });
      }
      case "pharo_project_status": {
        const detail = mcpDetailFromArgs(args);
        const result = getNexusProjectStatus({
          homePath: homePathFromArgs(args),
          project: requiredString(args, "project", "arguments"),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                project: summarizeProjectStatus(result.project),
              }),
        });
      }
      case "pharo_project_skill_status": {
        const detail = mcpDetailFromArgs(args);
        const result = getProjectSkillStatus({
          homePath: homePathFromArgs(args),
          project: requiredString(args, "project", "arguments"),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                project: summarizeProjectStatus(result.project),
                skillStatus: summarizeSkillStatus(result.skillStatus),
              }),
        });
      }
      case "pharo_project_skill_refresh": {
        const detail = mcpDetailFromArgs(args);
        const result = refreshProjectSkills({
          homePath: homePathFromArgs(args),
          project: requiredString(args, "project", "arguments"),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                project: summarizeProjectStatus(result.project),
                refresh: summarizeSkillRefresh(result.refresh),
              }),
        });
      }
      default:
        return toolResult(
          {
            ok: false,
            error: `Unknown DevNexus-Pharo MCP tool: ${name}`,
          },
          true,
        );
    }
  } catch (error) {
    return toolResult(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}

function summarizeProjectSetupResult(
  result: CreateDevNexusPharoProjectResult | ImportDevNexusPharoProjectResult,
) {
  return {
    homePath: result.homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    plexusProjectConfigPath: result.plexusProjectConfigPath,
    worktreesRoot: result.worktreesRoot,
    agentsPath: result.agentsPath,
    suggestedFirstPromptPath: result.suggestedFirstPromptPath,
    codexConfigPath: result.codexConfigPath,
    projectConfig: summarizeProjectConfig(result.projectConfig),
    plexusProjectConfig: summarizePlexusProjectConfig(result.plexusProjectConfig),
    codex: summarizeCodexInitResult(result.codex),
    git: summarizeGitOperation(result.git),
  };
}

function summarizeProjectConfig(config: NexusProjectConfig) {
  return {
    version: config.version,
    id: config.id,
    name: config.name,
    repo: {
      kind: config.repo.kind,
      remoteUrl: config.repo.remoteUrl,
      defaultBranch: config.repo.defaultBranch,
      sourceRoot: config.repo.sourceRoot ?? null,
    },
    componentCount: config.components.length,
    components: config.components.map((component) => ({
      id: component.id,
      name: component.name,
      kind: component.kind,
      role: component.role,
      remoteUrl: component.remoteUrl,
      defaultBranch: component.defaultBranch,
      sourceRoot: component.sourceRoot ?? null,
      relationshipCount: component.relationships.length,
    })),
    pluginCount: config.plugins?.length ?? 0,
    enabledPlugins: config.plugins
      ?.filter((plugin) => plugin.enabled !== false)
      .map((plugin) => ({
        id: plugin.id,
        capabilityCount: plugin.capabilities.length,
      })) ?? [],
    worktreesRoot: config.worktreesRoot,
  };
}

function summarizeProjectStatus(project: NexusProjectStatus) {
  return {
    id: project.id,
    name: project.name,
    projectRoot: project.projectRoot,
    repo: project.repo
      ? {
          kind: project.repo.kind,
          remoteUrl: project.repo.remoteUrl,
          defaultBranch: project.repo.defaultBranch,
          sourceRoot: project.repo.sourceRoot ?? null,
        }
      : null,
    componentCount: project.components.length,
    components: project.components.map((component) => ({
      id: component.id,
      name: component.name,
      kind: component.kind,
      role: component.role,
      sourceRoot: component.sourceRoot,
      sourceRootExists: component.sourceRootExists,
      worktreesRoot: component.worktreesRoot,
      worktreesRootExists: component.worktreesRootExists,
      workTrackerCount: component.workTrackers.length,
      workTracking: component.workTracking
        ? { provider: component.workTracking.provider }
        : null,
      relationshipCount: component.relationships.length,
    })),
    workTracking: project.workTracking
      ? { provider: project.workTracking.provider }
      : null,
    vibeKanbanProjectId: project.vibeKanbanProjectId,
    vibeKanbanRepoId: project.vibeKanbanRepoId,
    projectConfigPath: project.projectConfigPath,
    projectConfigExists: project.projectConfigExists,
    plexusProjectConfigPath: project.plexusProjectConfigPath,
    plexusProjectConfigExists: project.plexusProjectConfigExists,
    worktreesRoot: project.worktreesRoot,
    worktreesRootExists: project.worktreesRootExists,
  };
}

function summarizePlexusProjectConfig(config: unknown) {
  const record = asRecord(config, "plexusProjectConfig");
  const imageExecution = record.imageExecution &&
    typeof record.imageExecution === "object"
    ? record.imageExecution as Record<string, unknown>
    : null;
  const runtime = record.runtime && typeof record.runtime === "object"
    ? record.runtime as Record<string, unknown>
    : null;
  const gateway = runtime?.gateway && typeof runtime.gateway === "object"
    ? runtime.gateway as Record<string, unknown>
    : null;
  return {
    id: record.id,
    name: record.name,
    imageCount: Array.isArray(record.images) ? record.images.length : 0,
    imageExecution: imageExecution
      ? {
          mode: imageExecution.mode,
          requireDisposableImage: imageExecution.requireDisposableImage,
          requireCleanupPlan: imageExecution.requireCleanupPlan,
        }
      : null,
    gateway: gateway
      ? {
          mode: gateway.mode,
          host: gateway.host,
          port: gateway.port,
          agentMcpPath: gateway.agentMcpPath,
          routeControlMcpPath: gateway.routeControlMcpPath,
        }
      : null,
  };
}

function summarizeCodexInitResult(codex: unknown) {
  const record = asRecord(codex, "codex");
  const servers = record.servers && typeof record.servers === "object"
    ? record.servers as Record<string, unknown>
    : {};
  return {
    workspacePath: record.workspacePath,
    configPath: record.configPath,
    plexusProjectConfigPath: record.plexusProjectConfigPath,
    plexusProjectConfigCreated: record.plexusProjectConfigCreated,
    updated: record.updated,
    serverCount: Object.keys(servers).length,
    servers: Object.entries(servers).map(([name, serverValue]) => {
      const server = serverValue && typeof serverValue === "object"
        ? serverValue as Record<string, unknown>
        : {};
      return {
        name,
        type: server.type ?? "stdio",
        enabled: server.enabled,
        command: server.command,
        argCount: Array.isArray(server.args) ? server.args.length : 0,
        url: server.url,
        envCount:
          server.env && typeof server.env === "object"
            ? Object.keys(server.env).length
            : 0,
      };
    }),
    contentLength:
      typeof record.content === "string" ? record.content.length : null,
  };
}

function summarizeGitOperation(
  git:
    | CreateDevNexusPharoProjectResult["git"]
    | ImportDevNexusPharoProjectResult["git"],
) {
  return {
    operation: git.operation,
    remoteUrl: git.remoteUrl,
    defaultBranch: git.defaultBranch,
    commandCount: git.commands.length,
    commands: git.commands.map((command) => ({
      args: command.args,
      exitCode: command.exitCode,
      stdoutLength: command.stdout.length,
      stderrLength: command.stderr.length,
    })),
  };
}

function summarizeSkillStatus(status: unknown) {
  const record = asRecord(status, "skillStatus");
  const skills = Array.isArray(record.skills) ? record.skills : [];
  const attentionSkills = skills.filter(skillNeedsAttention);
  return {
    skillsDirectory: record.skillsDirectory,
    summary: record.summary,
    skillCount: skills.length,
    skillIds: skills.flatMap((skill) => {
      const record = skill && typeof skill === "object"
        ? skill as Record<string, unknown>
        : {};
      return typeof record.id === "string" ? [record.id] : [];
    }),
    attentionSkillCount: attentionSkills.length,
    omittedInstalledSkillCount: skills.length - attentionSkills.length,
    skills: attentionSkills.slice(0, 10).map(summarizeSkillRecord),
  };
}

function summarizeSkillRefresh(refresh: unknown) {
  const record = asRecord(refresh, "refresh");
  const materialized = Array.isArray(record.materialized)
    ? record.materialized
    : [];
  return {
    before: summarizeSkillStatus(record.before),
    after: summarizeSkillStatus(record.after),
    materializedCount: materialized.length,
    materialized: materialized.slice(0, 10).map(summarizeSkillRecord),
  };
}

function skillNeedsAttention(value: unknown): boolean {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  return (
    record.state !== "installed" ||
    record.installed !== true ||
    record.expected !== true ||
    reasons.length > 0
  );
}

function summarizeSkillRecord(value: unknown) {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  return {
    id: record.id,
    state: record.state,
    expected: record.expected,
    installed: record.installed,
    name: record.name,
    expectedVersion: record.expectedVersion,
    installedVersion: record.installedVersion,
    materialization: record.materialization,
    sourceControl: record.sourceControl,
    reasonCount: reasons.length,
    reasons: reasons.slice(0, 3),
  };
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown): unknown {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function normalizePath(pathName: string): string {
  return pathName.startsWith("/") ? pathName : `/${pathName}`;
}

function writeJsonResponse(
  response: http.ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body, "utf8"),
    "mcp-protocol-version": devNexusPharoMcpProtocolVersion,
  });
  response.end(body);
}

function writeEmptyResponse(
  response: http.ServerResponse,
  statusCode: number,
): void {
  response.writeHead(statusCode, {
    "mcp-protocol-version": devNexusPharoMcpProtocolVersion,
  });
  response.end();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function headerHostName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("[")) {
    const endIndex = value.indexOf("]");
    return endIndex >= 0 ? value.slice(0, endIndex + 1) : value;
  }

  return value.split(":")[0];
}

function isAllowedHostHeader(
  hostHeader: string | undefined,
  configuredHost: string,
): boolean {
  const host = headerHostName(hostHeader);
  if (!host) {
    return true;
  }

  if (host === configuredHost) {
    return true;
  }

  return isLoopbackHostname(host) && isLoopbackHostname(configuredHost);
}

function isAllowedOrigin(
  origin: string | undefined,
  configuredHost: string,
  allowedOrigins: string[],
): boolean {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      isLoopbackHostname(parsed.hostname) &&
      isLoopbackHostname(configuredHost)
    );
  } catch {
    return false;
  }
}

function readRequestBody(
  request: http.IncomingMessage,
  limitBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    request.on("data", (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > limitBytes) {
        reject(new Error("MCP request body is too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
    });
  });
}

function parseToolCallParams(value: unknown): { name: string; arguments?: unknown } {
  const params = asRecord(value, "params");
  const name = requiredString(params, "name", "params");

  return {
    name,
    arguments: params.arguments,
  };
}

async function handleJsonRpcMessage(message: JsonRpcRequest): Promise<unknown | undefined> {
  switch (message.method) {
    case "initialize":
      return jsonRpcResult(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "dev-nexus-pharo",
          version: "0.1.0",
        },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return jsonRpcResult(message.id, {
        tools: listDevNexusPharoMcpTools(),
      });
    case "tools/call": {
      const params = parseToolCallParams(message.params);
      return jsonRpcResult(
        message.id,
        await callDevNexusPharoMcpTool(params.name, params.arguments),
      );
    }
    default:
      if (message.id === undefined) {
        return undefined;
      }

      return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

async function handleJsonRpcHttpPayload(
  payload: unknown,
): Promise<unknown | undefined> {
  if (Array.isArray(payload)) {
    const responses = (
      await Promise.all(
        payload.map((entry) => handleJsonRpcMessage(entry as JsonRpcRequest)),
      )
    ).filter((entry) => entry !== undefined);

    return responses.length > 0 ? responses : undefined;
  }

  return handleJsonRpcMessage(payload as JsonRpcRequest);
}

function devNexusPharoMcpServerUrl(
  host: string,
  port: number,
  pathName: string,
): string {
  const formattedHost = host.includes(":") && !host.startsWith("[")
    ? `[${host}]`
    : host;
  return `http://${formattedHost}:${port}${pathName}`;
}

export function startDevNexusPharoMcpHttpServer(
  options: DevNexusPharoMcpHttpServerOptions,
): Promise<DevNexusPharoMcpHttpServer> {
  const host = options.host ?? defaultDevNexusPharoMcpHost;
  const endpointPath = normalizePath(
    options.endpointPath ?? defaultDevNexusPharoMcpEndpointPath,
  );
  const healthPath = normalizePath(
    options.healthPath ?? defaultDevNexusPharoMcpHealthPath,
  );
  const requestBodyLimitBytes = options.requestBodyLimitBytes ?? 1024 * 1024;

  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error("DevNexus-Pharo MCP HTTP port must be an integer between 1 and 65535");
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? "/",
        devNexusPharoMcpServerUrl(host, options.port, "/"),
      );
      if (
        !isAllowedHostHeader(request.headers.host, host) ||
        !isAllowedOrigin(request.headers.origin, host, options.allowedOrigins ?? [])
      ) {
        writeJsonResponse(response, 403, {
          ok: false,
          error: "Forbidden MCP request origin",
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === healthPath) {
        writeJsonResponse(response, 200, {
          ok: true,
          service: "dev-nexus-pharo-mcp",
        });
        return;
      }

      if (requestUrl.pathname !== endpointPath) {
        writeJsonResponse(response, 404, {
          ok: false,
          error: "Not found",
        });
        return;
      }

      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        writeJsonResponse(response, 405, {
          ok: false,
          error: "Method not allowed",
        });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(
          await readRequestBody(request, requestBodyLimitBytes),
        );
      } catch (error) {
        writeJsonResponse(
          response,
          error instanceof Error &&
            error.message === "MCP request body is too large"
            ? 413
            : 400,
          jsonRpcError(
            undefined,
            -32700,
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }

      try {
        const result = await handleJsonRpcHttpPayload(payload);
        if (result === undefined) {
          writeEmptyResponse(response, 202);
          return;
        }

        writeJsonResponse(response, 200, result);
      } catch (error) {
        writeJsonResponse(
          response,
          500,
          jsonRpcError(
            undefined,
            -32603,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        writeJsonResponse(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        response.end();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.off("error", reject);
      resolve({
        server,
        host,
        port: options.port,
        endpointPath,
        healthPath,
        url: devNexusPharoMcpServerUrl(host, options.port, endpointPath),
        healthUrl: devNexusPharoMcpServerUrl(host, options.port, healthPath),
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }

              closeResolve();
            });
          }),
      });
    });
  });
}

export async function runDevNexusPharoMcpStdioServer(): Promise<void> {
  const transport = new StdioJsonRpcTransport(handleJsonRpcMessage);
  await transport.start();
}

export async function runDevNexusPharoMcpServer(
  options: DevNexusPharoMcpHttpServerOptions,
): Promise<void> {
  const running = await startDevNexusPharoMcpHttpServer(options);
  process.stderr.write(`DevNexus-Pharo MCP HTTP server listening at ${running.url}\n`);
  await new Promise<void>((resolve) => {
    running.server.once("close", resolve);
  });
}
