import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validateProjectConfig } from "../../src/config.js";
import {
  createProjectWorkTrackerProvider,
  createWorkTrackerProvider,
  resolveProjectWorkTrackingConfig,
} from "../../src/workTrackingService.js";

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
  it("uses explicit provider-neutral work tracking", () => {
    const config = validateProjectConfig({
      version: 1,
      id: "local-tracked-project",
      name: "Local Tracked Project",
      workTracking: {
        provider: "local",
        storePath: ".dev-nexus-pharo/work-items.json",
      },
    });

    expect(resolveProjectWorkTrackingConfig(config)).toEqual({
      provider: "local",
      storePath: ".dev-nexus-pharo/work-items.json",
    });
  });

  it("creates a local work tracker provider from explicit project config", async () => {
    const projectRoot = makeTempDir("dev-nexus-pharo-project-");
    const config = validateProjectConfig({
      version: 1,
      id: "local-tracked-project",
      name: "Local Tracked Project",
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
    const projectRoot = makeTempDir("dev-nexus-pharo-project-");
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

  it("rejects project configs without explicit work tracking", () => {
    const missingTrackingConfig = validateProjectConfig({
      version: 1,
      id: "missing-tracking-project",
      name: "Missing Tracking Project",
    });

    expect(() => resolveProjectWorkTrackingConfig(missingTrackingConfig)).toThrow(
      /explicit "workTracking" block/,
    );
    expect(() => createProjectWorkTrackerProvider(missingTrackingConfig)).toThrow(
      /explicit "workTracking" block/,
    );
  });
});
