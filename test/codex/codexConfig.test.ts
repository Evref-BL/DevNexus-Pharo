import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultHomeConfig,
  initNexusHome,
  loadHomeConfig,
  saveProjectConfig,
  saveHomeConfig,
} from "../../src/config.js";
import { devNexusPharoProjectExtensionConfigKey } from "../../src/devNexusPharoExtension.js";
import { devNexusPharoDevNexusPluginConfig } from "../../src/devNexusPharoPlugin.js";
import {
  buildCodexMcpServers,
  codexConfigPath,
  doctorCodexWorkspace,
  initCodexWorkspace,
  mergeCodexMcpServersIntoToml,
} from "../../src/codexConfig.js";

const tempDirs: string[] = [];
const servers: http.Server[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function writeDevNexusWorkerContext(
  worktreePath: string,
  context: {
    projectRoot: string;
    projectId: string;
    projectName: string;
    componentId: string;
    sourceRoot: string;
    worktreesRoot: string;
    branchName: string;
    workItemId?: string;
    dependencyProjections?: Array<Record<string, unknown>>;
  },
): void {
  const contextDirectory = path.join(worktreePath, ".dev-nexus", "context");
  fs.mkdirSync(contextDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(contextDirectory, "context.json"),
    `${JSON.stringify(
      {
        version: 1,
        project: {
          id: context.projectId,
          name: context.projectName,
          root: context.projectRoot,
        },
        projectRoot: context.projectRoot,
        component: {
          id: context.componentId,
          sourceRoot: context.sourceRoot,
        },
        worktree: {
          componentId: context.componentId,
          sourceRoot: context.sourceRoot,
          worktreesRoot: context.worktreesRoot,
          worktreePath,
          branchName: context.branchName,
          ...(context.workItemId
            ? { workItem: { id: context.workItemId, title: "Mapped work" } }
            : {}),
        },
        ...(context.dependencyProjections
          ? {
              dependencySupport: {
                pluginDependencyProjections: context.dependencyProjections,
              },
            }
          : {}),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

function writeBaselinePackage(
  workspacePath: string,
  baseline: string,
): void {
  const packagePath = path.join(
    workspacePath,
    "src",
    `BaselineOf${baseline}`,
  );
  fs.mkdirSync(packagePath, { recursive: true });
  fs.writeFileSync(
    path.join(packagePath, `BaselineOf${baseline}.class.st`),
    `Class { #name : 'BaselineOf${baseline}', #superclass : 'BaselineOf' }\n`,
    "utf8",
  );
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

async function startFakeMcpServer(toolNames: string[]): Promise<{ port: number }> {
  const server = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/health") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ ok: true }));
        return;
      }

      if (request.method !== "POST" || url.pathname !== "/mcp") {
        response.statusCode = 404;
        response.end();
        return;
      }

      const body = await readRequestBody(request) as { id?: unknown; method?: string };
      if (body.method === "initialize") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            capabilities: { tools: {} },
          },
        }));
        return;
      }

      if (body.method === "tools/list") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: toolNames.map((name) => ({ name })),
          },
        }));
        return;
      }

      response.statusCode = 400;
      response.end();
    })().catch((error: unknown) => {
      response.statusCode = 500;
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }

  return { port: address.port };
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await closeServer(server);
  }
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("Codex config", () => {
  it("auto-approves DevNexus-Pharo-managed MCP tools by default", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath);

    expect(buildCodexMcpServers(homePath, config)).toMatchObject({
      dev_nexus_pharo: {
        defaultToolsApprovalMode: "approve",
      },
      plexus: {
        defaultToolsApprovalMode: "approve",
      },
    });
  });

  it("merges managed MCP servers without dropping unrelated TOML", () => {
    const merged = mergeCodexMcpServersIntoToml(
      [
        'model = "gpt-5.3-codex"',
        "",
        "[mcp_servers.keep]",
        'command = "node"',
        'args = ["keep.js"]',
        "",
        "[mcp_servers.dev_nexus_pharo]",
        'command = "stale-dev-nexus-pharo"',
        "",
        "[mcp_servers.dev_nexus_pharo.env]",
        'DEV_NEXUS_PHARO_HOME = "stale"',
      ].join("\n"),
      {
        dev_nexus_pharo: {
          type: "http",
          enabled: true,
          required: true,
          url: "http://127.0.0.1:7330/mcp",
        },
      },
    );

    expect(merged).toContain('model = "gpt-5.3-codex"');
    expect(merged).toContain("[mcp_servers.keep]");
    expect(merged).toContain('args = ["keep.js"]');
    expect(merged).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(merged).toContain('type = "http"');
    expect(merged).toContain('url = "http://127.0.0.1:7330/mcp"');
    expect(merged).not.toContain("stale-dev-nexus-pharo");
    expect(merged).not.toContain("DEV_NEXUS_PHARO_HOME");
  });

  it("writes DevNexus-Pharo and PLexus MCP entries to a workspace", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");
    const configPath = codexConfigPath(workspacePath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      ['model = "gpt-5.3-codex"', "", "[mcp_servers.keep]", 'command = "node"'].join("\n"),
      "utf8",
    );

    const result = initCodexWorkspace({ homePath, workspacePath });
    const content = fs.readFileSync(configPath, "utf8");

    expect(result.updated).toBe(true);
    expect(content).toContain('model = "gpt-5.3-codex"');
    expect(content).toContain("[mcp_servers.keep]");
    expect(content).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(content).toContain('type = "http"');
    expect(content).toContain('url = "http://127.0.0.1:7330/mcp"');
    expect(content).toContain("[mcp_servers.plexus]");
    expect(content).toContain('url = "http://127.0.0.1:7331/mcp"');
    expect(content.match(/default_tools_approval_mode = "approve"/gu)).toHaveLength(2);
  });

  it("writes scoped PLexus gateway MCP entries for DevNexus-Pharo project workspaces", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-project-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "pharo-project",
      name: "Pharo Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
    });

    const result = initCodexWorkspace({ homePath, workspacePath: projectRoot });
    const plexusProjectConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "plexus.project.json"), "utf8"),
    );
    const gatewayPort = plexusProjectConfig.runtime.gateway.port;

    expect(result.servers.pharo_gateway).toMatchObject({
      type: "http",
      enabled: true,
      url: `http://127.0.0.1:${gatewayPort}/mcp`,
      defaultToolsApprovalMode: "approve",
    });
    expect(result.servers.route_control).toMatchObject({
      type: "http",
      enabled: true,
      url: `http://127.0.0.1:${gatewayPort}/control-mcp`,
      defaultToolsApprovalMode: "approve",
    });
    expect(result.servers.plexus_project).toMatchObject({
      env: {
        PLEXUS_PROJECT_ROOT: path.resolve(projectRoot),
        PLEXUS_PROJECT_ID: "pharo-project",
        PLEXUS_WORKSPACE_ID: path.basename(projectRoot),
        PLEXUS_WORKSPACE_ROOT: path.resolve(projectRoot),
        PLEXUS_WORKSPACE_SOURCE_PATH: path.resolve(projectRoot),
        PLEXUS_TARGET_ID: `pharo-project--${path.basename(projectRoot)}`,
        PLEXUS_STATE_ROOT: path.join(homePath, "state", "plexus"),
      },
    });
    expect(result.content).toContain("[mcp_servers.pharo_gateway]");
    expect(result.content).toContain("[mcp_servers.route_control]");
    expect(result.content).not.toContain("[mcp_servers.gateway]");
    expect(result.content).not.toContain("[mcp_servers.pharo]");
  });

  it("maps prepared DevNexus worktrees to generic PLexus workspace context", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    const componentSourceRoot = path.join(projectRoot, "sources", "mcp-pharo");
    const worktreesRoot = path.join(projectRoot, "worktrees", "mcp-pharo");
    const worktreePath = path.join(worktreesRoot, "codex-mcp-pharo-github-42");
    fs.mkdirSync(worktreePath, { recursive: true });
    writeBaselinePackage(worktreePath, "MCP");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-pharo",
      name: "Shared Pharo",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "git@github.com:example/shared-pharo.git",
        defaultBranch: "main",
      },
      components: [
        {
          id: "mcp-pharo",
          name: "MCP-Pharo",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:example/mcp-pharo.git",
          defaultBranch: "main",
          sourceRoot: componentSourceRoot,
          relationships: [],
        },
      ],
      worktreesRoot: "worktrees",
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    fs.writeFileSync(
      path.join(projectRoot, "plexus.project.json"),
      `${JSON.stringify(
        {
          id: "shared-pharo",
          name: "Shared Pharo",
          images: [
            {
              id: "dev",
              imageName: "shared-pharo-{workspaceId}-dev",
              active: true,
              mcp: { loadScript: null },
              create: {
                kind: "template",
                profileId: "pharo-13-default",
                templateName: "Pharo 13.0 - 64bit",
                templateCategory: "Official",
              },
              git: { transport: "https" },
            },
          ],
          imageExecution: {
            mode: "scoped-project-local",
            requireDisposableImage: true,
            requireCleanupPlan: true,
            docker: {
              image: null,
              network: "none",
              autoRemove: true,
              mountProjectReadOnly: true,
            },
          },
          runtime: {
            gateway: {
              mode: "project-local",
              host: "127.0.0.1",
              port: 17577,
              agentMcpServerName: "pharo_gateway",
              agentMcpPath: "/mcp",
              routeControlMcpPath: "/control-mcp",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    writeDevNexusWorkerContext(worktreePath, {
      projectRoot,
      projectId: "shared-pharo",
      projectName: "Shared Pharo",
      componentId: "mcp-pharo",
      sourceRoot: componentSourceRoot,
      worktreesRoot,
      branchName: "codex/mcp-pharo/github-42",
      workItemId: "github-42",
    });
    const configPath = codexConfigPath(worktreePath);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      ["[mcp_servers.keep]", 'command = "node"'].join("\n"),
      "utf8",
    );

    const result = initCodexWorkspace({
      homePath,
      workspacePath: worktreePath,
      config: loadHomeConfig(homePath),
    });

    expect(Object.keys(result.servers)).toEqual([
      "dev_nexus",
      "dev_nexus_pharo",
      "plexus_project",
      "pharo_launcher",
      "pharo_gateway",
    ]);
    expect(result.servers.plexus_project).toMatchObject({
      env: {
        PLEXUS_PROJECT_ROOT: path.resolve(projectRoot),
        PLEXUS_PROJECT_ID: "shared-pharo",
        PLEXUS_WORKSPACE_ID: "mcp-pharo--github-42",
        PLEXUS_WORKSPACE_ROOT: path.resolve(worktreePath),
        PLEXUS_WORKSPACE_SOURCE_PATH: path.resolve(worktreePath),
        PLEXUS_TARGET_ID: "shared-pharo--mcp-pharo--github-42",
        PLEXUS_STATE_ROOT: path.join(homePath, "state", "plexus"),
      },
    });
    expect(result.servers.pharo_launcher).toMatchObject({
      env: {
        PLEXUS_WORKSPACE_SOURCE_PATH: path.resolve(worktreePath),
        PLEXUS_IMAGE_LEASE_OWNER_ID: "shared-pharo--mcp-pharo--github-42",
        PLEXUS_IMAGE_LEASE_OWNER_KIND: "target",
        PLEXUS_IMAGE_LEASE_REPOSITORY_PATH: path.resolve(worktreePath),
        PLEXUS_IMAGE_LEASE_BRANCH: "codex/mcp-pharo/github-42",
      },
    });
    expect(result.servers.route_control).toBeUndefined();
    expect(result.content).not.toContain("[mcp_servers.route_control]");
    expect(result.content).toContain("[mcp_servers.keep]");

    const plexusProjectConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "plexus.project.json"), "utf8"),
    );
    expect(plexusProjectConfig.images).toEqual([
      expect.objectContaining({
        id: "dev",
        mcp: {
          loadScript: "pharo/load-mcp.st",
        },
        create: {
          kind: "template",
          profileId: "pharo-13-default",
          templateName: "Pharo 13.0 - 64bit (stable)",
        },
        repositoryWorkspace: {
          repository: {
            id: "mcp-pharo",
            componentId: "mcp-pharo",
            remoteUrl: "git@github.com:example/mcp-pharo.git",
          },
          sourceDirectory: "src",
          baseline: "MCP",
          branch: "codex/mcp-pharo/github-42",
          baseBranch: "main",
          materialization: {
            strategy: "copy",
          },
        },
      }),
    ]);
    expect(
      plexusProjectConfig.images[0].repositoryWorkspace.repository.originPath,
    ).toBeUndefined();
  });

  it("projects active source dependency worktrees to PLexus repository workspaces", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    const primarySourceRoot = path.join(projectRoot, "sources", "mcp-pharo");
    const dependencySourceRoot = path.join(projectRoot, "sources", "pharo-support");
    const primaryWorktreesRoot = path.join(projectRoot, "worktrees", "mcp-pharo");
    const dependencyWorktreesRoot = path.join(
      projectRoot,
      "worktrees",
      "pharo-support",
    );
    const worktreePath = path.join(primaryWorktreesRoot, "codex-mcp-pharo-github-44");
    const dependencyWorktreePath = path.join(
      dependencyWorktreesRoot,
      "codex-pharo-support-github-44",
    );
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.mkdirSync(dependencyWorktreePath, { recursive: true });
    writeBaselinePackage(worktreePath, "MCP");
    writeBaselinePackage(dependencyWorktreePath, "PharoSupport");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-pharo",
      name: "Shared Pharo",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "git@github.com:example/shared-pharo.git",
        defaultBranch: "main",
      },
      components: [
        {
          id: "mcp-pharo",
          name: "MCP-Pharo",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:example/mcp-pharo.git",
          defaultBranch: "main",
          sourceRoot: primarySourceRoot,
          relationships: [{ kind: "related", componentId: "pharo-support" }],
        },
        {
          id: "pharo-support",
          name: "Pharo Support",
          kind: "git",
          role: "dependency",
          remoteUrl: "git@github.com:example/pharo-support.git",
          defaultBranch: "main",
          sourceRoot: dependencySourceRoot,
          relationships: [],
        },
      ],
      worktreesRoot: "worktrees",
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    writeDevNexusWorkerContext(worktreePath, {
      projectRoot,
      projectId: "shared-pharo",
      projectName: "Shared Pharo",
      componentId: "mcp-pharo",
      sourceRoot: primarySourceRoot,
      worktreesRoot: primaryWorktreesRoot,
      branchName: "codex/mcp-pharo/github-44",
      workItemId: "github-44",
      dependencyProjections: [
        {
          id: "pharo-support-source",
          sourceControl: "source",
          sourcePath: dependencySourceRoot,
          targetPath: dependencyWorktreePath,
          status: "linked",
          sourceComponent: {
            id: "pharo-support",
            sourceRoot: dependencySourceRoot,
          },
        },
      ],
    });

    initCodexWorkspace({
      homePath,
      workspacePath: worktreePath,
      config: loadHomeConfig(homePath),
    });

    const plexusProjectConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "plexus.project.json"), "utf8"),
    );
    const repositoryWorkspaces =
      plexusProjectConfig.images[0].repositoryWorkspaces;
    expect(plexusProjectConfig.images[0].repositoryWorkspace).toBeUndefined();
    expect(repositoryWorkspaces).toEqual([
      {
        repository: {
          id: "mcp-pharo",
          componentId: "mcp-pharo",
          remoteUrl: "git@github.com:example/mcp-pharo.git",
        },
        sourceDirectory: "src",
        baseline: "MCP",
        branch: "codex/mcp-pharo/github-44",
        baseBranch: "main",
        materialization: {
          strategy: "copy",
        },
      },
      {
        repository: {
          id: "pharo-support",
          componentId: "pharo-support",
          remoteUrl: "git@github.com:example/pharo-support.git",
          originPath: path.relative(worktreePath, dependencyWorktreePath),
        },
        sourceDirectory: "src",
        baseline: "PharoSupport",
        baseBranch: "main",
        materialization: {
          strategy: "copy",
        },
      },
    ]);
  });

  it("lets explicit PLexus workspace ids override DevNexus worktree-derived ids", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    const worktreesRoot = path.join(projectRoot, "worktrees", "mcp-pharo");
    const worktreePath = path.join(worktreesRoot, "codex-mcp-pharo-github-43");
    fs.mkdirSync(worktreePath, { recursive: true });
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-dogfood",
      name: "Shared Dogfood",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "git@github.com:example/shared-dogfood.git",
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    writeDevNexusWorkerContext(worktreePath, {
      projectRoot,
      projectId: "shared-dogfood",
      projectName: "Shared Dogfood",
      componentId: "mcp-pharo",
      sourceRoot: path.join(projectRoot, "sources", "mcp-pharo"),
      worktreesRoot,
      branchName: "codex/mcp-pharo/github-43",
      workItemId: "github-43",
    });

    const result = initCodexWorkspace({
      homePath,
      workspacePath: worktreePath,
      workspaceId: "manual-runtime",
      config: loadHomeConfig(homePath),
    });

    expect(result.servers.plexus_project).toMatchObject({
      env: {
        PLEXUS_WORKSPACE_ID: "manual-runtime",
        PLEXUS_WORKSPACE_SOURCE_PATH: path.resolve(worktreePath),
        PLEXUS_TARGET_ID: "shared-dogfood--manual-runtime",
      },
    });
    expect(result.servers.pharo_launcher).toMatchObject({
      env: {
        PLEXUS_IMAGE_LEASE_OWNER_ID: "shared-dogfood--manual-runtime",
        PLEXUS_IMAGE_LEASE_REPOSITORY_PATH: path.resolve(worktreePath),
      },
    });
  });

  it("preserves configured legacy PLexus gateway MCP server names", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-project-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "legacy-pharo-project",
      name: "Legacy Pharo Project",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-legacy-pharo-project",
      },
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
    });
    fs.writeFileSync(
      path.join(projectRoot, "plexus.project.json"),
      JSON.stringify(
        {
          id: "legacy-pharo-project",
          name: "Legacy Pharo Project",
          images: [],
          imageExecution: {
            mode: "disabled",
            requireDisposableImage: true,
            requireCleanupPlan: true,
            docker: {
              image: null,
              network: "none",
              autoRemove: true,
              mountProjectReadOnly: true,
            },
          },
          runtime: {
            gateway: {
              mode: "project-local",
              host: "127.0.0.1",
              port: 17_399,
              agentMcpPath: "/mcp",
              agentMcpServerName: "gateway",
              routeControlMcpPath: "/control-mcp",
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = initCodexWorkspace({ homePath, workspacePath: projectRoot });

    expect(result.servers.gateway).toMatchObject({
      type: "http",
      enabled: true,
      url: "http://127.0.0.1:17399/mcp",
      defaultToolsApprovalMode: "approve",
    });
    expect(result.servers.pharo_gateway).toBeUndefined();
    expect(result.content).toContain("[mcp_servers.gateway]");
    expect(result.content).not.toContain("[mcp_servers.pharo_gateway]");
  });

  it("writes shared DevNexus project MCP entries for DevNexus-Pharo plugin roots", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-dogfood",
      name: "Shared Dogfood",
      home: null,
      repo: {
        kind: "git",
        remoteUrl: "git@github.com:example/shared-dogfood.git",
        defaultBranch: "main",
      },
      components: [
        {
          id: "dev-nexus",
          name: "DevNexus",
          kind: "git",
          role: "primary",
          remoteUrl: "git@github.com:example/dev-nexus.git",
          defaultBranch: "main",
          sourceRoot: "sourcesRoot:dev-nexus",
          relationships: [],
        },
      ],
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        defaultToolsApprovalMode: "approve",
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    const configPath = codexConfigPath(projectRoot);
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      [
        "[mcp_servers.keep]",
        'command = "node"',
        "",
        "[mcp_servers.plexus]",
        'url = "http://127.0.0.1:7331/mcp"',
        "",
        "[mcp_servers.pharo]",
        'command = "plexus-gateway"',
      ].join("\n"),
      "utf8",
    );

    const result = initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
      platform: "darwin",
    });

    expect(Object.keys(result.servers)).toEqual([
      "dev_nexus",
      "dev_nexus_pharo",
      "plexus_project",
      "pharo_launcher",
      "route_control",
      "pharo_gateway",
    ]);
    const plexusProjectConfig = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "plexus.project.json"), "utf8"),
    );
    const gatewayUrl =
      `http://127.0.0.1:${plexusProjectConfig.runtime.gateway.port}/mcp`;
    const routeControlUrl =
      `http://127.0.0.1:${plexusProjectConfig.runtime.gateway.port}/control-mcp`;
    expect(result.content).toContain("[mcp_servers.dev_nexus]");
    expect(result.content).toContain("[mcp_servers.keep]");
    expect(result.content).toContain('command = "dev-nexus"');
    expect(result.content).toContain('args = ["mcp-stdio"]');
    expect(result.content).toContain("[mcp_servers.dev_nexus_pharo]");
    expect(result.content).toContain('command = "dev-nexus-pharo"');
    expect(result.content).toContain("[mcp_servers.plexus_project]");
    expect(result.servers.plexus_project?.command).toBe("plexus");
    expect(result.content).toContain('args = ["mcp", "project"]');
    expect(result.content).toContain("[mcp_servers.pharo_launcher]");
    expect(result.servers.pharo_launcher?.command).toBe("plexus");
    expect(result.content).toContain('args = ["mcp", "pharo-launcher", "--project-path"');
    expect(result.content).toContain("[mcp_servers.route_control]");
    expect(result.content).toContain(`url = "${routeControlUrl}"`);
    expect(result.content).toContain("[mcp_servers.pharo_gateway]");
    expect(result.content).toContain(`url = "${gatewayUrl}"`);
    expect(result.content).not.toContain('command = "plexus-gateway"');
    expect(result.content).not.toContain("[mcp_servers.plexus]");
    expect(result.content).not.toContain("[mcp_servers.pharo]");
    expect(result.plexusProjectConfigPath).toBe(
      path.join(projectRoot, "plexus.project.json"),
    );
    expect(result.plexusProjectConfigCreated).toBe(true);
    expect(
      JSON.parse(fs.readFileSync(path.join(projectRoot, "plexus.project.json"), "utf8")),
    ).toMatchObject({
      id: "shared-dogfood",
      name: "Shared Dogfood",
      images: [],
      runtime: {
        gateway: {
          mode: "project-local",
          host: "127.0.0.1",
          agentMcpServerName: "pharo_gateway",
          agentMcpPath: "/mcp",
          routeControlMcpPath: "/control-mcp",
        },
      },
    });
    expect(plexusProjectConfig.runtime.gateway.port).not.toBe(
      loadHomeConfig(homePath).ports.plexusMcp,
    );

    const doctor = await doctorCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    expect(doctor.ok).toBe(true);
    expect(doctor.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "config:dev_nexus", status: "ok" }),
        expect.objectContaining({ name: "plexus_project:config", status: "ok" }),
        expect.objectContaining({ name: "plexus_project:images", status: "skipped" }),
        expect.objectContaining({ name: "dev_nexus:command", status: "skipped" }),
        expect.objectContaining({ name: "pharo_gateway:http", status: "skipped" }),
        expect.objectContaining({ name: "route_control:http", status: "skipped" }),
      ]),
    );
  });

  it("assigns unique project-local gateway ports across shared DevNexus project roots", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const firstRoot = path.join(makeTempDir("dev-nexus-pharo-shared-root-"), "First");
    const secondRoot = path.join(makeTempDir("dev-nexus-pharo-shared-root-"), "Second");
    const firstProject = {
      version: 1 as const,
      id: "same-hash-base",
      name: "First",
      home: null,
      worktreesRoot: "worktrees",
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" as const }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    };
    const secondProject = {
      ...firstProject,
      id: "same-hash-base-two",
      name: "Second",
    };
    saveProjectConfig(firstRoot, firstProject);
    saveProjectConfig(secondRoot, secondProject);
    const homeConfig = loadHomeConfig(homePath);
    homeConfig.projects.push(
      { id: firstProject.id, name: firstProject.name, projectRoot: firstRoot },
      { id: secondProject.id, name: secondProject.name, projectRoot: secondRoot },
    );
    saveHomeConfig(homePath, homeConfig);

    initCodexWorkspace({
      homePath,
      workspacePath: firstRoot,
      config: loadHomeConfig(homePath),
    });
    initCodexWorkspace({
      homePath,
      workspacePath: secondRoot,
      config: loadHomeConfig(homePath),
    });

    const firstPort = JSON.parse(
      fs.readFileSync(path.join(firstRoot, "plexus.project.json"), "utf8"),
    ).runtime.gateway.port;
    const secondPort = JSON.parse(
      fs.readFileSync(path.join(secondRoot, "plexus.project.json"), "utf8"),
    ).runtime.gateway.port;

    expect(firstPort).not.toBe(secondPort);
    expect([homeConfig.ports.devNexusPharoMcp, homeConfig.ports.plexusMcp])
      .not.toContain(firstPort);
    expect([homeConfig.ports.devNexusPharoMcp, homeConfig.ports.plexusMcp])
      .not.toContain(secondPort);
  });

  it("preserves existing images and image execution while adding missing runtime metadata", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "existing-runtime",
      name: "Existing Runtime",
      home: null,
      worktreesRoot: "worktrees",
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    const existingImages = [{ id: "image-1", template: "Pharo 12" }];
    const existingImageExecution = {
      mode: "scoped-project-local",
      storage: {
        mode: "project-state",
        defaultStateRoot: ".plexus",
      },
      requireProjectOwnedProfile: true,
      requireDisposableImage: false,
      requireCleanupPlan: false,
      docker: {
        image: null,
        network: "bridge",
        autoRemove: false,
        mountProjectReadOnly: false,
        runnerHint: "preserve-me",
      },
    };
    fs.writeFileSync(
      path.join(projectRoot, "plexus.project.json"),
      `${JSON.stringify({
        name: "Existing Runtime",
        images: existingImages,
        imageExecution: existingImageExecution,
      }, null, 2)}\n`,
      "utf8",
    );

    initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });

    const updated = JSON.parse(
      fs.readFileSync(path.join(projectRoot, "plexus.project.json"), "utf8"),
    );
    expect(updated.id).toBe("existing-runtime");
    expect(updated.images).toEqual(existingImages);
    expect(updated.imageExecution).toEqual(existingImageExecution);
    expect(updated.runtime.gateway).toMatchObject({
      mode: "project-local",
      host: "127.0.0.1",
      agentMcpPath: "/mcp",
      routeControlMcpPath: "/control-mcp",
    });

    const doctor = await doctorCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    expect(doctor.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "plexus_project:images", status: "ok" }),
      ]),
    );
  });

  it("reports missing shared PLexus project config as a doctor failure", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-root",
      name: "Shared Root",
      home: null,
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    fs.rmSync(path.join(projectRoot, "plexus.project.json"), { force: true });

    const doctor = await doctorCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });

    expect(doctor.ok).toBe(false);
    expect(doctor.checks).toContainEqual(
      expect.objectContaining({
        name: "plexus_project:config",
        status: "failed",
      }),
    );
  });

  it("prefers project-local runtime binaries for shared DevNexus plugin roots", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-root",
      name: "Shared Root",
      home: null,
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    const binDirectory = path.join(
      projectRoot,
      ".dev-nexus",
      "runtime",
      "npm-tools",
      "node_modules",
      ".bin",
    );
    fs.mkdirSync(binDirectory, { recursive: true });
    const devNexusPharoBin = path.join(binDirectory, "dev-nexus-pharo.cmd");
    const plexusBin = path.join(binDirectory, "plexus.cmd");
    fs.writeFileSync(devNexusPharoBin, "", "utf8");
    fs.writeFileSync(plexusBin, "", "utf8");

    const result = initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
      platform: "win32",
    });

    expect(result.servers.dev_nexus?.command).toBe("dev-nexus.cmd");
    expect(result.servers.dev_nexus_pharo?.command).toBe(devNexusPharoBin);
    expect(result.servers.plexus_project?.command).toBe(plexusBin);
    expect(result.servers.pharo_launcher?.command).toBe(plexusBin);
  });

  it("uses the host platform when selecting project-local runtime binary shims", () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const projectRoot = makeTempDir("dev-nexus-pharo-shared-root-");
    saveProjectConfig(projectRoot, {
      version: 1,
      id: "shared-root",
      name: "Shared Root",
      home: null,
      worktreesRoot: "worktrees",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus/work-items/dev-nexus.json",
      },
      mcp: {
        command: "dev-nexus",
        args: ["mcp-stdio"],
        agentTargets: [{ agent: "codex" }],
      },
      plugins: [devNexusPharoDevNexusPluginConfig()],
    });
    const binDirectory = path.join(
      projectRoot,
      ".dev-nexus",
      "runtime",
      "npm-tools",
      "node_modules",
      ".bin",
    );
    fs.mkdirSync(binDirectory, { recursive: true });
    fs.writeFileSync(path.join(binDirectory, "dev-nexus-pharo"), "", "utf8");
    fs.writeFileSync(path.join(binDirectory, "dev-nexus-pharo.cmd"), "", "utf8");
    fs.writeFileSync(path.join(binDirectory, "plexus"), "", "utf8");
    fs.writeFileSync(path.join(binDirectory, "plexus.cmd"), "", "utf8");

    const result = initCodexWorkspace({
      homePath,
      workspacePath: projectRoot,
      config: loadHomeConfig(homePath),
    });
    const shimSuffix = process.platform === "win32" ? ".cmd" : "";

    expect(result.servers.dev_nexus_pharo?.command).toBe(
      path.join(binDirectory, `dev-nexus-pharo${shimSuffix}`),
    );
    expect(result.servers.plexus_project?.command).toBe(
      path.join(binDirectory, `plexus${shimSuffix}`),
    );
  });

  it("reports missing Codex config as an actionable doctor failure", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    initNexusHome({ homePath });
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");

    await expect(doctorCodexWorkspace({ homePath, workspacePath })).resolves.toMatchObject({
      ok: false,
      checks: [
        {
          name: "config",
          status: "failed",
        },
      ],
    });
  });

  it("checks configured HTTP MCP endpoints and expected tool names", async () => {
    const pharo = await startFakeMcpServer([
      "pharo_project_create",
      "pharo_project_import",
      "pharo_project_status",
    ]);
    const plexus = await startFakeMcpServer([
      "plexus_project_open",
      "plexus_project_status",
    ]);
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath, {
      devNexusPharoMcpPort: pharo.port,
      plexusMcpPort: plexus.port,
    });
    initNexusHome({ homePath });
    saveHomeConfig(homePath, config);
    const workspacePath = makeTempDir("dev-nexus-pharo-workspace-");
    initCodexWorkspace({ homePath, workspacePath, config: loadHomeConfig(homePath) });

    const result = await doctorCodexWorkspace({ homePath, workspacePath });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "dev_nexus_pharo:health", status: "ok" }),
        expect.objectContaining({ name: "dev_nexus_pharo:initialize", status: "ok" }),
        expect.objectContaining({ name: "dev_nexus_pharo:tools", status: "ok" }),
        expect.objectContaining({ name: "plexus:health", status: "ok" }),
        expect.objectContaining({ name: "plexus:initialize", status: "ok" }),
        expect.objectContaining({ name: "plexus:tools", status: "ok" }),
      ]),
    );
  });

  it("checks Pharo MCP facade config without launching the command", async () => {
    const pharo = await startFakeMcpServer([
      "pharo_project_create",
      "pharo_project_import",
      "pharo_project_status",
    ]);
    const plexus = await startFakeMcpServer([
      "plexus_project_open",
      "plexus_project_status",
    ]);
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const config = createDefaultHomeConfig(homePath, {
      devNexusPharoMcpPort: pharo.port,
      plexusMcpPort: plexus.port,
    });
    initNexusHome({ homePath });
    saveHomeConfig(homePath, config);
    const workspacePath = makeTempDir("dev-nexus-pharo-project-");
    saveProjectConfig(workspacePath, {
      version: 1,
      id: "doctor-pharo",
      name: "Doctor Pharo",
      home: null,
      repo: {
        kind: "local",
        remoteUrl: null,
        defaultBranch: "main",
      },
      worktreesRoot: "worktrees",
      extensions: {
        [devNexusPharoProjectExtensionConfigKey]: {},
      },
    });
    initCodexWorkspace({ homePath, workspacePath, config: loadHomeConfig(homePath) });

    const result = await doctorCodexWorkspace({ homePath, workspacePath });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "config:pharo_gateway", status: "ok" }),
        expect.objectContaining({ name: "pharo_gateway:http", status: "skipped" }),
        expect.objectContaining({ name: "route_control:http", status: "skipped" }),
      ]),
    );
  });
});
