import fs from "node:fs";
import {
  ensureVibeKanbanLocalLogin,
  type VibeKanbanApiOptions,
  type VibeKanbanAutoLoginResult,
  type VibeKanbanLocalAuthCredentials,
} from "dev-nexus";
import type { NexusHomeConfig, VibeKanbanBackendConfig } from "./config.js";

export type {
  VibeKanbanAutoLoginResult,
  VibeKanbanAutoLoginStatus,
  VibeKanbanLocalAuthCredentials,
} from "dev-nexus";

export interface EnsureVibeKanbanSelfHostedLoginOptions
  extends VibeKanbanApiOptions {
  config: NexusHomeConfig;
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

  return ensureVibeKanbanLocalLogin({
    ...options,
    credentials,
  });
}
