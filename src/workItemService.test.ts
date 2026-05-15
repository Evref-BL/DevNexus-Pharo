import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDefaultHomeConfig,
  saveHomeConfig,
  saveProjectConfig,
  type PharoNexusHomeConfig,
  type PharoNexusProjectConfig,
} from "./config.js";
import {
  createWorkItemService,
  normalizeProjectSelector,
  normalizeWorkItemRef,
  WorkItemServiceError,
} from "./workItemService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

function fixedClock(...timestamps: string[]): () => string {
  let index = 0;
  return () => timestamps[Math.min(index++, timestamps.length - 1)] ?? timestamps[0]!;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function writeHome(homePath: string, projectRoot?: string): PharoNexusHomeConfig {
  const homeConfig = createDefaultHomeConfig(homePath);
  if (projectRoot) {
    homeConfig.projects = [
      {
        id: "tracked-project",
        name: "Tracked Project",
        plexusProjectRoot: projectRoot,
      },
    ];
  }
  saveHomeConfig(homePath, homeConfig);
  return homeConfig;
}

function writeProject(
  projectRoot: string,
  overrides: Partial<PharoNexusProjectConfig> = {},
): PharoNexusProjectConfig {
  const projectConfig: PharoNexusProjectConfig = {
    version: 1,
    id: "tracked-project",
    name: "Tracked Project",
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    },
    plexusProjectConfig: "plexus.project.json",
    worktreesRoot: "worktrees",
    kanban: {
      provider: "vibe-kanban",
      projectId: "legacy-vibe-project",
    },
    workTracking: {
      provider: "local",
      storePath: path.join(".tracker", "items.json"),
    },
    ...overrides,
  };
  saveProjectConfig(projectRoot, projectConfig);
  return projectConfig;
}

describe("work item service", () => {
  it("resolves registered projects and delegates work item operations", async () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(homePath, "projects", "Tracked");
    fs.mkdirSync(projectRoot, { recursive: true });
    writeHome(homePath, projectRoot);
    writeProject(projectRoot);

    const service = createWorkItemService({
      homePath,
      now: fixedClock(
        "2026-05-15T10:00:00.000Z",
        "2026-05-15T10:01:00.000Z",
        "2026-05-15T10:02:00.000Z",
        "2026-05-15T10:03:00.000Z",
      ),
    });

    const created = await service.createWorkItem({
      project: "tracked-project",
      title: "Create via app service",
      labels: ["local"],
    });
    expect(created).toMatchObject({
      id: "local-1",
      title: "Create via app service",
      provider: "local",
    });
    expect(fs.existsSync(path.join(projectRoot, ".tracker", "items.json"))).toBe(
      true,
    );

    await expect(
      service.listWorkItems({
        project: "tracked-project",
        labels: ["local"],
      }),
    ).resolves.toMatchObject([{ id: "local-1" }]);
    await expect(
      service.updateWorkItem({
        project: "tracked-project",
        ref: { id: "local-1" },
        patch: {
          status: "in_progress",
        },
      }),
    ).resolves.toMatchObject({
      id: "local-1",
      status: "in_progress",
    });
    await expect(
      service.addComment({
        project: "tracked-project",
        ref: { id: "local-1" },
        body: "Recorded by service",
      }),
    ).resolves.toMatchObject({
      id: "local-comment-1",
      body: "Recorded by service",
    });
    await expect(
      service.setStatus({
        project: "tracked-project",
        ref: { externalRef: { provider: "local", itemId: "local-1" } },
        status: "done",
      }),
    ).resolves.toMatchObject({
      id: "local-1",
      status: "done",
    });
  });

  it("supports unregistered projectRoot fallback and exposes resolved context", async () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(homePath, "unregistered");
    fs.mkdirSync(projectRoot, { recursive: true });
    writeHome(homePath);
    writeProject(projectRoot, {
      repo: {
        kind: "git",
        remoteUrl: "https://example.com/project.git",
        defaultBranch: "main",
        sourceRoot: "git",
      },
    });

    const service = createWorkItemService({ homePath });
    const context = service.resolveProviderContext({ projectRoot });

    expect(context.projectContext).toMatchObject({
      homePath,
      projectRoot,
      projectId: "tracked-project",
      projectName: "Tracked Project",
      sourceRoot: path.join(projectRoot, "git"),
      workTracking: {
        provider: "local",
      },
    });
    await expect(
      service.createWorkItem({
        projectRoot,
        title: "Path-selected item",
      }),
    ).resolves.toMatchObject({
      id: "local-1",
      title: "Path-selected item",
    });
    await expect(
      service.getWorkItem({
        projectRoot,
        id: "local-1",
      }),
    ).resolves.toMatchObject({
      id: "local-1",
    });
  });

  it("normalizes project selectors and item refs with clear errors", () => {
    expect(normalizeProjectSelector({ project: "  tracked-project " })).toBe(
      "tracked-project",
    );
    expect(() => normalizeProjectSelector({})).toThrow(
      /project or projectRoot is required/,
    );
    expect(() =>
      normalizeProjectSelector({
        project: "tracked-project",
        projectRoot: "C:\\dev\\project",
      }),
    ).toThrow(/either project or projectRoot/);

    expect(normalizeWorkItemRef({ id: "local-1" }, "local")).toEqual({
      id: "local-1",
      provider: "local",
    });
    expect(() => normalizeWorkItemRef({}, "local")).toThrow(
      /work item id or externalRef\.itemId is required/,
    );
    expect(() =>
      normalizeWorkItemRef({ provider: "github", id: "1" }, "local"),
    ).toThrow(/does not match configured provider/);
  });

  it("wraps unsupported provider diagnostics with project context", () => {
    const homePath = makeTempDir("pharo-nexus-home-");
    const projectRoot = path.join(homePath, "projects", "Legacy");
    fs.mkdirSync(projectRoot, { recursive: true });
    writeHome(homePath, projectRoot);
    writeProject(projectRoot, {
      workTracking: undefined,
    });

    const service = createWorkItemService({ homePath });

    expect(() =>
      service.resolveProviderContext({ project: "tracked-project" }),
    ).toThrow(WorkItemServiceError);
    expect(() =>
      service.resolveProviderContext({ project: "tracked-project" }),
    ).toThrow(/tracked-project.*vibe-kanban.*not available/);
  });
});
