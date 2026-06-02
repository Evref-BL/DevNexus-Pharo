import { describe, expect, it } from "vitest";
import { summarizePlexusWorkspaceHandoff } from "../../src/plexusWorkspaceHandoff.js";

function statusFixture(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    data: {
      projectId: "project-123",
      workspaceId: "workspace-a",
      targetId: "project-123--workspace-a",
      context: {
        workspace: {
          source: {
            path: "/work/source",
          },
        },
      },
      state: {
        images: [
          {
            id: "dev",
            imageName: "Project-dev",
            status: "running",
            pid: 1234,
          },
        ],
      },
      diagnostics: {
        runtime: {
          status: "operational",
          health: "operational",
          reason: "Project runtime is healthy.",
        },
        scope: {
          projectRoot: "/work/project",
          sourcePath: "/work/source",
          stateRoot: "/work/state",
          statePath: "/work/state/projects/project-123/workspaces/workspace-a/state.json",
          projectId: "project-123",
          workspaceId: "workspace-a",
          targetId: "project-123--workspace-a",
        },
        imageMcpPorts: [
          {
            imageId: "dev",
            imageName: "Project-dev",
            status: "running",
            port: 7100,
          },
        ],
        repositoryWorkspaces: [
          {
            imageId: "dev",
            imageName: "Project-dev",
            status: "running",
            workspace: {
              repository: {
                id: "project",
              },
              path: "/image/iceberg/project",
              branch: "codex/work",
              dirtyState: "clean",
              loadState: "loaded",
              materializationState: "ready",
            },
            cleanup: {
              recommendedAction: "none",
            },
          },
        ],
        imageRecovery: [],
      },
      ...overrides,
    },
  };
}

describe("PLexus workspace handoff summaries", () => {
  it("summarizes clean workspaces as closeable", () => {
    const summary = summarizePlexusWorkspaceHandoff(statusFixture());

    expect(summary).toMatchObject({
      projectId: "project-123",
      workspaceId: "workspace-a",
      targetId: "project-123--workspace-a",
      sourcePath: "/work/source",
      runtime: {
        status: "operational",
        health: "operational",
      },
      cleanup: {
        recommendation: "close",
      },
      multiImage: false,
    });
    expect(summary.images).toEqual([
      expect.objectContaining({
        imageId: "dev",
        status: "running",
        pid: 1234,
        port: 7100,
      }),
    ]);
    expect(summary.repositories).toEqual([
      expect.objectContaining({
        repositoryId: "project",
        dirtyState: "clean",
        loadState: "loaded",
        recommendedCleanup: "none",
      }),
    ]);
    expect(summary.risks).toEqual([]);
    expect(summary.actions).toEqual([
      expect.objectContaining({
        kind: "close_workspace",
        toolName: "plexus_project_close",
        arguments: expect.objectContaining({
          projectPath: "/work/project",
          stateRoot: "/work/state",
          workspaceId: "workspace-a",
        }),
      }),
    ]);
  });

  it("reports dirty image-local repository state before archive cleanup", () => {
    const fixture = statusFixture();
    const repository = ((fixture.data.diagnostics.repositoryWorkspaces as unknown[])[0] as {
      workspace: Record<string, unknown>;
    });
    repository.workspace.dirtyState = "dirty";

    const summary = summarizePlexusWorkspaceHandoff(fixture);

    expect(summary.cleanup).toMatchObject({
      recommendation: "archive",
    });
    expect(summary.repositories).toEqual([
      expect.objectContaining({
        repositoryId: "project",
        dirtyState: "dirty",
        recommendedCleanup: "archive",
      }),
    ]);
    expect(summary.risks.join("\n")).toContain("Dirty image-local repository");
    expect(summary.actions).toEqual([
      expect.objectContaining({
        kind: "close_workspace",
        arguments: expect.objectContaining({
          repositoryWorkspaceCleanupPolicy: "archive",
        }),
      }),
    ]);
  });

  it("preserves failed image state and surfaces scoped rescue actions", () => {
    const fixture = statusFixture({
      state: {
        images: [
          {
            id: "dev",
            imageName: "Project-dev",
            status: "failed",
          },
        ],
      },
      diagnostics: {
        ...statusFixture().data.diagnostics,
        runtime: {
          status: "degraded",
          health: "degraded",
          reason: "One image failed.",
        },
        imageMcpPorts: [
          {
            imageId: "dev",
            imageName: "Project-dev",
            status: "failed",
          },
        ],
        imageRecovery: [
          {
            imageId: "dev",
            imageName: "Project-dev",
            status: "failed",
            actions: [
              {
                operation: "plan",
                toolName: "plexus_rescue_image",
                arguments: {
                  projectPath: "/work/project",
                  stateRoot: "/work/state",
                  workspaceId: "workspace-a",
                  sourceImageId: "dev",
                  operation: "plan",
                },
              },
            ],
          },
        ],
      },
    });

    const summary = summarizePlexusWorkspaceHandoff(fixture);

    expect(summary.cleanup).toMatchObject({
      recommendation: "rescue",
    });
    expect(summary.images).toEqual([
      expect.objectContaining({
        imageId: "dev",
        status: "failed",
        recoveryActions: [
          expect.objectContaining({
            kind: "rescue_image",
            toolName: "plexus_rescue_image",
          }),
        ],
      }),
    ]);
    expect(summary.actions).toEqual([
      expect.objectContaining({
        kind: "rescue_image",
        arguments: expect.objectContaining({
          operation: "plan",
          sourceImageId: "dev",
        }),
      }),
    ]);
    expect(summary.guidance.join("\n")).toContain("Do not close failed image state");
  });

  it("summarizes multi-image workspaces with every image id", () => {
    const fixture = statusFixture({
      state: {
        images: [
          {
            id: "dev",
            imageName: "Project-dev",
            status: "running",
          },
          {
            id: "experiment",
            imageName: "Project-experiment",
            status: "stopped",
          },
        ],
      },
      diagnostics: {
        ...statusFixture().data.diagnostics,
        imageMcpPorts: [
          {
            imageId: "dev",
            imageName: "Project-dev",
            status: "running",
            port: 7100,
          },
          {
            imageId: "experiment",
            imageName: "Project-experiment",
            status: "stopped",
          },
        ],
      },
    });

    const summary = summarizePlexusWorkspaceHandoff(fixture);

    expect(summary.multiImage).toBe(true);
    expect(summary.images.map((image) => image.imageId)).toEqual([
      "dev",
      "experiment",
    ]);
    expect(summary.guidance.join("\n")).toContain("dev, experiment");
    expect(summary.cleanup.recommendation).toBe("close");
  });
});
