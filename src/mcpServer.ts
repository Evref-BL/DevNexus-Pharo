import { Buffer } from "node:buffer";
import http from "node:http";
import process from "node:process";
import { defaultNexusHomePath } from "./config.js";
import {
  createNexusProject,
  getNexusProjectStatus,
  importNexusProject,
  listNexusProjects,
  type GitRunner,
} from "./nexusProjectService.js";
import {
  getProjectSkillStatus,
  refreshProjectSkills,
} from "./nexusProjectSkillService.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
} from "./devNexusPharoProjectService.js";
import {
  providerCompatibleMcpTools,
  StdioJsonRpcTransport,
} from "dev-nexus";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export const defaultDevNexusPharoMcpHost = "127.0.0.1";
export const defaultDevNexusPharoMcpEndpointPath = "/mcp";
export const defaultDevNexusPharoMcpHealthPath = "/health";
export const devNexusPharoMcpProtocolVersion = "2024-11-05";

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

const tools: McpTool[] = [
  {
    name: "project_create",
    description: "Create a DevNexus-Pharo project from scratch or by cloning a Git repository.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        name: { type: "string" },
        root: { type: "string" },
        remoteUrl: { type: "string" },
        from: { type: "string" },
        gitInit: { type: "boolean" },
        generic: { type: "boolean" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "project_import",
    description: "Import an existing local Git repository as a DevNexus-Pharo project without writing DevNexus-Pharo metadata into the source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        root: { type: "string" },
        projectRoot: { type: "string" },
        name: { type: "string" },
        generic: { type: "boolean" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "project_list",
    description: "List registered DevNexus-Pharo projects.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "project_status",
    description: "Show one DevNexus-Pharo project by registered id or filesystem path.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "project_skill_status",
    description: "Inspect installed DevNexus support skills for a DevNexus-Pharo project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "project_skill_refresh",
    description: "Refresh selected DevNexus support skills for a DevNexus-Pharo project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
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
      case "project_create": {
        const homePath = homePathFromArgs(args);
        if (optionalBoolean(args, "generic", "arguments")) {
          return toolResult({
            ok: true,
            ...createNexusProject({
              homePath,
              name: requiredString(args, "name", "arguments"),
              root: optionalString(args, "root", "arguments"),
              from: remoteUrlFromCreateArgs(args),
              gitInit: optionalBoolean(args, "gitInit", "arguments"),
              gitRunner: context.gitRunner,
            }),
          });
        }

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
          ...created,
        });
      }
      case "project_import": {
        const homePath = homePathFromArgs(args);
        if (optionalBoolean(args, "generic", "arguments")) {
          return toolResult({
            ok: true,
            ...importNexusProject({
              homePath,
              root: requiredString(args, "root", "arguments"),
              projectRoot: optionalString(args, "projectRoot", "arguments"),
              name: optionalString(args, "name", "arguments"),
              gitRunner: context.gitRunner,
            }),
          });
        }

        const imported = importDevNexusPharoProject({
          homePath,
          root: requiredString(args, "root", "arguments"),
          projectRoot: optionalString(args, "projectRoot", "arguments"),
          name: optionalString(args, "name", "arguments"),
          gitRunner: context.gitRunner,
        });

        return toolResult({
          ok: true,
          ...imported,
        });
      }
      case "project_list":
        return toolResult({
          ok: true,
          ...listNexusProjects({
            homePath: homePathFromArgs(args),
          }),
        });
      case "project_status":
        return toolResult({
          ok: true,
          ...getNexusProjectStatus({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
      case "project_skill_status":
        return toolResult({
          ok: true,
          ...getProjectSkillStatus({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
      case "project_skill_refresh":
        return toolResult({
          ok: true,
          ...refreshProjectSkills({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
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
