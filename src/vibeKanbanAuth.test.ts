import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  initPharoNexusHome,
  loadHomeConfig,
  saveHomeConfig,
} from "./config.js";
import {
  ensureVibeKanbanSelfHostedLogin,
  readVibeKanbanLocalAuthCredentials,
} from "./vibeKanbanAuth.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

function makeHomeWithEnvFile(content: string): string {
  const homePath = fs.mkdtempSync(path.join(os.tmpdir(), "pharo-nexus-home-"));
  initPharoNexusHome({ homePath });
  const remoteRoot = path.join(homePath, "vibe-kanban", "crates", "remote");
  fs.mkdirSync(remoteRoot, { recursive: true });
  const envFile = path.join(remoteRoot, ".env.remote");
  fs.writeFileSync(envFile, content, "utf8");

  const config = loadHomeConfig(homePath);
  config.integrations.vibeKanban.backend = {
    mode: "docker",
    sharedApiBase: "http://127.0.0.1:3100",
    healthPath: "/v1/health",
    sourceRepositoryUrl: "https://github.com/BloopAI/vibe-kanban.git",
    autoBootstrap: true,
    composeCommand: "auto",
    composeArgs: [],
    composeFile: path.join(remoteRoot, "docker-compose.yml"),
    envFile,
    projectName: "pharo-nexus-vibe",
    workingDirectory: remoteRoot,
    startOnPharoNexusStart: true,
    stopOnPharoNexusStop: true,
  };
  saveHomeConfig(homePath, config);

  return homePath;
}

describe("Vibe Kanban auth", () => {
  it("reads managed self-hosted local auth credentials from the backend env file", () => {
    const homePath = makeHomeWithEnvFile(
      [
        "SELF_HOST_LOCAL_AUTH_EMAIL=admin@example.test",
        "SELF_HOST_LOCAL_AUTH_PASSWORD=secret-password",
      ].join("\n"),
    );

    expect(readVibeKanbanLocalAuthCredentials(loadHomeConfig(homePath))).toMatchObject({
      email: "admin@example.test",
      password: "secret-password",
    });

    fs.rmSync(homePath, { recursive: true, force: true });
  });

  it("signs into the local Vibe app when managed self-hosted auth is configured", async () => {
    const homePath = makeHomeWithEnvFile(
      [
        "SELF_HOST_LOCAL_AUTH_EMAIL=admin@example.test",
        "SELF_HOST_LOCAL_AUTH_PASSWORD=secret-password",
      ].join("\n"),
    );
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/auth/status") {
        return jsonResponse({
          success: true,
          data: {
            logged_in: false,
          },
        });
      }

      if (url === "http://127.0.0.1:3000/api/auth/local/login") {
        expect(init).toMatchObject({
          method: "POST",
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          email: "admin@example.test",
          password: "secret-password",
        });
        return jsonResponse({
          success: true,
          data: {
            user_id: "user-1",
            email: "admin@example.test",
            providers: [],
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      ensureVibeKanbanSelfHostedLogin({
        port: 3000,
        config: loadHomeConfig(homePath),
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      status: "logged-in",
      attempted: true,
      loggedIn: true,
      email: "admin@example.test",
    });

    fs.rmSync(homePath, { recursive: true, force: true });
  });

  it("does not sign in again when Vibe already reports a logged-in session", async () => {
    const homePath = makeHomeWithEnvFile(
      [
        "SELF_HOST_LOCAL_AUTH_EMAIL=admin@example.test",
        "SELF_HOST_LOCAL_AUTH_PASSWORD=secret-password",
      ].join("\n"),
    );
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/auth/status") {
        return jsonResponse({
          success: true,
          data: {
            logged_in: true,
          },
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      ensureVibeKanbanSelfHostedLogin({
        port: 3000,
        config: loadHomeConfig(homePath),
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      status: "already-logged-in",
      attempted: false,
      loggedIn: true,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fs.rmSync(homePath, { recursive: true, force: true });
  });
});
