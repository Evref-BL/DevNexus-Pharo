import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  initPharoNexusHome,
  loadHomeConfig,
  saveHomeConfig,
} from "./config.js";
import {
  buildPharoNexusMcpServerConfig,
  buildPlexusMcpServerConfig,
  getVibeKanbanMcpConfig,
  installPharoNexusAndPlexusMcpForExecutor,
  installPlexusMcpForExecutor,
  mergeMcpServerConfig,
  normalizeVibeKanbanExecutor,
  updateVibeKanbanMcpConfig,
  vibeKanbanApiBaseUrl,
  VibeKanbanMcpConfigError,
} from "./vibeKanbanMcpConfig.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function readRequestBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Buffer));
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startFakeVibeKanbanApi(): Promise<{
  port: number;
  server: http.Server;
  posts: unknown[];
  executorQueries: string[];
}> {
  const posts: unknown[] = [];
  const executorQueries: string[] = [];
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/api/mcp-config") {
      response.statusCode = 404;
      response.end();
      return;
    }

    executorQueries.push(url.searchParams.get("executor") ?? "");

    if (request.method === "GET") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          success: true,
          data: {
            mcp_config: {
              servers: {
                existing: {
                  command: "node",
                  args: ["existing.js"],
                },
              },
              servers_path: ["mcpServers"],
            },
            config_path: "C:\\Users\\example\\.codex\\config.json",
          },
        }),
      );
      return;
    }

    if (request.method === "POST") {
      posts.push(await readRequestBody(request));
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          success: true,
          data: "Updated MCP server configuration",
        }),
      );
      return;
    }

    response.statusCode = 405;
    response.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return { port: address.port, server, posts, executorQueries };
}

function initHome(): string {
  const homePath = makeTempDir("pharo-nexus-home-");
  initPharoNexusHome({ homePath });
  const config = loadHomeConfig(homePath);
  config.tools.plexus = {
    command: "plexus-gateway",
    args: ["--stdio"],
  };
  config.ports.plexusMcp = 7331;
  saveHomeConfig(homePath, config);
  return homePath;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Vibe Kanban MCP config adapter", () => {
  it("normalizes supported executor aliases", () => {
    expect(normalizeVibeKanbanExecutor("codex")).toBe("CODEX");
    expect(normalizeVibeKanbanExecutor("claude-code")).toBe("CLAUDE_CODE");
    expect(normalizeVibeKanbanExecutor("cursor")).toBe("CURSOR_AGENT");
  });

  it("validates Vibe Kanban API ports before generating request URLs", () => {
    expect(vibeKanbanApiBaseUrl({ port: 1 })).toBe("http://127.0.0.1:1");
    expect(vibeKanbanApiBaseUrl({ host: "localhost", port: 65_535 })).toBe(
      "http://localhost:65535",
    );

    for (const port of [0, -1, 65_536, 3.14]) {
      expect(() => vibeKanbanApiBaseUrl({ port })).toThrow(
        VibeKanbanMcpConfigError,
      );
    }
  });

  it("builds the PLexus MCP server config as a supervised HTTP connection", () => {
    const homePath = initHome();
    const config = loadHomeConfig(homePath);

    expect(buildPlexusMcpServerConfig(homePath, config)).toEqual({
      type: "http",
      url: "http://127.0.0.1:7331/mcp",
    });
  });

  it("builds the PharoNexus MCP server config from PharoNexus home config", () => {
    const homePath = initHome();
    const config = loadHomeConfig(homePath);
    config.ports.pharoNexusMcp = 7440;
    saveHomeConfig(homePath, config);

    expect(buildPharoNexusMcpServerConfig(homePath, config)).toEqual({
      type: "http",
      url: "http://127.0.0.1:7440/mcp",
    });
  });

  it("merges the PLexus server without dropping existing MCP servers", () => {
    expect(
      mergeMcpServerConfig(
        {
          existing: {
            command: "node",
            args: ["existing.js"],
          },
        },
        "plexus",
        {
          command: "plexus-gateway",
          args: [],
        },
      ),
    ).toEqual({
      existing: {
        command: "node",
        args: ["existing.js"],
      },
      plexus: {
        command: "plexus-gateway",
        args: [],
      },
    });
  });

  it("preserves existing MCP servers that omit args by normalizing args to an empty array", () => {
    expect(
      mergeMcpServerConfig(
        {
          pharo: {
            command: "pharo-mcp",
          } as never,
        },
        "plexus",
        {
          command: "plexus-gateway",
          args: [],
        },
      ),
    ).toEqual({
      pharo: {
        command: "pharo-mcp",
        args: [],
      },
      plexus: {
        command: "plexus-gateway",
        args: [],
      },
    });
  });

  it("preserves existing incomplete MCP servers that omit command", () => {
    expect(
      mergeMcpServerConfig(
        {
          pharo: {
            description: "User-managed Pharo MCP entry",
          } as never,
        },
        "plexus",
        {
          command: "plexus-gateway",
          args: [],
        },
      ),
    ).toEqual({
      pharo: {
        description: "User-managed Pharo MCP entry",
      },
      plexus: {
        command: "plexus-gateway",
        args: [],
      },
    });
  });

  it("reads and updates Vibe Kanban MCP config through the REST API shape", async () => {
    const api = await startFakeVibeKanbanApi();

    try {
      await expect(
        getVibeKanbanMcpConfig({
          port: api.port,
          executor: "codex",
        }),
      ).resolves.toMatchObject({
        mcpConfig: {
          servers: {
            existing: {
              command: "node",
              args: ["existing.js"],
            },
          },
          serversPath: ["mcpServers"],
          configPath: "C:\\Users\\example\\.codex\\config.json",
        },
      });

      await updateVibeKanbanMcpConfig({
        port: api.port,
        executor: "codex",
        servers: {
          plexus: {
            command: "plexus-gateway",
            args: [],
          },
        },
      });

      expect(api.executorQueries).toEqual(["CODEX", "CODEX"]);
      expect(api.posts).toEqual([
        {
          servers: {
            plexus: {
              command: "plexus-gateway",
              args: [],
            },
          },
        },
      ]);
    } finally {
      await closeServer(api.server);
    }
  });

  it("installs PLexus MCP config for one executor while preserving existing servers", async () => {
    const homePath = initHome();
    const api = await startFakeVibeKanbanApi();

    try {
      await expect(
        installPlexusMcpForExecutor({
          homePath,
          port: api.port,
          executor: "codex",
        }),
      ).resolves.toMatchObject({
        executor: "CODEX",
        serverName: "plexus",
        updated: true,
      });

      expect(api.posts).toEqual([
        {
          servers: {
            existing: {
              command: "node",
              args: ["existing.js"],
            },
            plexus: {
              type: "http",
              url: "http://127.0.0.1:7331/mcp",
            },
          },
        },
      ]);
    } finally {
      await closeServer(api.server);
    }
  });

  it("installs PharoNexus and PLexus MCP configs in one Vibe Kanban update", async () => {
    const homePath = initHome();
    const config = loadHomeConfig(homePath);
    config.tools.pharoNexus = {
      command: "pharo-nexus",
      args: ["mcp"],
    };
    config.integrations.vibeKanban.pharoNexusMcpServerName = "pharo_nexus_local";
    config.integrations.vibeKanban.plexusMcpServerName = "plexus_local";
    saveHomeConfig(homePath, config);
    const api = await startFakeVibeKanbanApi();

    try {
      await expect(
        installPharoNexusAndPlexusMcpForExecutor({
          homePath,
          config,
          port: api.port,
          executor: "codex",
        }),
      ).resolves.toMatchObject({
        executor: "CODEX",
        pharoNexus: {
          serverName: "pharo_nexus_local",
        },
        plexus: {
          serverName: "plexus_local",
        },
        updated: true,
      });

      expect(api.posts).toEqual([
        {
          servers: {
            existing: {
              command: "node",
              args: ["existing.js"],
            },
            pharo_nexus_local: {
              type: "http",
              url: "http://127.0.0.1:7330/mcp",
            },
            plexus_local: {
              type: "http",
              url: "http://127.0.0.1:7331/mcp",
            },
          },
        },
      ]);
    } finally {
      await closeServer(api.server);
    }
  });

  it("supports dry-run install without posting updates", async () => {
    const homePath = initHome();
    const api = await startFakeVibeKanbanApi();

    try {
      const result = await installPlexusMcpForExecutor({
        homePath,
        port: api.port,
        executor: "codex",
        dryRun: true,
      });

      expect(result.updated).toBe(false);
      expect(result.servers).toHaveProperty("existing");
      expect(result.servers).toHaveProperty("plexus");
      expect(api.posts).toEqual([]);
    } finally {
      await closeServer(api.server);
    }
  });

  it("uses the supervised PLexus HTTP endpoint even when the service command is custom", async () => {
    const homePath = initHome();
    const config = loadHomeConfig(homePath);
    config.tools.plexus = {
      command: "node",
      args: ["C:\\dev\\code\\git\\PLexus\\dist\\gateway.js", "--stdio"],
    };
    config.paths.plexusStateRoot = path.join(homePath, "custom-state", "plexus");
    config.ports.plexusMcp = 7444;
    saveHomeConfig(homePath, config);
    const api = await startFakeVibeKanbanApi();

    try {
      const result = await installPlexusMcpForExecutor({
        homePath,
        port: api.port,
        executor: "codex",
        serverName: "plexus_generated",
        dryRun: true,
      });

      expect(result).toMatchObject({
        executor: "CODEX",
        serverName: "plexus_generated",
        updated: false,
        server: {
          type: "http",
          url: "http://127.0.0.1:7444/mcp",
        },
        servers: {
          existing: {
            command: "node",
            args: ["existing.js"],
          },
          plexus_generated: {
            type: "http",
            url: "http://127.0.0.1:7444/mcp",
          },
        },
      });
      expect(api.posts).toEqual([]);
    } finally {
      await closeServer(api.server);
    }
  });
});
