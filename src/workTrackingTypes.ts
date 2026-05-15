export type WorkTrackingProviderName =
  | "local"
  | "vibe-kanban"
  | "github"
  | "gitlab"
  | "jira";

export type WorkStatus =
  | "todo"
  | "ready"
  | "in_progress"
  | "blocked"
  | "done"
  | "wont_do";

export interface WorkTrackingRepositoryConfig {
  owner?: string;
  name?: string;
  id?: string;
  path?: string;
}

export interface WorkTrackingBoardConfig {
  kind: string;
  id?: string | null;
  number?: number | null;
  owner?: string | null;
  ownerKind?: string | null;
  projectId?: string | null;
  statusFieldId?: string | null;
  statusOptions?: Record<string, string>;
}

export interface BaseWorkTrackingConfig {
  provider: WorkTrackingProviderName;
  host?: string | null;
  repository?: WorkTrackingRepositoryConfig;
  board?: WorkTrackingBoardConfig | null;
}

export interface LocalWorkTrackingConfig extends BaseWorkTrackingConfig {
  provider: "local";
  storePath?: string | null;
}

export interface VibeKanbanWorkTrackingConfig extends BaseWorkTrackingConfig {
  provider: "vibe-kanban";
  projectId?: string | null;
  repoId?: string | null;
}

export interface GitHubWorkTrackingConfig extends BaseWorkTrackingConfig {
  provider: "github";
  repository: WorkTrackingRepositoryConfig & {
    owner: string;
    name: string;
  };
}

export interface GitLabWorkTrackingConfig extends BaseWorkTrackingConfig {
  provider: "gitlab";
  repository: WorkTrackingRepositoryConfig & {
    id: string;
  };
}

export interface JiraWorkTrackingConfig extends BaseWorkTrackingConfig {
  provider: "jira";
  projectKey: string;
  issueType?: string | null;
}

export type WorkTrackingConfig =
  | LocalWorkTrackingConfig
  | VibeKanbanWorkTrackingConfig
  | GitHubWorkTrackingConfig
  | GitLabWorkTrackingConfig
  | JiraWorkTrackingConfig;

export interface ExternalRef {
  provider: WorkTrackingProviderName | string;
  host?: string | null;
  repositoryId?: string | null;
  repositoryOwner?: string | null;
  repositoryName?: string | null;
  projectId?: string | null;
  boardId?: string | null;
  itemId: string;
  itemNumber?: number | null;
  itemKey?: string | null;
  nodeId?: string | null;
  webUrl?: string | null;
}

export interface WorkBoard {
  id: string;
  name: string;
  provider: WorkTrackingProviderName | string;
  externalRef?: ExternalRef;
  webUrl?: string | null;
}

export interface WorkComment {
  id: string;
  body: string;
  author?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  externalRef?: ExternalRef;
}

export interface WorkItem {
  id: string;
  title: string;
  description?: string | null;
  status: WorkStatus;
  provider: WorkTrackingProviderName | string;
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  closedAt?: string | null;
  webUrl?: string | null;
  externalRef?: ExternalRef;
}

export interface WorkItemRef {
  provider?: WorkTrackingProviderName | string;
  id?: string;
  externalRef?: ExternalRef;
}

export interface WorkItemQuery {
  projectRoot?: string;
  status?: WorkStatus | WorkStatus[];
  labels?: string[];
  assignees?: string[];
  search?: string;
  limit?: number;
}

export interface CreateWorkItemInput {
  projectRoot?: string;
  title: string;
  description?: string | null;
  status?: WorkStatus;
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
}

export interface WorkItemPatch {
  title?: string;
  description?: string | null;
  status?: WorkStatus;
  labels?: string[];
  assignees?: string[];
  milestone?: string | null;
}

export interface TrackerCapabilities {
  createItem: boolean;
  listItems: boolean;
  getItem: boolean;
  updateItem: boolean;
  comment: boolean;
  labels: boolean;
  assignees: boolean;
  milestones: boolean;
  board: boolean;
  boardStatus: boolean;
  draftItems: boolean;
  webhooks: boolean;
}

export interface TrackerProjectRef {
  provider: WorkTrackingProviderName | string;
  id: string;
  name?: string;
  externalRef?: ExternalRef;
}

export interface TrackerBoardRef {
  provider: WorkTrackingProviderName | string;
  id: string;
  name?: string;
  externalRef?: ExternalRef;
}

export interface DetectedTracker {
  confidence: "low" | "medium" | "high";
  config: WorkTrackingConfig;
  reason?: string;
}

export interface DetectTrackerInput {
  projectRoot: string;
  remoteUrl?: string | null;
}

export interface NexusProjectContext {
  homePath: string;
  projectRoot: string;
  projectId: string;
  projectName: string;
  sourceRoot?: string;
  workTracking?: WorkTrackingConfig;
}

export interface WorkTrackerProvider {
  provider: WorkTrackingProviderName | string;
  capabilities: TrackerCapabilities;
  detect?(input: DetectTrackerInput): Promise<DetectedTracker | undefined>;
  ensureProject?(context: NexusProjectContext): Promise<TrackerProjectRef>;
  ensureBoard?(context: NexusProjectContext): Promise<TrackerBoardRef>;
  createWorkItem(input: CreateWorkItemInput): Promise<WorkItem>;
  listWorkItems(query: WorkItemQuery): Promise<WorkItem[]>;
  getWorkItem(ref: WorkItemRef): Promise<WorkItem>;
  updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem>;
  addComment(ref: WorkItemRef, body: string): Promise<WorkComment>;
  setStatus?(ref: WorkItemRef, status: WorkStatus): Promise<WorkItem>;
}
