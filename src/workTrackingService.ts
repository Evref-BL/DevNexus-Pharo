import type { NexusProjectConfig } from "./config.js";
import {
  createWorkTrackerProvider as createDevNexusWorkTrackerProvider,
  WorkTrackingProviderServiceError,
  type CreateWorkTrackerProviderOptions as DevNexusWorkTrackerProviderOptions,
  type VibeKanbanApiOptions,
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

export function resolveProjectWorkTrackingConfig(
  config: Pick<NexusProjectConfig, "kanban" | "workTracking">,
): WorkTrackingConfig {
  if (config.workTracking) {
    return config.workTracking;
  }

  if (config.kanban) {
    throw new WorkTrackingServiceError(
      'Project config uses obsolete "kanban" work tracking metadata without "workTracking". Regenerate this project through current DevNexus/DevNexus-Pharo setup or add an explicit workTracking block.',
    );
  }

  throw new WorkTrackingServiceError(
    'Project config must define an explicit "workTracking" block. Regenerate this project through current DevNexus/DevNexus-Pharo setup or add workTracking before using work-item tools.',
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
