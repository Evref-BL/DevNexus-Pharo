import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultCoreSkillPack,
  defaultNexusAutomationConfig,
  type NexusProjectComponentConfig,
} from "dev-nexus";
import {
  initNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  saveProjectConfig,
} from "./config.js";
import {
  defaultPlexusImageExecutionPolicy,
  devNexusPharoSkillPack,
  plexusProjectConfigFileName,
} from "./devNexusPharoExtension.js";
import {
  callDevNexusPharoMcpTool,
  listDevNexusPharoMcpTools,
  startDevNexusPharoMcpHttpServer,
} from "./mcpServer.js";
import type { GitCommandResult, GitRunner } from "./nexusProjectService.js";

const tempDirs: string[] = [];
const expectedGenericSkillCount = defaultCoreSkillPack.length;
const expectedDevNexusPharoSkillCount =
  defaultCoreSkillPack.length + devNexusPharoSkillPack.length;

function localComponent(
  id: string,
  role: NexusProjectComponentConfig["role"],
  storePath: string,
  relationships: NexusProjectComponentConfig["relationships"] = [],
): NexusProjectComponentConfig {
  return {
    id,
    name: id,
    kind: "local",
    role,
    remoteUrl: null,
    defaultBranch: null,
    sourceRoot: ".",
    workTracking: {
      provider: "local",
      storePath,
    },
    relationships,
  };
}

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function freePort(): Promise<number> {
  const server = http.createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        if (!address || typeof address === "string") {
          reject(new Error("Expected TCP server address"));
          return;
        }

        resolve(address.port);
      });
    });
  });
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function parseToolText(result: {
  content: Array<{ type: "text"; text: string }>;
}): unknown {
  return JSON.parse(result.content[0].text);
}

function fakeGitRunner(args: readonly string[], cwd?: string): GitCommandResult {
  const argsArray = [...args];
  if (argsArray[0] === "clone") {
    fs.mkdirSync(argsArray[2], { recursive: true });
  }

  if (argsArray[0] === "worktree" && argsArray[1] === "add") {
    fs.mkdirSync(argsArray[4], { recursive: true });
  }

  if (argsArray[0] === "worktree" && argsArray[1] === "remove") {
    fs.rmSync(argsArray[2], { recursive: true, force: true });
  }

  if (
    argsArray[0] === "rev-parse" &&
    argsArray[1] === "--git-path" &&
    argsArray[2] === "info/exclude"
  ) {
    return {
      args: argsArray,
      stdout: `${path.join(cwd ?? "", ".git", "info", "exclude")}\n`,
      stderr: "",
      exitCode: 0,
    };
  }

  if (argsArray.includes("rev-parse")) {
    return {
      args: argsArray,
      stdout: "true\n",
      stderr: "",
      exitCode: 0,
    };
  }

  if (argsArray.includes("remote.origin.url")) {
    return {
      args: argsArray,
      stdout: "https://github.com/example/imported.git\n",
      stderr: "",
      exitCode: 0,
    };
  }

  if (argsArray.includes("symbolic-ref")) {
    return {
      args: argsArray,
      stdout: "main\n",
      stderr: "",
      exitCode: 0,
    };
  }

  return {
    args: argsArray,
    stdout: "",
    stderr: "",
    exitCode: 0,
  };
}

describe("DevNexus-Pharo MCP server tools", () => {
  it("serves MCP initialize and tools/list over HTTP", async () => {
    const server = await startDevNexusPharoMcpHttpServer({
      port: await freePort(),
    });

    try {
      const initializeResponse = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
        }),
      });
      expect(initializeResponse.status).toBe(200);
      await expect(initializeResponse.json()).resolves.toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        result: {
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "dev-nexus-pharo",
          },
        },
      });

      const listResponse = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/list",
        }),
      });
      expect(listResponse.status).toBe(200);
      const listPayload = await listResponse.json() as {
        id: number;
        result: { tools: Array<{ name: string }> };
      };
      expect(listPayload).toMatchObject({
        id: 2,
      });
      expect(listPayload.result.tools.map((tool) => tool.name)).toContain(
        "project_create",
      );
    } finally {
      await server.close();
    }
  });

  it("rejects non-local MCP HTTP origins", async () => {
    const server = await startDevNexusPharoMcpHttpServer({
      port: await freePort(),
    });

    try {
      const response = await fetch(server.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://example.test",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });
      expect(response.status).toBe(403);
    } finally {
      await server.close();
    }
  });

  it("lists project management tools", () => {
    expect(listDevNexusPharoMcpTools().map((tool) => tool.name)).toEqual([
      "project_create",
      "project_import",
      "project_link_tracker",
      "project_configure_tracker",
      "project_sync_tracker",
      "project_list",
      "project_status",
      "project_skill_status",
      "project_skill_refresh",
      "worktree_prepare",
      "worktree_guide",
      "worktree_list",
      "worktree_status",
      "worktree_record_execution",
      "worktree_archive",
      "automation_status",
      "target_cycle_list",
      "target_cycle_record",
      "target_report",
      "work_item_create",
      "work_item_list",
      "work_item_get",
      "work_item_update",
      "work_item_comment",
      "work_item_set_status",
    ]);
    expect(listDevNexusPharoMcpTools().map((tool) => tool.name)).not.toContain(
      "dev_nexus_pharo_work_item_create",
    );
    expect(listDevNexusPharoMcpTools().map((tool) => tool.name)).not.toContain(
      "dev_nexus_pharo_codex_worktree_prepare",
    );
    expect(listDevNexusPharoMcpTools().map((tool) => tool.name)).not.toContain(
      "codex_worktree_prepare",
    );
  });

  it("creates, lists, and reads a project through MCP tool calls", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "McpProject");
    initNexusHome({ homePath });

    const createResult = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "McpProject",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    const createPayload = parseToolText(createResult);

    expect(createResult.isError).toBeUndefined();
    expect(createPayload).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "mcp-project",
        name: "McpProject",
      },
    });

    const listPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_list", { homePath }),
    );
    expect(listPayload).toMatchObject({
      ok: true,
      projects: [
        {
          id: "mcp-project",
          name: "McpProject",
          projectRoot,
        },
      ],
    });

    const linkPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_link_tracker", {
        homePath,
        project: "mcp-project",
        trackerProjectId: "vk-mcp",
      }),
    );
    expect(linkPayload).toMatchObject({
      ok: true,
      vibeKanbanProjectId: "vk-mcp",
      project: {
        id: "mcp-project",
        vibeKanbanProjectId: "vk-mcp",
      },
    });

    const configurePayload = parseToolText(
      await callDevNexusPharoMcpTool("project_configure_tracker", {
        homePath,
        project: "mcp-project",
        provider: "github",
        repositoryOwner: "example",
        repositoryName: "project",
      }),
    );
    expect(configurePayload).toMatchObject({
      ok: true,
      workTracking: {
        provider: "github",
        repository: {
          owner: "example",
          name: "project",
        },
      },
      project: {
        id: "mcp-project",
        workTracking: {
          provider: "github",
        },
        vibeKanbanProjectId: "vk-mcp",
      },
    });

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_status", {
        homePath,
        project: "mcp-project",
      }),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      project: {
        id: "mcp-project",
        projectRoot,
        workTracking: {
          provider: "github",
        },
        vibeKanbanProjectId: "vk-mcp",
      },
    });
  });

  it("creates a generic DevNexus project through MCP without DevNexus-Pharo files", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "GenericMcp");
    initNexusHome({ homePath });

    const createResult = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "GenericMcp",
        root: projectRoot,
        generic: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    const createPayload = parseToolText(createResult);

    expect(createResult.isError).toBeUndefined();
    expect(createPayload).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "generic-mcp",
        name: "GenericMcp",
      },
    });
    expect(loadProjectConfig(projectRoot).extensions).toBeUndefined();
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(projectRoot, "AGENTS.md"))).toBe(false);
    expect(
      fs.existsSync(path.join(projectRoot, ".dev-nexus", "skills", "diagnose", "SKILL.md")),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "dev-nexus-pharo-workflow", "SKILL.md"),
      ),
    ).toBe(false);

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_status", {
        homePath,
        project: "generic-mcp",
      }),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      project: {
        id: "generic-mcp",
        plexusProjectConfigPath: null,
        plexusProjectConfigExists: false,
      },
    });

    const skillsPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_skill_status", {
        homePath,
        project: "generic-mcp",
      }),
    );
    expect(skillsPayload).toMatchObject({
      ok: true,
      project: {
        id: "generic-mcp",
      },
      skillStatus: {
        summary: {
          expected: expectedGenericSkillCount,
          installed: expectedGenericSkillCount,
          missing: 0,
          stale: 0,
        },
      },
    });
    expect(
      (skillsPayload as {
        skillStatus: { skills: Array<{ id: string }> };
      }).skillStatus.skills.map((skill) => skill.id),
    ).not.toContain("dev-nexus-pharo-workflow");
  });

  it("inspects and refreshes specialization skills through MCP", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "SkillMcp");
    initNexusHome({ homePath });

    await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "SkillMcp",
        root: projectRoot,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );

    fs.rmSync(
      path.join(projectRoot, ".dev-nexus", "skills", "dev-nexus-pharo-workflow"),
      { recursive: true, force: true },
    );
    fs.rmSync(
      path.join(projectRoot, ".dev-nexus", "skills", "pharo-project-load"),
      { recursive: true, force: true },
    );
    fs.appendFileSync(
      path.join(projectRoot, ".dev-nexus", "skills", "diagnose", "SKILL.md"),
      "\nLocal edit.\n",
      "utf8",
    );

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_skill_status", {
        homePath,
        project: "skill-mcp",
      }),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      skillStatus: {
        summary: {
          expected: expectedDevNexusPharoSkillCount,
          missing: 2,
          stale: 1,
        },
      },
    });

    const refreshPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_skill_refresh", {
        homePath,
        project: "skill-mcp",
      }),
    );
    expect(refreshPayload).toMatchObject({
      ok: true,
      refresh: {
        before: {
          summary: {
            missing: 2,
            stale: 1,
          },
        },
        after: {
          summary: {
            expected: expectedDevNexusPharoSkillCount,
            installed: expectedDevNexusPharoSkillCount,
            missing: 0,
            stale: 0,
          },
        },
      },
    });
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "dev-nexus-pharo-workflow", "SKILL.md"),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(projectRoot, ".dev-nexus", "skills", "pharo-project-load", "SKILL.md"),
      ),
    ).toBe(true);
  });

  it("manages local work items through neutral MCP tool calls", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Tracked");
    initNexusHome({ homePath });
    const createProject = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "Tracked",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    expect(createProject.isError).toBeUndefined();
    saveProjectConfig(projectRoot, {
      ...loadProjectConfig(projectRoot),
      workTracking: undefined,
      components: [
        localComponent("primary", "primary", path.join(".tracker", "items.json")),
        localComponent(
          "addon",
          "extension",
          path.join(".tracker", "addon-items.json"),
          [{ kind: "related", componentId: "primary" }],
        ),
      ],
    });

    const createPayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_create", {
        homePath,
        project: "tracked",
        title: "Local MCP item",
        description: "Created through neutral MCP",
        labels: ["mcp", "local"],
      }),
    );
    expect(createPayload).toMatchObject({
      ok: true,
      workItem: {
        id: "local-1",
        title: "Local MCP item",
        provider: "local",
        labels: ["mcp", "local"],
      },
    });

    const addonCreatePayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_create", {
        homePath,
        project: "tracked",
        componentId: "addon",
        title: "Component MCP item",
        labels: ["component"],
      }),
    );
    expect(addonCreatePayload).toMatchObject({
      ok: true,
      workItem: {
        id: "local-1",
        title: "Component MCP item",
        labels: ["component"],
      },
    });

    const listPayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_list", {
        homePath,
        project: "tracked",
        labels: ["mcp"],
      }),
    );
    expect(listPayload).toMatchObject({
      ok: true,
      workItems: [
        {
          id: "local-1",
          title: "Local MCP item",
        },
      ],
    });

    const addonListPayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_list", {
        homePath,
        project: "tracked",
        componentId: "addon",
        labels: ["component"],
      }),
    );
    expect(addonListPayload).toMatchObject({
      ok: true,
      workItems: [
        {
          id: "local-1",
          title: "Component MCP item",
        },
      ],
    });

    const updatePayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_update", {
        homePath,
        project: "tracked",
        id: "local-1",
        status: "in_progress",
        assignees: ["alice"],
      }),
    );
    expect(updatePayload).toMatchObject({
      ok: true,
      workItem: {
        id: "local-1",
        status: "in_progress",
        assignees: ["alice"],
      },
    });

    const commentPayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_comment", {
        homePath,
        project: "tracked",
        ref: {
          id: "local-1",
        },
        body: "Commented through MCP",
      }),
    );
    expect(commentPayload).toMatchObject({
      ok: true,
      comment: {
        id: "local-comment-1",
        body: "Commented through MCP",
      },
    });

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_set_status", {
        homePath,
        project: "tracked",
        externalRef: {
          provider: "local",
          itemId: "local-1",
        },
        status: "done",
      }),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      workItem: {
        id: "local-1",
        status: "done",
      },
    });

    const getPayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_get", {
        homePath,
        project: "tracked",
        id: "local-1",
      }),
    );
    expect(getPayload).toMatchObject({
      ok: true,
      workItem: {
        id: "local-1",
        status: "done",
      },
    });
    expect(fs.existsSync(path.join(projectRoot, ".tracker", "items.json"))).toBe(
      true,
    );
    expect(
      fs.existsSync(path.join(projectRoot, ".tracker", "addon-items.json")),
    ).toBe(true);
  });

  it("delegates automation target tools to the native DevNexus MCP surface", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Automated");
    initNexusHome({ homePath });
    const createProject = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "Automated",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    expect(createProject.isError).toBeUndefined();
    saveProjectConfig(projectRoot, {
      ...loadProjectConfig(projectRoot),
      workTracking: undefined,
      components: [
        localComponent("primary", "primary", path.join(".tracker", "primary.json")),
        localComponent(
          "addon",
          "extension",
          path.join(".tracker", "addon.json"),
          [{ kind: "related", componentId: "primary" }],
        ),
      ],
      automation: {
        ...defaultNexusAutomationConfig,
        mode: "agent_launch",
        selector: {
          ...defaultNexusAutomationConfig.selector,
          statuses: ["ready"],
          labels: ["dogfood"],
        },
        target: {
          ...defaultNexusAutomationConfig.target,
          id: "adapter-alignment",
          objective: "Verify DevNexus-Pharo can expose DevNexus target facts.",
        },
      },
    });

    await callDevNexusPharoMcpTool(
      "work_item_create",
      {
        homePath,
        project: "automated",
        componentId: "addon",
        title: "Component work",
        status: "ready",
        labels: ["dogfood"],
      },
      { now: () => "2026-05-16T10:00:00.000Z" },
    );

    const automationStatus = parseToolText(
      await callDevNexusPharoMcpTool(
        "automation_status",
        {
          homePath,
          project: "automated",
        },
        { now: () => "2026-05-16T10:05:00.000Z" },
      ),
    );
    expect(automationStatus).toMatchObject({
      ok: true,
      status: "ready",
      target: {
        id: "adapter-alignment",
      },
      componentEligibleWorkItems: [
        {
          componentId: "primary",
          workItems: [],
        },
        {
          componentId: "addon",
          workItems: [
            {
              id: "local-1",
              title: "Component work",
            },
          ],
        },
      ],
    });

    const recorded = parseToolText(
      await callDevNexusPharoMcpTool(
        "target_cycle_record",
        {
          homePath,
          project: "automated",
          cycleId: "cycle-1",
          status: "completed",
          summary: "Native target cycle recorded through DevNexus-Pharo.",
          eligibleWorkItemCount: 1,
          workItems: [
            {
              componentId: "addon",
              id: "local-1",
              cycleStatus: "completed",
            },
          ],
        },
        { now: () => "2026-05-16T10:10:00.000Z" },
      ),
    );
    expect(recorded).toMatchObject({
      ok: true,
      record: {
        id: "cycle-1",
        targetId: "adapter-alignment",
        status: "completed",
        workItems: [
          {
            componentId: "addon",
            id: "local-1",
            cycleStatus: "completed",
          },
        ],
      },
    });

    const report = parseToolText(
      await callDevNexusPharoMcpTool(
        "target_report",
        {
          homePath,
          project: "automated",
        },
        { now: () => "2026-05-16T10:15:00.000Z" },
      ),
    );
    expect(report).toMatchObject({
      ok: true,
      report: {
        status: "completed",
        workItemSummary: {
          uniqueReferences: [
            {
              componentId: "addon",
              id: "local-1",
              latestCycleStatus: "completed",
            },
          ],
        },
      },
    });
  });

  it("configures GitLab work tracking through neutral MCP tool calls", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "GitLabMcp");
    initNexusHome({ homePath });
    await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "GitLabMcp",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );

    const configurePayload = parseToolText(
      await callDevNexusPharoMcpTool("project_configure_tracker", {
        homePath,
        project: "git-lab-mcp",
        provider: "gitlab",
        host: "gitlab.enterprise.test",
        repositoryId: "example/project",
      }),
    );

    expect(configurePayload).toMatchObject({
      ok: true,
      workTracking: {
        provider: "gitlab",
        host: "gitlab.enterprise.test",
        repository: {
          id: "example/project",
        },
      },
      project: {
        id: "git-lab-mcp",
        workTracking: {
          provider: "gitlab",
        },
      },
    });
  });

  it("configures Jira work tracking through neutral MCP tool calls", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "JiraMcp");
    initNexusHome({ homePath });
    await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "JiraMcp",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );

    const configurePayload = parseToolText(
      await callDevNexusPharoMcpTool("project_configure_tracker", {
        homePath,
        project: "jira-mcp",
        provider: "jira",
        host: "example.atlassian.net",
        projectKey: "FCD",
        issueType: "Bug",
      }),
    );

    expect(configurePayload).toMatchObject({
      ok: true,
      workTracking: {
        provider: "jira",
        host: "example.atlassian.net",
        projectKey: "FCD",
        issueType: "Bug",
      },
      project: {
        id: "jira-mcp",
        workTracking: {
          provider: "jira",
        },
      },
    });
  });

  it("reports unsupported work tracking providers through neutral MCP tools", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "Legacy");
    initNexusHome({ homePath });
    const createProject = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "Legacy",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    expect(createProject.isError).toBeUndefined();

    const result = await callDevNexusPharoMcpTool("work_item_create", {
      homePath,
      project: "legacy",
      title: "Cannot route to Vibe yet",
    });

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toMatchObject({
      ok: false,
    });
    expect(JSON.stringify(parseToolText(result))).toContain(
      "work tracking is not configured",
    );
  });

  it("resolves project status by managed config id before MCP path fallback", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(
      makeTempDir("dev-nexus-pharo-projects-"),
      "pharo-launcher-mcp",
    );
    initNexusHome({ homePath });

    const createResult = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "pharo-launcher-mcp",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );
    expect(createResult.isError).toBeUndefined();
    expect(projectRoot.startsWith(process.cwd())).toBe(false);
    saveProjectConfig(projectRoot, {
      ...loadProjectConfig(projectRoot),
      id: "pharo-launcher-mcp",
      name: "pharo-launcher-mcp",
    });

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool("project_status", {
        homePath,
        project: "pharo-launcher-mcp",
      }),
    );

    expect(statusPayload).toMatchObject({
      ok: true,
      project: {
        id: "pharo-launcher-mcp",
        projectRoot,
      },
    });
  });

  it("imports an existing repository through an MCP tool call", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const sourceRoot = path.join(makeTempDir("dev-nexus-pharo-source-"), "Imported");
    fs.mkdirSync(sourceRoot, { recursive: true });
    initNexusHome({ homePath });
    const projectRoot = path.join(homePath, "projects", "Imported");

    const result = await callDevNexusPharoMcpTool(
      "project_import",
      {
        homePath,
        root: sourceRoot,
        name: "Imported",
        syncTracker: false,
      },
      { gitRunner: fakeGitRunner },
    );

    expect(result.isError).toBeUndefined();
    expect(parseToolText(result)).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "imported",
        repo: {
          kind: "git",
          remoteUrl: "https://github.com/example/imported.git",
          defaultBranch: "main",
          sourceRoot,
        },
      },
    });
    expect(fs.existsSync(path.join(sourceRoot, "dev-nexus.project.json"))).toBe(false);
  });

  it("supports the first usable control-project scenario through remoteUrl", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const gitCalls: string[][] = [];
    initNexusHome({ homePath });
    const gitRunner: GitRunner = (args: readonly string[]): GitCommandResult => {
      const argsArray = [...args];
      gitCalls.push(argsArray);

      if (argsArray[0] === "init") {
        fs.mkdirSync(path.join(argsArray[1], ".git"), { recursive: true });
      }

      if (argsArray[0] === "clone") {
        fs.mkdirSync(path.join(argsArray[2], ".git"), { recursive: true });
      }

      if (argsArray.includes("symbolic-ref")) {
        return {
          args: argsArray,
          stdout: "main\n",
          stderr: "",
          exitCode: 0,
        };
      }

      return {
        args: argsArray,
        stdout: "",
        stderr: "",
        exitCode: 0,
      };
    };

    const fetchMock = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/repos") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "repo-my-library",
              path: path.join(homePath, "projects", "MyLibrary", "git"),
            },
          }),
          { status: 200 },
        );
      }

      if (url === "http://127.0.0.1:3000/api/repos/repo-my-library") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "repo-my-library",
              path: path.join(homePath, "projects", "MyLibrary", "git"),
              setup_script: JSON.parse(String(init?.body)).setup_script,
            },
          }),
          { status: 200 },
        );
      }

      if (url === "http://127.0.0.1:3000/api/info") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              shared_api_base: "http://vibe.test",
            },
          }),
          { status: 200 },
        );
      }

      if (url === "http://127.0.0.1:3000/api/auth/token") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              access_token: "token",
            },
          }),
          { status: 200 },
        );
      }

      if (url === "http://vibe.test/v1/organizations") {
        return new Response(
          JSON.stringify({
            organizations: [
              {
                id: "org-1",
                name: "Personal",
                is_personal: true,
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (url === "http://vibe.test/v1/fallback/projects?organization_id=org-1") {
        return new Response(
          JSON.stringify({
            projects: [
              {
                id: "board-my-library",
                organization_id: "org-1",
                name: "MyLibrary",
              },
            ],
          }),
          { status: 200 },
        );
      }

      throw new Error(`Unexpected Vibe Kanban request: ${url}`);
    };

    const result = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "MyLibrary",
        remoteUrl: "https://github.com/me/MyLibrary.git",
      },
      { gitRunner, fetch: fetchMock },
    );
    const payload = parseToolText(result);
    const projectRoot = path.join(homePath, "projects", "MyLibrary");

    expect(result.isError).toBeUndefined();
    expect(payload).toMatchObject({
      ok: true,
      projectRoot,
      projectConfig: {
        id: "my-library",
        name: "MyLibrary",
        repo: {
          kind: "git",
          remoteUrl: "https://github.com/me/MyLibrary.git",
          defaultBranch: "main",
          sourceRoot: "git",
        },
        kanban: {
          projectId: "board-my-library",
        },
      },
      plexusProjectConfig: {
        name: "MyLibrary",
        kanban: {
          provider: "vibe-kanban",
          projectId: "board-my-library",
        },
        images: [],
        imageExecution: defaultPlexusImageExecutionPolicy,
      },
      trackerSync: {
        vibeKanbanProjectId: "board-my-library",
        vibeKanbanRepoId: "repo-my-library",
      },
    });
    expect(gitCalls[0]).toEqual(["init", projectRoot]);
    expect(gitCalls[1]).toEqual([
      "clone",
      "https://github.com/me/MyLibrary.git",
      path.join(projectRoot, "git"),
    ]);
    expect(fs.existsSync(path.join(projectRoot, "dev-nexus.project.json"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, plexusProjectConfigFileName))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "worktrees"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, "git", "dev-nexus.project.json"))).toBe(false);
    expect(loadProjectConfig(projectRoot)).toMatchObject({
      id: "my-library",
      name: "MyLibrary",
      kanban: {
        projectId: "board-my-library",
      },
    });
    expect(loadHomeConfig(homePath).projects).toEqual([
      {
        id: "my-library",
        name: "MyLibrary",
        projectRoot: projectRoot,
        vibeKanbanProjectId: "board-my-library",
        vibeKanbanRepoId: "repo-my-library",
      },
    ]);
  });

  it("returns tool errors as MCP error results", async () => {
    const result = await callDevNexusPharoMcpTool("project_status", {});

    expect(result.isError).toBe(true);
    expect(parseToolText(result)).toMatchObject({
      ok: false,
      error: "arguments.project is required",
    });
  });

  it("prepares and archives Codex worktrees through neutral MCP tool calls", async () => {
    const homePath = makeTempDir("dev-nexus-pharo-home-");
    const projectRoot = path.join(makeTempDir("dev-nexus-pharo-projects-"), "CodexMcp");
    initNexusHome({ homePath });
    const calls: Array<{ args: string[]; cwd?: string }> = [];
    const gitRunner: GitRunner = (args: readonly string[], cwd?: string) => {
      calls.push({ args: [...args], cwd });
      return fakeGitRunner(args, cwd);
    };

    const createResult = await callDevNexusPharoMcpTool(
      "project_create",
      {
        homePath,
        name: "CodexMcp",
        root: projectRoot,
        gitInit: true,
        syncTracker: false,
      },
      { gitRunner },
    );
    expect(createResult.isError).toBeUndefined();
    saveProjectConfig(projectRoot, {
      ...loadProjectConfig(projectRoot),
      workTracking: {
        provider: "local",
        storePath: path.join(".tracker", "items.json"),
      },
      components: [
        localComponent("primary", "primary", path.join(".tracker", "items.json")),
      ],
    });
    const createWorkItemPayload = parseToolText(
      await callDevNexusPharoMcpTool("work_item_create", {
        homePath,
        project: "codex-mcp",
        title: "FCD-900",
      }),
    ) as { workItem: { id: string } };

    const preparePayload = parseToolText(
      await callDevNexusPharoMcpTool(
        "worktree_prepare",
        {
          homePath,
          project: "codex-mcp",
          branchName: "codex/fcd-900",
          baseRef: "main",
          workItemId: createWorkItemPayload.workItem.id,
          commentWorkItem: true,
        },
        { gitRunner },
      ),
    );
    const worktreePath = path.join(projectRoot, "worktrees", "primary", "codex-fcd-900");
    expect(preparePayload).toMatchObject({
      ok: true,
      projectRoot,
      componentId: "primary",
      sourceRoot: projectRoot,
      worktreePath,
      branchName: "codex/fcd-900",
      baseRef: "main",
      metadataRecord: {
        id: "codex-mcp:codex/fcd-900",
        componentId: "primary",
        workItem: {
          id: createWorkItemPayload.workItem.id,
        },
      },
      trackerComment: {
        id: "local-comment-1",
        body: expect.stringContaining("Codex worktree prepared."),
      },
    });

    const listPayload = parseToolText(
      await callDevNexusPharoMcpTool(
        "worktree_list",
        {
          homePath,
          project: "codex-mcp",
          state: "active",
        },
        { gitRunner },
      ),
    );
    expect(listPayload).toMatchObject({
      ok: true,
      worktrees: [
        {
          metadataRecord: {
            id: "codex-mcp:codex/fcd-900",
            state: "active",
          },
          projectRootExists: true,
          sourceRootExists: true,
          worktreeExists: true,
        },
      ],
    });

    const statusPayload = parseToolText(
      await callDevNexusPharoMcpTool(
        "worktree_status",
        {
          homePath,
          id: "codex-mcp:codex/fcd-900",
        },
        { gitRunner },
      ),
    );
    expect(statusPayload).toMatchObject({
      ok: true,
      worktree: {
        metadataRecord: {
          id: "codex-mcp:codex/fcd-900",
          branchName: "codex/fcd-900",
        },
        worktreeExists: true,
      },
    });

    const guidePayload = parseToolText(
      await callDevNexusPharoMcpTool("worktree_guide", {
        homePath,
        id: "codex-mcp:codex/fcd-900",
        commentWorkItem: true,
        removeWorktree: true,
      }),
    );
    expect(guidePayload).toMatchObject({
      ok: true,
      id: "codex-mcp:codex/fcd-900",
      project: "codex-mcp",
    });
    expect((guidePayload as { steps: unknown[] }).steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Record execution metadata",
          command: expect.stringContaining("codex worktree record"),
        }),
        expect.objectContaining({
          title: "Archive worktree",
          command: expect.stringContaining("--remove-worktree"),
        }),
      ]),
    );
    expect((guidePayload as { notes: unknown[] }).notes).toEqual(
      expect.arrayContaining([expect.stringContaining("Vibe")]),
    );

    const recordPayload = parseToolText(
      await callDevNexusPharoMcpTool(
        "worktree_record_execution",
        {
          homePath,
          id: "codex-mcp:codex/fcd-900",
          commitIds: ["abc123"],
          verificationCommand: "npm test",
          verificationStatus: "passed",
          verificationSummary: "164 tests passed",
          publicationDecision: {
            type: "review_handoff",
            prUrl: "https://example.test/pr/1",
          },
        },
        { gitRunner },
      ),
    );
    expect(recordPayload).toMatchObject({
      ok: true,
      metadataRecord: {
        id: "codex-mcp:codex/fcd-900",
        execution: {
          commitIds: ["abc123"],
          verification: [
            {
              command: "npm test",
              status: "passed",
              summary: "164 tests passed",
            },
          ],
          publicationDecision: {
            type: "review_handoff",
            prUrl: "https://example.test/pr/1",
          },
        },
      },
    });

    const archivePayload = parseToolText(
      await callDevNexusPharoMcpTool(
        "worktree_archive",
        {
          homePath,
          id: "codex-mcp:codex/fcd-900",
          removeWorktree: true,
          commentWorkItem: true,
        },
        { gitRunner },
      ),
    );
    expect(archivePayload).toMatchObject({
      ok: true,
      removedWorktree: true,
      metadataRecord: {
        id: "codex-mcp:codex/fcd-900",
        state: "archived",
      },
      trackerComment: {
        id: "local-comment-2",
        body: expect.stringContaining("Codex worktree archived."),
      },
    });
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          cwd: projectRoot,
          args: [
            "worktree",
            "add",
            "-b",
            "codex/fcd-900",
            worktreePath,
            "main",
          ],
        },
        {
          cwd: worktreePath,
          args: ["rev-parse", "--git-path", "info/exclude"],
        },
        {
          cwd: projectRoot,
          args: ["worktree", "remove", worktreePath],
        },
      ]),
    );
  });
});
