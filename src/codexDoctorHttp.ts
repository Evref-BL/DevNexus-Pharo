import type { CodexDoctorCheck } from "./codexConfig.js";

export interface HttpMcpServerCheck {
  name: string;
  url: string;
  healthPath: string;
  expectedTools: string[];
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function postJsonRpc(
  fetchImpl: typeof fetch,
  url: string,
  method: string,
  timeoutMs: number,
): Promise<unknown> {
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(method === "initialize"
          ? {
              params: {
                protocolVersion: "2024-11-05",
                capabilities: {},
                clientInfo: {
                  name: "dev-nexus-pharo-codex-doctor",
                  version: "0.1.0",
                },
              },
            }
          : {}),
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

function jsonRpcResultRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MCP response is not an object");
  }

  const record = value as Record<string, unknown>;
  if (record.error) {
    throw new Error("MCP response contains an error");
  }
  if (!record.result || typeof record.result !== "object" || Array.isArray(record.result)) {
    throw new Error("MCP response result is not an object");
  }

  return record.result as Record<string, unknown>;
}

function listedToolNames(value: unknown): string[] {
  const result = jsonRpcResultRecord(value);
  const tools = result.tools;
  if (!Array.isArray(tools)) {
    throw new Error("tools/list response is missing tools");
  }

  return tools.flatMap((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
      return [];
    }

    const name = (tool as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
}

export async function checkHttpMcpServer(
  options: HttpMcpServerCheck & {
    fetch: typeof fetch;
    timeoutMs: number;
  },
): Promise<CodexDoctorCheck[]> {
  const checks: CodexDoctorCheck[] = [];
  const healthUrl = new URL(options.healthPath, options.url).toString();

  try {
    const health = await fetchWithTimeout(options.fetch, healthUrl, {}, options.timeoutMs);
    if (!health.ok) {
      checks.push({
        name: `${options.name}:health`,
        status: "failed",
        message: `Health check failed with HTTP ${health.status}`,
      });
      return checks;
    }

    checks.push({
      name: `${options.name}:health`,
      status: "ok",
      message: `Health check passed at ${healthUrl}`,
    });
  } catch (error) {
    checks.push({
      name: `${options.name}:health`,
      status: "failed",
      message: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }

  try {
    jsonRpcResultRecord(
      await postJsonRpc(options.fetch, options.url, "initialize", options.timeoutMs),
    );
    checks.push({
      name: `${options.name}:initialize`,
      status: "ok",
      message: "MCP initialize succeeded",
    });
  } catch (error) {
    checks.push({
      name: `${options.name}:initialize`,
      status: "failed",
      message: `MCP initialize failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return checks;
  }

  try {
    const toolNames = listedToolNames(
      await postJsonRpc(options.fetch, options.url, "tools/list", options.timeoutMs),
    );
    const missingTools = options.expectedTools.filter((tool) => !toolNames.includes(tool));
    checks.push({
      name: `${options.name}:tools`,
      status: missingTools.length === 0 ? "ok" : "failed",
      message:
        missingTools.length === 0
          ? `Found expected tools: ${options.expectedTools.join(", ")}`
          : `Missing expected tools: ${missingTools.join(", ")}`,
    });
  } catch (error) {
    checks.push({
      name: `${options.name}:tools`,
      status: "failed",
      message: `MCP tools/list failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  return checks;
}
