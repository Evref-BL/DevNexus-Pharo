import type {
  PharoNexusProjectConfig,
  PharoNexusProjectKanbanConfig,
} from "./config.js";
import type {
  VibeKanbanWorkTrackingConfig,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export function workTrackingFromLegacyKanban(
  kanban: PharoNexusProjectKanbanConfig,
): VibeKanbanWorkTrackingConfig {
  return {
    provider: "vibe-kanban",
    projectId: kanban.projectId,
  };
}

export function legacyKanbanFromWorkTracking(
  workTracking: WorkTrackingConfig,
): PharoNexusProjectKanbanConfig | undefined {
  if (workTracking.provider !== "vibe-kanban") {
    return undefined;
  }

  return {
    provider: "vibe-kanban",
    projectId: workTracking.projectId ?? null,
  };
}

export function resolveProjectWorkTrackingConfig(
  config: Pick<PharoNexusProjectConfig, "kanban" | "workTracking">,
): WorkTrackingConfig {
  return config.workTracking ?? workTrackingFromLegacyKanban(config.kanban);
}
