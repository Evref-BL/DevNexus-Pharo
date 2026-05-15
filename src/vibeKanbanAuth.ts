import fs from "node:fs";
import type { NexusHomeConfig, VibeKanbanBackendConfig } from "./config.js";
import {
  vibeKanbanApiBaseUrl,
  type VibeKanbanApiOptions,
} from "./vibeKanbanMcpConfig.js";

export interface VibeKanbanLocalAuthCredentials {
  email: string;
  password: string;
  envFile: string;
}

export type VibeKanbanAutoLoginStatus =
  | "already-logged-in"
  | "logged-in"
  | "skipped";

export interface VibeKanbanAutoLoginResult {
  status: VibeKanbanAutoLoginStatus;
  attempted: boolean;
  loggedIn: boolean;
  email?: string;
  reason?: string;
  raw?: {
    status?: unknown;
    login?: unknown;
  };
}

export interface EnsureVibeKanbanSelfHostedLoginOptions
  extends VibeKanbanApiOptions {
  config: NexusHomeConfig;
}

export class VibeKanbanAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeKanbanAuthError";
  }
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VibeKanbanAuthError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function parseApiSuccess(value: unknown): unknown {
  const response = assertRecord(value, "response");
  if (response.success !== true) {
    const message =
      typeof response.message === "string"
        ? response.message
        : typeof response.error === "string"
          ? response.error
          : "Vibe Kanban auth request failed";
    throw new VibeKanbanAuthError(message);
  }

  return response.data;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text.replace(/^\uFEFF/u, ""));
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, init);
  const body = await readJsonResponse(response);

  if (!response.ok) {
    const detail =
      body && typeof body === "object" ? `: ${JSON.stringify(body)}` : "";
    throw new VibeKanbanAuthError(
      `Vibe Kanban auth request failed with HTTP ${response.status}${detail}`,
    );
  }

  return body;
}

function readEnvValue(content: string, key: string): string | undefined {
  const prefix = `${key}=`;
  const line = content
    .split(/\r?\n/u)
    .find((entry) => entry.startsWith(prefix));

  return line?.slice(prefix.length);
}

function managedBackendEnvFile(
  backend: VibeKanbanBackendConfig,
): string | undefined {
  return backend.mode === "docker" || backend.mode === "dind"
    ? backend.envFile
    : undefined;
}

export function readVibeKanbanLocalAuthCredentials(
  config: NexusHomeConfig,
): VibeKanbanLocalAuthCredentials | undefined {
  const envFile = managedBackendEnvFile(config.integrations.vibeKanban.backend);
  if (!envFile || !fs.existsSync(envFile)) {
    return undefined;
  }

  const content = fs.readFileSync(envFile, "utf8").replace(/^\uFEFF/u, "");
  const email = readEnvValue(content, "SELF_HOST_LOCAL_AUTH_EMAIL");
  const password = readEnvValue(content, "SELF_HOST_LOCAL_AUTH_PASSWORD");
  if (!email || !password) {
    return undefined;
  }

  return {
    email,
    password,
    envFile,
  };
}

async function getAuthStatus(
  options: VibeKanbanApiOptions,
  fetchImpl: typeof fetch,
): Promise<{ loggedIn: boolean; raw: unknown }> {
  const url = new URL("/api/auth/status", vibeKanbanApiBaseUrl(options));
  const raw = await requestJson(fetchImpl, url.toString());
  const data = assertRecord(parseApiSuccess(raw), "auth status");
  return {
    loggedIn: data.logged_in === true,
    raw,
  };
}

async function localLogin(
  options: VibeKanbanApiOptions,
  credentials: VibeKanbanLocalAuthCredentials,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const url = new URL("/api/auth/local/login", vibeKanbanApiBaseUrl(options));
  return requestJson(fetchImpl, url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  });
}

export async function ensureVibeKanbanSelfHostedLogin(
  options: EnsureVibeKanbanSelfHostedLoginOptions,
): Promise<VibeKanbanAutoLoginResult> {
  const credentials = readVibeKanbanLocalAuthCredentials(options.config);
  if (!credentials) {
    return {
      status: "skipped",
      attempted: false,
      loggedIn: false,
      reason: "No managed self-hosted local-auth credentials were found.",
    };
  }

  const fetchImpl = options.fetch ?? fetch;
  const status = await getAuthStatus(options, fetchImpl);
  if (status.loggedIn) {
    return {
      status: "already-logged-in",
      attempted: false,
      loggedIn: true,
      email: credentials.email,
      raw: {
        status: status.raw,
      },
    };
  }

  const login = await localLogin(options, credentials, fetchImpl);
  return {
    status: "logged-in",
    attempted: true,
    loggedIn: true,
    email: credentials.email,
    raw: {
      status: status.raw,
      login,
    },
  };
}
