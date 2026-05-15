import type {
  PharoNexusProjectConfig,
  PharoNexusProjectKanbanConfig,
} from "./config.js";
import { createLocalWorkTrackerProvider } from "./workTrackingLocalProvider.js";
import type {
  VibeKanbanWorkTrackingConfig,
  WorkTrackingConfig,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export interface CreateWorkTrackerProviderOptions {
  projectRoot?: string;
  now?: () => Date | string;
}

export class WorkTrackingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkTrackingServiceError";
  }
}

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

export function createWorkTrackerProvider(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  if (config.provider === "local") {
    return createLocalWorkTrackerProvider({
      projectRoot: options.projectRoot,
      config,
      now: options.now,
    });
  }

  throw new WorkTrackingServiceError(
    `Work tracking provider is not implemented yet: ${config.provider}`,
  );
}

export function createProjectWorkTrackerProvider(
  config: Pick<PharoNexusProjectConfig, "kanban" | "workTracking">,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  return createWorkTrackerProvider(resolveProjectWorkTrackingConfig(config), options);
}
