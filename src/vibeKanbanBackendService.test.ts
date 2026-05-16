import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initNexusHome,
  loadHomeConfig,
  saveHomeConfig,
  type NexusHomeConfig,
} from "./config.js";
import {
  getVibeKanbanBackendStatus,
  loadVibeKanbanBackendState,
  startVibeKanbanBackend,
  stopVibeKanbanBackend,
  type VibeKanbanBackendCommandRunner,
} from "./vibeKanbanBackendService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function initHomeWithDockerBackend(): string {
  const homePath = makeTempDir("dev-nexus-pharo-home-");
  initNexusHome({ homePath });
  const config = loadHomeConfig(homePath);
  const remoteRoot = path.join(homePath, "vibe-kanban", "crates", "remote");
  fs.mkdirSync(remoteRoot, { recursive: true });
  fs.writeFileSync(path.join(remoteRoot, "docker-compose.yml"), "services: {}\n", "utf8");
  fs.writeFileSync(path.join(remoteRoot, ".env.remote"), "REMOTE_SERVER_PORTS=127.0.0.1:3100:8081\n", "utf8");
  saveHomeConfig(homePath, config);

  return homePath;
}

function initHomeWithDindBackend(): string {
  const homePath = makeTempDir("dev-nexus-pharo-home-");
  initNexusHome({ homePath });
  const config = loadHomeConfig(homePath);
  const sourceRoot = path.join(homePath, "vibe-kanban");
  const remoteRoot = path.join(sourceRoot, "crates", "remote");
  fs.mkdirSync(remoteRoot, { recursive: true });
  fs.writeFileSync(path.join(remoteRoot, "docker-compose.yml"), "services: {}\n", "utf8");
  fs.writeFileSync(path.join(remoteRoot, ".env.remote"), "REMOTE_SERVER_PORTS=0.0.0.0:3100:8081\n", "utf8");
  config.integrations.vibeKanban.backend = {
    mode: "dind",
    sharedApiBase: "http://127.0.0.1:3100",
    healthPath: "/v1/health",
    sourceRepositoryUrl: "https://github.com/BloopAI/vibe-kanban.git",
    sourceRoot,
    autoBootstrap: true,
    dockerCommand: "docker",
    dindImage: "docker:29-dind",
    containerName: "dev-nexus-pharo-vibe-dind",
    dataVolume: "dev-nexus-pharo-vibe-dind-data",
    projectName: "dev-nexus-pharo-vibe",
    composeFile: path.join(remoteRoot, "docker-compose.yml"),
    envFile: path.join(remoteRoot, ".env.remote"),
    workingDirectory: remoteRoot,
    containerSourceRoot: "/workspace/vibe-kanban",
    containerWorkingDirectory: "/workspace/vibe-kanban/crates/remote",
    containerComposeFile: "/workspace/vibe-kanban/crates/remote/docker-compose.yml",
    containerEnvFile: "/workspace/vibe-kanban/crates/remote/.env.remote",
    startOnDevNexusPharoStart: true,
    stopOnDevNexusPharoStop: true,
  };
  saveHomeConfig(homePath, config);

  return homePath;
}

function commandResult(
  command: string,
  args: readonly string[],
  exitCode = 0,
) {
  return {
    command,
    args: [...args],
    stdout: "",
    stderr: "",
    exitCode,
    durationMs: 1,
  };
}

describe("Vibe Kanban Docker backend service", () => {
  it("bootstraps the official Vibe Kanban checkout and env file when missing", async () => {
    vi.stubEnv("DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_ID", "github-client-id");
    vi.stubEnv("DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_SECRET", "github-client-secret");
    vi.stubEnv("DEV_NEXUS_PHARO_VIBE_LOCAL_AUTH_EMAIL", "dev@example.com");
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const remoteRoot = path.join(homePath, "vibe-kanban", "crates", "remote");
    const calls: Array<{
      command: string;
      args: string[];
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }> = [];
    const runner: VibeKanbanBackendCommandRunner = (command, args, options) => {
      calls.push({
        command,
        args: [...args],
        cwd: options?.cwd,
        env: options?.env,
      });
      if (command === "git") {
        fs.mkdirSync(remoteRoot, { recursive: true });
        fs.writeFileSync(
          path.join(remoteRoot, "docker-compose.yml"),
          "services: {}\n",
          "utf8",
        );
      }

      if (
        command === "docker" &&
        (args.join(" ") === "compose version" ||
          args.join(" ") === "buildx version")
      ) {
        return commandResult(command, args, 1);
      }

      return commandResult(command, args, 0);
    };
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    const progressMessages: string[] = [];

    const state = await startVibeKanbanBackend({
      homePath,
      commandRunner: runner,
      fetch: fetchMock,
      healthTimeoutMs: 50,
      progress: (message) => progressMessages.push(message),
    });

    expect(calls[0]).toEqual({
      command: "git",
      args: [
        "clone",
        "--depth",
        "1",
        "https://github.com/BloopAI/vibe-kanban.git",
        path.join(homePath, "vibe-kanban"),
      ],
      cwd: undefined,
    });
    const generatedEnv = fs.readFileSync(
      path.join(remoteRoot, ".env.remote"),
      "utf8",
    );
    expect(generatedEnv).toContain("REMOTE_SERVER_PORTS=127.0.0.1:3100:8081");
    expect(generatedEnv).toContain("GITHUB_OAUTH_CLIENT_ID=github-client-id");
    expect(generatedEnv).toContain(
      "GITHUB_OAUTH_CLIENT_SECRET=github-client-secret",
    );
    expect(generatedEnv).toContain("SELF_HOST_LOCAL_AUTH_EMAIL=dev@example.com");
    expect(state.bootstrap).toMatchObject({
      sourceRoot: path.join(homePath, "vibe-kanban"),
      cloned: true,
      generatedEnvFile: true,
    });
    expect(progressMessages).toEqual(
      expect.arrayContaining([
        "Checking Vibe Kanban Docker backend files...",
        `Cloning Vibe Kanban from https://github.com/BloopAI/vibe-kanban.git into ${path.join(homePath, "vibe-kanban")}...`,
        "Vibe Kanban repository cloned.",
        `Generating Vibe Kanban backend env file at ${path.join(remoteRoot, ".env.remote")}...`,
        "Vibe Kanban backend env file generated.",
        "Resolving Docker Compose command...",
        "Checking Docker BuildKit/buildx availability...",
        "Starting Vibe Kanban Docker backend with docker-compose...",
        "Vibe Kanban backend is healthy.",
      ]),
    );
    expect(state).toMatchObject({
      status: "running",
      command: "docker-compose",
    });
  });

  it("starts the Docker Compose backend, records command state, and stops it", async () => {
    const homePath = initHomeWithDockerBackend();
    const calls: Array<{
      command: string;
      args: string[];
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }> = [];
    const runner: VibeKanbanBackendCommandRunner = (command, args, options) => {
      calls.push({
        command,
        args: [...args],
        cwd: options?.cwd,
        env: options?.env,
      });
      if (
        command === "docker" &&
        (args.join(" ") === "compose version" ||
          args.join(" ") === "buildx version")
      ) {
        return commandResult(command, args, 1);
      }

      return commandResult(command, args, 0);
    };
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

    const state = await startVibeKanbanBackend({
      homePath,
      commandRunner: runner,
      fetch: fetchMock,
      healthTimeoutMs: 50,
    });

    expect(state).toMatchObject({
      service: "vibe-kanban-backend",
      mode: "docker",
      status: "running",
      sharedApiBase: "http://127.0.0.1:3100",
      command: "docker-compose",
    });
    expect(calls.map((call) => [call.command, call.args])).toEqual([
      ["docker", ["compose", "version"]],
      ["docker-compose", ["--version"]],
      ["docker", ["buildx", "version"]],
      ["docker-buildx", ["version"]],
      [
        "docker-compose",
        expect.arrayContaining([
          "--env-file",
          path.join(homePath, "vibe-kanban", "crates", "remote", ".env.remote"),
          "-f",
          path.join(homePath, "vibe-kanban", "crates", "remote", "docker-compose.yml"),
          "-p",
          "dev-nexus-pharo-vibe",
          "up",
          "-d",
          "--build",
        ]),
      ],
    ]);
    expect(calls[4]?.env).toMatchObject({
      DOCKER_BUILDKIT: "1",
      COMPOSE_DOCKER_CLI_BUILD: "1",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/v1/health",
      expect.any(Object),
    );
    expect(loadVibeKanbanBackendState(homePath)).toMatchObject({
      status: "running",
      command: "docker-compose",
    });

    const stopped = await stopVibeKanbanBackend({
      homePath,
      commandRunner: runner,
    });

    expect(stopped.state).toMatchObject({
      status: "stopped",
      command: "docker-compose",
    });
    expect(calls.at(-1)).toMatchObject({
      command: "docker-compose",
      args: expect.arrayContaining(["down"]),
    });
  });

  it("syncs GitHub OAuth defaults into an existing backend env file before starting", async () => {
    vi.stubEnv("DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_ID", "existing-client-id");
    vi.stubEnv(
      "DEV_NEXUS_PHARO_GITHUB_OAUTH_CLIENT_SECRET",
      "existing-client-secret",
    );
    vi.stubEnv("DEV_NEXUS_PHARO_VIBE_LOCAL_AUTH_EMAIL", "existing@example.com");
    const homePath = initHomeWithDockerBackend();
    const envFile = path.join(
      homePath,
      "vibe-kanban",
      "crates",
      "remote",
      ".env.remote",
    );
    const runner: VibeKanbanBackendCommandRunner = (command, args) => {
      if (
        command === "docker" &&
        (args.join(" ") === "compose version" ||
          args.join(" ") === "buildx version")
      ) {
        return commandResult(command, args, 1);
      }

      return commandResult(command, args, 0);
    };
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

    await startVibeKanbanBackend({
      homePath,
      commandRunner: runner,
      fetch: fetchMock,
      healthTimeoutMs: 50,
    });

    const updatedEnv = fs.readFileSync(envFile, "utf8");
    expect(updatedEnv).toContain("GITHUB_OAUTH_CLIENT_ID=existing-client-id");
    expect(updatedEnv).toContain(
      "GITHUB_OAUTH_CLIENT_SECRET=existing-client-secret",
    );
  });

  it("starts the DinD backend, records command state, and stops it", async () => {
    const homePath = initHomeWithDindBackend();
    const calls: Array<{
      command: string;
      args: string[];
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    }> = [];
    let containerExists = false;
    let containerRunning = false;
    const runner: VibeKanbanBackendCommandRunner = (command, args, options) => {
      calls.push({
        command,
        args: [...args],
        cwd: options?.cwd,
        env: options?.env,
      });
      if (args[0] === "inspect") {
        return {
          ...commandResult(command, args, containerExists ? 0 : 1),
          stdout: containerRunning ? "true\n" : "false\n",
        };
      }

      if (args[0] === "run") {
        containerExists = true;
        containerRunning = true;
      }

      if (args[0] === "stop") {
        containerRunning = false;
      }

      return commandResult(command, args, 0);
    };
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

    const state = await startVibeKanbanBackend({
      homePath,
      commandRunner: runner,
      fetch: fetchMock,
      healthTimeoutMs: 50,
    });

    expect(state).toMatchObject({
      service: "vibe-kanban-backend",
      mode: "dind",
      status: "running",
      sharedApiBase: "http://127.0.0.1:3100",
      command: "docker",
    });
    expect(calls.map((call) => [call.command, call.args])).toEqual([
      [
        "docker",
        ["inspect", "--format", "{{.State.Running}}", "dev-nexus-pharo-vibe-dind"],
      ],
      [
        "docker",
        expect.arrayContaining([
          "run",
          "-d",
          "--privileged",
          "--name",
          "dev-nexus-pharo-vibe-dind",
          "-p",
          "127.0.0.1:3100:3100",
          "-v",
          `${path.join(homePath, "vibe-kanban")}:/workspace/vibe-kanban`,
          "-v",
          "dev-nexus-pharo-vibe-dind-data:/var/lib/docker",
          "docker:29-dind",
        ]),
      ],
      ["docker", ["exec", "dev-nexus-pharo-vibe-dind", "docker", "info"]],
      [
        "docker",
        ["exec", "dev-nexus-pharo-vibe-dind", "docker", "compose", "version"],
      ],
      [
        "docker",
        ["exec", "dev-nexus-pharo-vibe-dind", "rm", "-f", "/tmp/dev-nexus-pharo-ssh-agent.sock"],
      ],
      [
        "docker",
        [
          "exec",
          "dev-nexus-pharo-vibe-dind",
          "ssh-agent",
          "-a",
          "/tmp/dev-nexus-pharo-ssh-agent.sock",
        ],
      ],
      [
        "docker",
        expect.arrayContaining([
          "exec",
          "-w",
          "/workspace/vibe-kanban/crates/remote",
          "dev-nexus-pharo-vibe-dind",
          "docker",
          "compose",
          "down",
          "--remove-orphans",
        ]),
      ],
      [
        "docker",
        [
          "exec",
          "dev-nexus-pharo-vibe-dind",
          "docker",
          "volume",
          "rm",
          "dev-nexus-pharo-vibe_electric-data",
        ],
      ],
      [
        "docker",
        expect.arrayContaining([
          "exec",
          "-w",
          "/workspace/vibe-kanban/crates/remote",
          "-e",
          "REMOTE_SERVER_PORTS=0.0.0.0:3100:8081",
          "-e",
          "SSH_AUTH_SOCK=/tmp/dev-nexus-pharo-ssh-agent.sock",
          "dev-nexus-pharo-vibe-dind",
          "docker",
          "compose",
          "--env-file",
          "/workspace/vibe-kanban/crates/remote/.env.remote",
          "-f",
          "/workspace/vibe-kanban/crates/remote/docker-compose.yml",
          "-p",
          "dev-nexus-pharo-vibe",
          "up",
          "-d",
          "--build",
        ]),
      ],
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:3100/v1/health",
      expect.any(Object),
    );

    const stopped = await stopVibeKanbanBackend({
      homePath,
      commandRunner: runner,
    });

    expect(stopped.state).toMatchObject({
      status: "stopped",
      command: "docker",
    });
    expect(calls.at(-2)).toMatchObject({
      command: "docker",
      args: expect.arrayContaining(["down"]),
    });
    expect(calls.at(-1)).toMatchObject({
      command: "docker",
      args: ["stop", "dev-nexus-pharo-vibe-dind"],
    });
  });

  it("reports external backend health without running Docker", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const config = loadHomeConfig(homePath);
    config.integrations.vibeKanban.backend = {
      mode: "external",
      sharedApiBase: "https://kanban.example.com",
      healthPath: "/v1/health",
      startOnDevNexusPharoStart: false,
      stopOnDevNexusPharoStop: false,
    };
    saveHomeConfig(homePath, config as NexusHomeConfig);
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));

    const status = await getVibeKanbanBackendStatus({
      homePath,
      checkHealth: true,
      fetch: fetchMock,
    });

    expect(status).toMatchObject({
      running: true,
      stale: false,
      health: {
        ok: true,
        statusCode: 200,
        url: "https://kanban.example.com/v1/health",
      },
      state: {
        mode: "external",
        status: "external",
      },
    });
  });
});
