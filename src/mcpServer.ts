import { Buffer } from "node:buffer";
import http from "node:http";
import process from "node:process";
import { defaultPharoNexusHomePath, loadProjectConfig } from "./config.js";
import {
  createPharoNexusProject,
  getPharoNexusProjectStatus,
  importPharoNexusProject,
  linkPharoNexusProjectKanban,
  listPharoNexusProjects,
  syncPharoNexusProjectKanban,
  type GitRunner,
  type SyncPharoNexusProjectKanbanResult,
} from "./projectService.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export const defaultPharoNexusMcpHost = "127.0.0.1";
export const defaultPharoNexusMcpEndpointPath = "/mcp";
export const defaultPharoNexusMcpHealthPath = "/health";
export const pharoNexusMcpProtocolVersion = "2024-11-05";

export interface PharoNexusMcpHttpServerOptions {
  host?: string;
  port: number;
  endpointPath?: string;
  healthPath?: string;
  allowedOrigins?: string[];
  requestBodyLimitBytes?: number;
}

export interface PharoNexusMcpHttpServer {
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

export interface PharoNexusMcpToolContext {
  gitRunner?: GitRunner;
  fetch?: typeof fetch;
}

const tools: McpTool[] = [
  {
    name: "pharo_nexus_project_create",
    description: "Create a PharoNexus project from scratch or by cloning a Git repository.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        name: { type: "string" },
        root: { type: "string" },
        remoteUrl: { type: "string" },
        from: { type: "string" },
        gitInit: { type: "boolean" },
        vibeKanbanProjectId: { type: "string" },
        syncVibeKanban: { type: "boolean" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_nexus_project_import",
    description: "Import an existing local Git repository as a PharoNexus project without writing PharoNexus metadata into the source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        root: { type: "string" },
        projectRoot: { type: "string" },
        name: { type: "string" },
        vibeKanbanProjectId: { type: "string" },
        syncVibeKanban: { type: "boolean" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_nexus_project_link_kanban",
    description: "Link a PharoNexus project to an existing Vibe Kanban project id.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        vibeKanbanProjectId: { type: "string" },
      },
      required: ["project", "vibeKanbanProjectId"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_nexus_project_sync_kanban",
    description: "Register a PharoNexus project as a local Vibe repo and ensure its Vibe Kanban board exists.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_nexus_project_list",
    description: "List registered PharoNexus projects.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "pharo_nexus_project_status",
    description: "Show one PharoNexus project by registered id or filesystem path.",
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

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${pathName}.${key} must be a number`);
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
  return optionalString(args, "homePath", "arguments") ?? defaultPharoNexusHomePath();
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

export function listPharoNexusMcpTools(): McpTool[] {
  return tools;
}

function shouldSyncVibeKanban(args: Record<string, unknown>): boolean {
  const requested = optionalBoolean(args, "syncVibeKanban", "arguments");
  if (requested !== undefined) {
    return requested;
  }

  return !optionalString(args, "vibeKanbanProjectId", "arguments");
}

async function syncProjectForMcp(
  args: Record<string, unknown>,
  context: PharoNexusMcpToolContext,
  homePath: string,
  projectRoot: string,
): Promise<SyncPharoNexusProjectKanbanResult | undefined> {
  if (!shouldSyncVibeKanban(args)) {
    return undefined;
  }

  return syncPharoNexusProjectKanban({
    homePath,
    project: projectRoot,
    host: optionalString(args, "vibeHost", "arguments"),
    port: optionalNumber(args, "vibePort", "arguments"),
    fetch: context.fetch,
  });
}

export async function callPharoNexusMcpTool(
  name: string,
  argsValue: unknown,
  context: PharoNexusMcpToolContext = {},
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "pharo_nexus_project_create": {
        const homePath = homePathFromArgs(args);
        const created = createPharoNexusProject({
          homePath,
          name: requiredString(args, "name", "arguments"),
          root: optionalString(args, "root", "arguments"),
          from: remoteUrlFromCreateArgs(args),
          gitInit: optionalBoolean(args, "gitInit", "arguments"),
          vibeKanbanProjectId: optionalString(
            args,
            "vibeKanbanProjectId",
            "arguments",
          ),
          gitRunner: context.gitRunner,
        });
        let vibeKanbanSync: SyncPharoNexusProjectKanbanResult | undefined;
        try {
          vibeKanbanSync = await syncProjectForMcp(
            args,
            context,
            homePath,
            created.projectRoot,
          );
        } catch (error) {
          throw new Error(
            `Project was created locally at ${created.projectRoot}, but Vibe Kanban sync failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        return toolResult({
          ok: true,
          ...created,
          projectConfig: vibeKanbanSync
            ? loadProjectConfig(created.projectRoot)
            : created.projectConfig,
          plexusProjectConfig:
            vibeKanbanSync?.plexusProjectConfig ?? created.plexusProjectConfig,
          ...(vibeKanbanSync ? { vibeKanbanSync } : {}),
        });
      }
      case "pharo_nexus_project_import": {
        const homePath = homePathFromArgs(args);
        const imported = importPharoNexusProject({
          homePath,
          root: requiredString(args, "root", "arguments"),
          projectRoot: optionalString(args, "projectRoot", "arguments"),
          name: optionalString(args, "name", "arguments"),
          vibeKanbanProjectId: optionalString(
            args,
            "vibeKanbanProjectId",
            "arguments",
          ),
          gitRunner: context.gitRunner,
        });
        let vibeKanbanSync: SyncPharoNexusProjectKanbanResult | undefined;
        try {
          vibeKanbanSync = await syncProjectForMcp(
            args,
            context,
            homePath,
            imported.projectRoot,
          );
        } catch (error) {
          throw new Error(
            `Project was imported locally at ${imported.projectRoot}, but Vibe Kanban sync failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        return toolResult({
          ok: true,
          ...imported,
          projectConfig: vibeKanbanSync
            ? loadProjectConfig(imported.projectRoot)
            : imported.projectConfig,
          plexusProjectConfig:
            vibeKanbanSync?.plexusProjectConfig ?? imported.plexusProjectConfig,
          ...(vibeKanbanSync ? { vibeKanbanSync } : {}),
        });
      }
      case "pharo_nexus_project_link_kanban":
        return toolResult({
          ok: true,
          ...linkPharoNexusProjectKanban({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
            vibeKanbanProjectId: requiredString(
              args,
              "vibeKanbanProjectId",
              "arguments",
            ),
          }),
        });
      case "pharo_nexus_project_sync_kanban":
        return toolResult({
          ok: true,
          ...(await syncPharoNexusProjectKanban({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
            host: optionalString(args, "vibeHost", "arguments"),
            port: optionalNumber(args, "vibePort", "arguments"),
            fetch: context.fetch,
          })),
        });
      case "pharo_nexus_project_list":
        return toolResult({
          ok: true,
          ...listPharoNexusProjects({
            homePath: homePathFromArgs(args),
          }),
        });
      case "pharo_nexus_project_status":
        return toolResult({
          ok: true,
          ...getPharoNexusProjectStatus({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
      default:
        return toolResult(
          {
            ok: false,
            error: `Unknown PharoNexus MCP tool: ${name}`,
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
    "mcp-protocol-version": pharoNexusMcpProtocolVersion,
  });
  response.end(body);
}

function writeEmptyResponse(
  response: http.ServerResponse,
  statusCode: number,
): void {
  response.writeHead(statusCode, {
    "mcp-protocol-version": pharoNexusMcpProtocolVersion,
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
          name: "pharo-nexus",
          version: "0.1.0",
        },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return jsonRpcResult(message.id, {
        tools: listPharoNexusMcpTools(),
      });
    case "tools/call": {
      const params = parseToolCallParams(message.params);
      return jsonRpcResult(
        message.id,
        await callPharoNexusMcpTool(params.name, params.arguments),
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

function pharoNexusMcpServerUrl(
  host: string,
  port: number,
  pathName: string,
): string {
  const formattedHost = host.includes(":") && !host.startsWith("[")
    ? `[${host}]`
    : host;
  return `http://${formattedHost}:${port}${pathName}`;
}

export function startPharoNexusMcpHttpServer(
  options: PharoNexusMcpHttpServerOptions,
): Promise<PharoNexusMcpHttpServer> {
  const host = options.host ?? defaultPharoNexusMcpHost;
  const endpointPath = normalizePath(
    options.endpointPath ?? defaultPharoNexusMcpEndpointPath,
  );
  const healthPath = normalizePath(
    options.healthPath ?? defaultPharoNexusMcpHealthPath,
  );
  const requestBodyLimitBytes = options.requestBodyLimitBytes ?? 1024 * 1024;

  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error("PharoNexus MCP HTTP port must be an integer between 1 and 65535");
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? "/",
        pharoNexusMcpServerUrl(host, options.port, "/"),
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
          service: "pharo-nexus-mcp",
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
        url: pharoNexusMcpServerUrl(host, options.port, endpointPath),
        healthUrl: pharoNexusMcpServerUrl(host, options.port, healthPath),
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

class StdioJsonRpcTransport {
  private buffer = Buffer.alloc(0);
  private processing = false;

  constructor(
    private readonly onMessage: (
      message: JsonRpcRequest,
    ) => Promise<unknown | undefined>,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      process.stdin.on("data", (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        void this.processBuffer().catch((error: unknown) => {
          this.send(
            jsonRpcError(
              undefined,
              -32603,
              error instanceof Error ? error.message : String(error),
            ),
          );
        });
      });
      process.stdin.once("end", resolve);
    });
  }

  private async processBuffer(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (true) {
        const headerEnd = this.headerEndIndex();
        if (!headerEnd) {
          return;
        }

        const [endIndex, separatorLength] = headerEnd;
        const header = this.buffer.slice(0, endIndex).toString("utf8");
        const lengthMatch = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
        if (!lengthMatch) {
          throw new Error("Missing Content-Length header");
        }

        const contentLength = Number(lengthMatch[1]);
        const messageStart = endIndex + separatorLength;
        const messageEnd = messageStart + contentLength;
        if (this.buffer.length < messageEnd) {
          return;
        }

        const body = this.buffer.slice(messageStart, messageEnd).toString("utf8");
        this.buffer = this.buffer.slice(messageEnd);
        const response = await this.onMessage(JSON.parse(body) as JsonRpcRequest);
        if (response) {
          this.send(response);
        }
      }
    } finally {
      this.processing = false;
      if (this.headerEndIndex()) {
        void this.processBuffer();
      }
    }
  }

  private headerEndIndex(): [number, number] | undefined {
    const crlfIndex = this.buffer.indexOf("\r\n\r\n");
    if (crlfIndex >= 0) {
      return [crlfIndex, 4];
    }

    const lfIndex = this.buffer.indexOf("\n\n");
    return lfIndex >= 0 ? [lfIndex, 2] : undefined;
  }

  private send(message: unknown): void {
    const body = JSON.stringify(message);
    process.stdout.write(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
    );
  }
}

export async function runPharoNexusMcpStdioServer(): Promise<void> {
  const transport = new StdioJsonRpcTransport(handleJsonRpcMessage);
  await transport.start();
}

export async function runPharoNexusMcpServer(
  options: PharoNexusMcpHttpServerOptions,
): Promise<void> {
  const running = await startPharoNexusMcpHttpServer(options);
  process.stderr.write(`PharoNexus MCP HTTP server listening at ${running.url}\n`);
  await new Promise<void>((resolve) => {
    running.server.once("close", resolve);
  });
}
