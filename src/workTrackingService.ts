import type {
  NexusProjectConfig,
  NexusProjectKanbanConfig,
} from "./config.js";
import type { VibeKanbanApiOptions } from "./vibeKanbanMcpConfig.js";
import {
  createWorkTrackerProvider as createDevNexusWorkTrackerProvider,
  WorkTrackingProviderServiceError,
  type CreateWorkTrackerProviderOptions as DevNexusWorkTrackerProviderOptions,
  VibeKanbanWorkTrackingConfig,
  WorkTrackingConfig,
  WorkTrackerProvider,
} from "dev-nexus";
import { createVibeWorkTrackerProvider } from "./workTrackingVibeProvider.js";

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
  return config.workTracking ?? workTrackingFromLegacyKanban(config.kanban);
}

export function createWorkTrackerProvider(
  config: WorkTrackingConfig,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  if (config.provider === "vibe-kanban") {
    if (!options.vibeKanban) {
      throw new WorkTrackingServiceError(
        "Vibe Kanban provider requires Vibe Kanban API options",
      );
    }

    return createVibeWorkTrackerProvider({
      ...options.vibeKanban,
      config,
    });
  }

  try {
    return createDevNexusWorkTrackerProvider(config, {
      projectRoot: options.projectRoot,
      now: options.now,
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
