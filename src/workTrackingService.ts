import type { NexusProjectConfig } from "./config.js";
import {
  createWorkTrackerProvider as createDevNexusWorkTrackerProvider,
  WorkTrackingProviderServiceError,
  type CreateWorkTrackerProviderOptions as DevNexusWorkTrackerProviderOptions,
  WorkTrackingConfig,
  WorkTrackerProvider,
} from "dev-nexus";

export interface CreateWorkTrackerProviderOptions {
  projectRoot?: string;
  now?: () => Date | string;
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
  config: Pick<NexusProjectConfig, "workTracking">,
): WorkTrackingConfig {
  if (config.workTracking) {
    return config.workTracking;
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
  config: Pick<NexusProjectConfig, "workTracking">,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  return createWorkTrackerProvider(resolveProjectWorkTrackingConfig(config), options);
}
