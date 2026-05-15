import {
  ensureVibeKanbanBoard,
  type EnsureVibeKanbanBoardOptions,
  type EnsureVibeKanbanBoardResult,
} from "./vibeKanbanBoardAdapter.js";
import {
  registerVibeKanbanProject,
  type RegisterVibeKanbanProjectResult,
} from "./vibeKanbanProjectAdapter.js";
import type { VibeKanbanApiOptions } from "./vibeKanbanMcpConfig.js";
import type {
  CreateWorkItemInput,
  NexusProjectContext,
  TrackerBoardRef,
  TrackerCapabilities,
  TrackerProjectRef,
  VibeKanbanWorkTrackingConfig,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
} from "dev-nexus";

export interface VibeWorkTrackerProviderOptions extends VibeKanbanApiOptions {
  config?: VibeKanbanWorkTrackingConfig;
  color?: string;
}

export interface VibeTrackerProjectRef extends TrackerProjectRef {
  vibeKanbanRepo: RegisterVibeKanbanProjectResult;
}

export interface VibeTrackerBoardRef extends TrackerBoardRef {
  vibeKanbanBoard: EnsureVibeKanbanBoardResult;
}

export class VibeWorkTrackerProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeWorkTrackerProviderError";
  }
}

export const vibeWorkTrackerCapabilities: TrackerCapabilities = {
  createItem: false,
  listItems: false,
  getItem: false,
  updateItem: false,
  comment: false,
  labels: false,
  assignees: false,
  milestones: false,
  board: true,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

export function createVibeWorkTrackerProvider(
  options: VibeWorkTrackerProviderOptions,
): VibeWorkTrackerProvider {
  return new VibeWorkTrackerProvider(options);
}

export class VibeWorkTrackerProvider implements WorkTrackerProvider {
  readonly provider = "vibe-kanban";
  readonly capabilities = vibeWorkTrackerCapabilities;

  private readonly options: VibeWorkTrackerProviderOptions;

  constructor(options: VibeWorkTrackerProviderOptions) {
    this.options = options;
  }

  async ensureProject(
    context: NexusProjectContext,
  ): Promise<VibeTrackerProjectRef> {
    const projectRoot = sourceRootFor(context);
    const result = await registerVibeKanbanProject({
      ...this.vibeProjectOptions(),
      projectRoot,
      name: context.projectName,
    });
    const name =
      result.project.display_name ?? result.project.name ?? context.projectName;

    return {
      provider: "vibe-kanban",
      id: result.projectId,
      name,
      vibeKanbanRepo: result,
      externalRef: {
        provider: "vibe-kanban",
        host: this.options.host ?? null,
        itemId: result.projectId,
        projectId: result.projectId,
        repositoryId: result.projectId,
      },
    };
  }

  async ensureBoard(
    context: NexusProjectContext,
  ): Promise<VibeTrackerBoardRef> {
    const result = await ensureVibeKanbanBoard({
      ...this.vibeBoardOptions(),
      name: context.projectName,
      color: this.options.color,
    });

    return {
      provider: "vibe-kanban",
      id: result.boardId,
      name: result.board.name,
      vibeKanbanBoard: result,
      externalRef: {
        provider: "vibe-kanban",
        host: this.options.host ?? null,
        itemId: result.boardId,
        projectId: result.boardId,
        boardId: result.boardId,
      },
    };
  }

  async createWorkItem(_input: CreateWorkItemInput): Promise<WorkItem> {
    throw unsupportedVibeWorkItemsError("createWorkItem");
  }

  async listWorkItems(_query: WorkItemQuery): Promise<WorkItem[]> {
    throw unsupportedVibeWorkItemsError("listWorkItems");
  }

  async getWorkItem(_ref: WorkItemRef): Promise<WorkItem> {
    throw unsupportedVibeWorkItemsError("getWorkItem");
  }

  async updateWorkItem(
    _ref: WorkItemRef,
    _patch: WorkItemPatch,
  ): Promise<WorkItem> {
    throw unsupportedVibeWorkItemsError("updateWorkItem");
  }

  async addComment(_ref: WorkItemRef, _body: string): Promise<WorkComment> {
    throw unsupportedVibeWorkItemsError("addComment");
  }

  async setStatus(_ref: WorkItemRef, _status: WorkStatus): Promise<WorkItem> {
    throw unsupportedVibeWorkItemsError("setStatus");
  }

  private vibeProjectOptions(): VibeKanbanApiOptions {
    return {
      host: this.options.host,
      port: this.options.port,
      fetch: this.options.fetch,
    };
  }

  private vibeBoardOptions(): EnsureVibeKanbanBoardOptions {
    return {
      host: this.options.host,
      port: this.options.port,
      fetch: this.options.fetch,
      organizationId: this.options.config?.board?.owner ?? undefined,
      name: "",
    };
  }
}

function sourceRootFor(context: NexusProjectContext): string {
  const projectRoot = context.sourceRoot ?? context.projectRoot;
  if (projectRoot.trim().length === 0) {
    throw new VibeWorkTrackerProviderError("projectRoot is required");
  }

  return projectRoot;
}

function unsupportedVibeWorkItemsError(operation: string): VibeWorkTrackerProviderError {
  return new VibeWorkTrackerProviderError(
    `Vibe Kanban provider does not support neutral work item operation: ${operation}`,
  );
}
