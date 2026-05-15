import path from "node:path";
import {
  loadProjectConfig,
  type PharoNexusProjectConfig,
} from "./config.js";
import {
  getPharoNexusProjectStatus,
  type PharoNexusProjectStatus,
} from "./projectService.js";
import {
  createProjectWorkTrackerProvider,
  resolveProjectWorkTrackingConfig,
  WorkTrackingServiceError,
} from "./workTrackingService.js";
import type {
  CreateWorkItemInput,
  NexusProjectContext,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
  WorkTrackingConfig,
} from "./workTrackingTypes.js";

export interface WorkItemProjectSelector {
  project?: string;
  projectRoot?: string;
}

export interface WorkItemServiceOptions {
  homePath: string;
  now?: () => Date | string;
}

export type CreateProjectWorkItemInput = WorkItemProjectSelector &
  Omit<CreateWorkItemInput, "projectRoot">;

export type ListProjectWorkItemsInput = WorkItemProjectSelector &
  Omit<WorkItemQuery, "projectRoot">;

export type GetProjectWorkItemInput = WorkItemProjectSelector & WorkItemRef;

export interface UpdateProjectWorkItemInput extends WorkItemProjectSelector {
  ref: WorkItemRef;
  patch: WorkItemPatch;
}

export interface AddProjectWorkItemCommentInput extends WorkItemProjectSelector {
  ref: WorkItemRef;
  body: string;
}

export interface SetProjectWorkItemStatusInput extends WorkItemProjectSelector {
  ref: WorkItemRef;
  status: WorkStatus;
}

export interface ResolvedWorkItemProviderContext {
  homePath: string;
  projectRoot: string;
  projectStatus: PharoNexusProjectStatus;
  projectConfig: PharoNexusProjectConfig;
  projectContext: NexusProjectContext;
  workTracking: WorkTrackingConfig;
  provider: WorkTrackerProvider;
}

export class WorkItemServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkItemServiceError";
  }
}

export function createWorkItemService(
  options: WorkItemServiceOptions,
): WorkItemService {
  return new WorkItemService(options);
}

export class WorkItemService {
  private readonly homePath: string;
  private readonly now?: () => Date | string;

  constructor(options: WorkItemServiceOptions) {
    this.homePath = requiredNonEmptyString(options.homePath, "homePath");
    this.now = options.now;
  }

  resolveProviderContext(
    selector: WorkItemProjectSelector,
  ): ResolvedWorkItemProviderContext {
    const projectSelector = normalizeProjectSelector(selector);
    const projectStatus = getPharoNexusProjectStatus({
      homePath: this.homePath,
      project: projectSelector,
    }).project;
    const projectRoot = projectStatus.projectRoot;
    const projectConfig = loadProjectConfig(projectRoot);
    const workTracking = resolveProjectWorkTrackingConfig(projectConfig);
    const projectContext: NexusProjectContext = {
      homePath: this.homePath,
      projectRoot,
      projectId: projectConfig.id,
      projectName: projectConfig.name,
      sourceRoot: resolveProjectSourceRoot(projectRoot, projectConfig),
      workTracking,
    };

    try {
      return {
        homePath: this.homePath,
        projectRoot,
        projectStatus,
        projectConfig,
        projectContext,
        workTracking,
        provider: createProjectWorkTrackerProvider(projectConfig, {
          projectRoot,
          now: this.now,
        }),
      };
    } catch (error) {
      if (error instanceof WorkTrackingServiceError) {
        throw new WorkItemServiceError(
          `Project "${projectConfig.id}" uses work tracking provider ` +
            `"${workTracking.provider}", but it is not available: ${error.message}`,
        );
      }

      throw error;
    }
  }

  async createWorkItem(input: CreateProjectWorkItemInput): Promise<WorkItem> {
    const { project: _project, projectRoot: _projectRoot, ...item } = input;
    const context = this.resolveProviderContext(input);
    return context.provider.createWorkItem({
      ...item,
      projectRoot: context.projectRoot,
    });
  }

  async listWorkItems(input: ListProjectWorkItemsInput): Promise<WorkItem[]> {
    const { project: _project, projectRoot: _projectRoot, ...query } = input;
    const context = this.resolveProviderContext(input);
    return context.provider.listWorkItems({
      ...query,
      projectRoot: context.projectRoot,
    });
  }

  async getWorkItem(input: GetProjectWorkItemInput): Promise<WorkItem> {
    const { project: _project, projectRoot: _projectRoot, ...ref } = input;
    const context = this.resolveProviderContext(input);
    return context.provider.getWorkItem(
      normalizeWorkItemRef(ref, context.provider.provider),
    );
  }

  async updateWorkItem(input: UpdateProjectWorkItemInput): Promise<WorkItem> {
    const context = this.resolveProviderContext(input);
    return context.provider.updateWorkItem(
      normalizeWorkItemRef(input.ref, context.provider.provider),
      input.patch,
    );
  }

  async addComment(
    input: AddProjectWorkItemCommentInput,
  ): Promise<WorkComment> {
    const context = this.resolveProviderContext(input);
    return context.provider.addComment(
      normalizeWorkItemRef(input.ref, context.provider.provider),
      input.body,
    );
  }

  async setStatus(input: SetProjectWorkItemStatusInput): Promise<WorkItem> {
    const context = this.resolveProviderContext(input);
    const ref = normalizeWorkItemRef(input.ref, context.provider.provider);
    if (context.provider.setStatus) {
      return context.provider.setStatus(ref, input.status);
    }

    return context.provider.updateWorkItem(ref, { status: input.status });
  }
}

export function normalizeProjectSelector(
  selector: WorkItemProjectSelector,
): string {
  const project = optionalNonEmptyString(selector.project, "project");
  const projectRoot = optionalNonEmptyString(selector.projectRoot, "projectRoot");
  if (project && projectRoot) {
    throw new WorkItemServiceError("Provide either project or projectRoot, not both");
  }
  if (!project && !projectRoot) {
    throw new WorkItemServiceError("project or projectRoot is required");
  }

  return project ?? projectRoot!;
}

export function normalizeWorkItemRef(
  ref: WorkItemRef,
  provider: string,
): WorkItemRef {
  const refProvider = ref.provider ?? ref.externalRef?.provider;
  if (refProvider && refProvider !== provider) {
    throw new WorkItemServiceError(
      `work item ref provider "${refProvider}" does not match configured provider "${provider}"`,
    );
  }
  if (!ref.id && !ref.externalRef?.itemId) {
    throw new WorkItemServiceError("work item id or externalRef.itemId is required");
  }

  return {
    ...ref,
    provider: refProvider ?? provider,
  };
}

function resolveProjectSourceRoot(
  projectRoot: string,
  projectConfig: PharoNexusProjectConfig,
): string {
  const sourceRoot = projectConfig.repo.sourceRoot;
  if (!sourceRoot) {
    return path.resolve(projectRoot);
  }

  return path.isAbsolute(sourceRoot)
    ? path.resolve(sourceRoot)
    : path.resolve(projectRoot, sourceRoot);
}

function optionalNonEmptyString(
  value: string | undefined,
  name: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requiredNonEmptyString(value, name);
}

function requiredNonEmptyString(value: string, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkItemServiceError(`${name} must be a non-empty string`);
  }

  return value.trim();
}
