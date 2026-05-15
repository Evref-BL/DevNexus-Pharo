import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateProjectConfig } from "./config.js";
import {
  createProjectWorkTrackerProvider,
  createWorkTrackerProvider,
  legacyKanbanFromWorkTracking,
  resolveProjectWorkTrackingConfig,
  workTrackingFromLegacyKanban,
} from "./workTrackingService.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("work tracking service", () => {
  it("converts legacy Kanban config to provider-neutral work tracking", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-project",
      },
    });

    expect(workTrackingFromLegacyKanban(config.kanban)).toEqual({
      provider: "vibe-kanban",
      projectId: "vk-project",
    });
    expect(resolveProjectWorkTrackingConfig(config)).toEqual({
      provider: "vibe-kanban",
      projectId: "vk-project",
    });
  });

  it("prefers explicit provider-neutral work tracking over legacy Kanban", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "local-tracked-project",
      name: "Local Tracked Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "legacy-vibe-project",
      },
      workTracking: {
        provider: "local",
        storePath: ".pharo-nexus/work-items.json",
      },
    });

    expect(resolveProjectWorkTrackingConfig(config)).toEqual({
      provider: "local",
      storePath: ".pharo-nexus/work-items.json",
    });
  });

  it("converts Vibe work tracking back to Kanban metadata", () => {
    expect(
      legacyKanbanFromWorkTracking({
        provider: "vibe-kanban",
        projectId: "vk-project",
        repoId: "vk-repo",
      }),
    ).toEqual({
      provider: "vibe-kanban",
      projectId: "vk-project",
    });

    expect(
      legacyKanbanFromWorkTracking({
        provider: "local",
        storePath: ".pharo-nexus/work-items.json",
      }),
    ).toBeUndefined();
  });

  it("creates a local work tracker provider from explicit project config", async () => {
    const projectRoot = makeTempDir("pharo-nexus-project-");
    const config = validateProjectConfig({
      version: 1,
      id: "local-tracked-project",
      name: "Local Tracked Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "legacy-vibe-project",
      },
      workTracking: {
        provider: "local",
        storePath: path.join(".custom", "items.json"),
      },
    });
    const provider = createProjectWorkTrackerProvider(config, {
      projectRoot,
      now: () => "2026-05-15T09:40:00.000Z",
    });

    expect(provider.provider).toBe("local");
    await expect(
      provider.createWorkItem({ title: "Factory-created item" }),
    ).resolves.toMatchObject({
      id: "local-1",
      title: "Factory-created item",
      provider: "local",
    });
    expect(fs.existsSync(path.join(projectRoot, ".custom", "items.json"))).toBe(
      true,
    );
  });

  it("creates a local work tracker provider from direct config", async () => {
    const projectRoot = makeTempDir("pharo-nexus-project-");
    const provider = createWorkTrackerProvider(
      {
        provider: "local",
      },
      {
        projectRoot,
      },
    );

    expect(provider.provider).toBe("local");
    await expect(provider.listWorkItems()).resolves.toEqual([]);
  });

  it("creates a Vibe work tracker provider when Vibe API options are supplied", () => {
    const legacyVibeConfig = validateProjectConfig({
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-project",
      },
    });

    const provider = createProjectWorkTrackerProvider(legacyVibeConfig, {
      vibeKanban: {
        host: "localhost",
        port: 3000,
        fetch: async () => new Response(),
      },
    });

    expect(provider.provider).toBe("vibe-kanban");
    expect(provider.capabilities.board).toBe(true);
    expect(provider.capabilities.createItem).toBe(false);
  });

  it("creates a GitHub work tracker provider from direct config", () => {
    const provider = createWorkTrackerProvider(
      {
        provider: "github",
        repository: {
          owner: "example",
          name: "project",
        },
      },
      {
        github: {
          fetch: async () => new Response(),
          env: {},
        },
      },
    );

    expect(provider.provider).toBe("github");
    expect(provider.capabilities.createItem).toBe(true);
    expect(provider.capabilities.board).toBe(false);
  });

  it("creates a GitLab work tracker provider from direct config", () => {
    const provider = createWorkTrackerProvider(
      {
        provider: "gitlab",
        repository: {
          id: "example/project",
        },
      },
      {
        gitlab: {
          fetch: async () => new Response(),
          env: {},
        },
      },
    );

    expect(provider.provider).toBe("gitlab");
    expect(provider.capabilities.createItem).toBe(true);
    expect(provider.capabilities.board).toBe(false);
  });

  it("creates a Jira work tracker provider from direct config", () => {
    const provider = createWorkTrackerProvider(
      {
        provider: "jira",
        host: "example.atlassian.net",
        projectKey: "FCD",
      },
      {
        jira: {
          fetch: async () => new Response(),
          env: {},
          credentialRunner: false,
        },
      },
    );

    expect(provider.provider).toBe("jira");
    expect(provider.capabilities.createItem).toBe(true);
    expect(provider.capabilities.milestones).toBe(false);
  });

  it("reports missing Vibe options before MCP tools use legacy work tracking", () => {
    const legacyVibeConfig = validateProjectConfig({
      version: 1,
      id: "legacy-project",
      name: "Legacy Project",
      kanban: {
        provider: "vibe-kanban",
        projectId: "vk-project",
      },
    });

    expect(() => createProjectWorkTrackerProvider(legacyVibeConfig)).toThrow(
      /requires Vibe Kanban API options/,
    );
  });
});
