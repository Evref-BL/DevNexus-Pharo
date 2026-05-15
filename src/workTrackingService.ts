import type {
  NexusProjectConfig,
  NexusProjectKanbanConfig,
} from "./config.js";
import type { VibeKanbanApiOptions } from "./vibeKanbanMcpConfig.js";
import {
  createGitHubWorkTrackerProvider,
  type GitHubWorkTrackerProviderOptions,
} from "dev-nexus";
import {
  createGitLabWorkTrackerProvider,
  type GitLabWorkTrackerProviderOptions,
} from "dev-nexus";
import {
  createJiraWorkTrackerProvider,
  type JiraWorkTrackerProviderOptions,
} from "dev-nexus";
import { createLocalWorkTrackerProvider } from "dev-nexus";
import { createVibeWorkTrackerProvider } from "./workTrackingVibeProvider.js";
import type {
  GitHubWorkTrackingConfig,
  GitLabWorkTrackingConfig,
  JiraWorkTrackingConfig,
  VibeKanbanWorkTrackingConfig,
  WorkTrackingConfig,
  WorkTrackerProvider,
} from "dev-nexus";

export interface CreateWorkTrackerProviderOptions {
  projectRoot?: string;
  now?: () => Date | string;
  vibeKanban?: VibeKanbanApiOptions;
  github?: Omit<GitHubWorkTrackerProviderOptions, "config">;
  gitlab?: Omit<GitLabWorkTrackerProviderOptions, "config">;
  jira?: Omit<JiraWorkTrackerProviderOptions, "config">;
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
  if (config.provider === "local") {
    return createLocalWorkTrackerProvider({
      projectRoot: options.projectRoot,
      config,
      now: options.now,
    });
  }

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

  if (config.provider === "github") {
    return createGitHubWorkTrackerProvider({
      ...options.github,
      config: config as GitHubWorkTrackingConfig,
    });
  }

  if (config.provider === "gitlab") {
    return createGitLabWorkTrackerProvider({
      ...options.gitlab,
      config: config as GitLabWorkTrackingConfig,
    });
  }

  if (config.provider === "jira") {
    return createJiraWorkTrackerProvider({
      ...options.jira,
      config: config as JiraWorkTrackingConfig,
    });
  }

  const unsupportedConfig = config as { provider: string };
  throw new WorkTrackingServiceError(
    `Work tracking provider is not implemented yet: ${unsupportedConfig.provider}`,
  );
}

export function createProjectWorkTrackerProvider(
  config: Pick<NexusProjectConfig, "kanban" | "workTracking">,
  options: CreateWorkTrackerProviderOptions = {},
): WorkTrackerProvider {
  return createWorkTrackerProvider(resolveProjectWorkTrackingConfig(config), options);
}
