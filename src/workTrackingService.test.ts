import { describe, expect, it } from "vitest";
import { validateProjectConfig } from "./config.js";
import {
  legacyKanbanFromWorkTracking,
  resolveProjectWorkTrackingConfig,
  workTrackingFromLegacyKanban,
} from "./workTrackingService.js";

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
});
