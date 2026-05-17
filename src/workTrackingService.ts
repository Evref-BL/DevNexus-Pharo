import type {
  NexusProjectConfig,
  NexusProjectKanbanConfig,
} from "./config.js";
import {
  createWorkTrackerProvider as createDevNexusWorkTrackerProvider,
  WorkTrackingProviderServiceError,
  type CreateWorkTrackerProviderOptions as DevNexusWorkTrackerProviderOptions,
  type VibeKanbanApiOptions,
  VibeKanbanWorkTrackingConfig,
  WorkTrackingConfig,
  WorkTrackerProvider,
} from "dev-nexus";

export interface CreateWorkTrackerProviderOptions {
  projectRoot?: string;
  now?: () => Date | string;
  vibeKanban?: VibeKanbanApiOptions;
  github?: DevNexusWorkTrackerProviderOptions["github"];
  gitlab?: DevNexusWorkTrackerProviderOptions["gitlab"];
  jira?: DevNexusWorkTrackerProviderOptions["jira"];
}

export class WorkTrackingServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkTrackingServiceError";
  }
}

export function workTrackingFromLegacyKanban(
  kanban: NexusProjectKanbanConfig,
): VibeKanbanWorkTrackingConfig {
  return {
    provider: "vibe-kanban",
    projectId: kanban.projectId,
  };
}

export function legacyKanbanFromWorkTracking(
  workTracking: WorkTrackingConfig,
): NexusProjectKanbanConfig | undefined {
  if (workTracking.provider !== "vibe-kanban") {
    return undefined;
  }

  return {
    provider: "vibe-kanban",
    projectId: workTracking.projectId ?? null,
  };
}

export function resolveProjectWorkTrackingConfig(
  config: Pick<NexusProjectConfig, "kanban" | "workTracking">,
): WorkTrackingConfig {
  if (config.workTracking) {
    return config.workTracking;
  }

  if (config.kanban) {
    return workTrackingFromLegacyKanban(config.kanban);
  }

  throw new WorkTrackingServiceError(
    "Project does not define workTracking or legacy kanban configuration",
  );
}

export function createWorkTrackerProvider(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  try {
    return createDevNexusWorkTrackerProvider(config, {
      projectRoot: options.projectRoot,
      now: options.now,
      vibeKanban: options.vibeKanban,
      github: options.github,
      gitlab: options.gitlab,
      jira: options.jira,
    });
  } catch (error) {
    if (error instanceof WorkTrackingProviderServiceError) {
      throw new WorkTrackingServiceError(error.message);
    }

    throw error;
  }
}

export function createProjectWorkTrackerProvider(
  config: Pick<NexusProjectConfig, "kanban" | "workTracking">,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  return createWorkTrackerProvider(resolveProjectWorkTrackingConfig(config), options);
}
