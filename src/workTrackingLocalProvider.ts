import fs from "node:fs";
import path from "node:path";
import type {
  CreateWorkItemInput,
  DetectedTracker,
  DetectTrackerInput,
  LocalWorkTrackingConfig,
  NexusProjectContext,
  TrackerCapabilities,
  TrackerProjectRef,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export const localWorkTrackingDirectoryName = ".pharo-nexus";
export const localWorkTrackingStoreFileName = "work-items.json";
export const localWorkTrackingStoreVersion = 1;

const workStatuses = new Set<WorkStatus>([
  "todo",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "wont_do",
]);

export interface LocalWorkTrackingStore {
  version: typeof localWorkTrackingStoreVersion;
  nextNumber: number;
  nextCommentNumber: number;
  updatedAt: string;
  items: WorkItem[];
  comments: Record<string, WorkComment[]>;
}

export interface LocalWorkTrackerProviderOptions {
  projectRoot?: string;
  config?: LocalWorkTrackingConfig;
  storePath?: string | null;
  now?: () => Date | string;
}

export class LocalWorkTrackerProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalWorkTrackerProviderError";
  }
}

export const localWorkTrackerCapabilities: TrackerCapabilities = {
  createItem: true,
  listItems: true,
  getItem: true,
  updateItem: true,
  comment: true,
  labels: true,
  assignees: true,
  milestones: true,
  board: false,
  boardStatus: true,
  draftItems: false,
  webhooks: false,
};

export function defaultLocalWorkTrackingStorePath(projectRoot: string): string {
  return path.join(
    resolveProjectRoot(projectRoot),
    localWorkTrackingDirectoryName,
    localWorkTrackingStoreFileName,
  );
}

export function resolveLocalWorkTrackingStorePath(
  projectRoot: string,
  config?: Pick<LocalWorkTrackingConfig, "storePath"> | string | null,
): string {
  const configuredStorePath =
    typeof config === "string" || config === null
      ? config
      : config?.storePath;

  if (!configuredStorePath) {
    return defaultLocalWorkTrackingStorePath(projectRoot);
  }

  return path.isAbsolute(configuredStorePath)
    ? path.resolve(configuredStorePath)
    : path.resolve(resolveProjectRoot(projectRoot), configuredStorePath);
}

export function createLocalWorkTrackerProvider(
  options: LocalWorkTrackerProviderOptions = {},
): LocalWorkTrackerProvider {
  return new LocalWorkTrackerProvider(options);
}

export class LocalWorkTrackerProvider implements WorkTrackerProvider {
  readonly provider = "local";
  readonly capabilities = localWorkTrackerCapabilities;

  private readonly projectRoot?: string;
  private readonly config?: LocalWorkTrackingConfig;
  private readonly storePath?: string | null;
  private readonly nowProvider: () => Date | string;

  constructor(options: LocalWorkTrackerProviderOptions = {}) {
    this.projectRoot = options.projectRoot;
    this.config = options.config;
    this.storePath = options.storePath;
    this.nowProvider = options.now ?? (() => new Date());
  }

  async detect(input: DetectTrackerInput): Promise<DetectedTracker | undefined> {
    const storePath = this.storePathFor(input.projectRoot);
    if (!fs.existsSync(storePath)) {
      return undefined;
    }

    return {
      confidence: "high",
      config: {
        provider: "local",
        storePath: path.relative(resolveProjectRoot(input.projectRoot), storePath),
      },
      reason: "Found local PharoNexus work item store",
    };
  }

  async ensureProject(
    context: NexusProjectContext,
  ): Promise<TrackerProjectRef> {
    const projectRoot = this.resolveProjectRoot(context.projectRoot);
    const store = this.loadStore(projectRoot);
    this.saveStore(projectRoot, store);

    return {
      provider: "local",
      id: context.projectId,
      name: context.projectName,
      externalRef: {
        provider: "local",
        itemId: context.projectId,
        projectId: context.projectId,
      },
    };
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    const projectRoot = this.resolveProjectRoot(input.projectRoot);
    const store = this.loadStore(projectRoot);
    const number = store.nextNumber;
    const id = `local-${number}`;
    const timestamp = this.now();
    const status = input.status ?? "todo";
    assertWorkStatus(status);

    const item: WorkItem = {
      id,
      title: requiredNonEmptyString(input.title, "title"),
      description: input.description ?? null,
      status,
      provider: "local",
      labels: normalizeStringArray(input.labels, "labels"),
      assignees: normalizeStringArray(input.assignees, "assignees"),
      milestone: optionalNullableString(input.milestone, "milestone") ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
      closedAt: isClosedStatus(status) ? timestamp : null,
      webUrl: null,
      externalRef: {
        provider: "local",
        itemId: id,
        itemNumber: number,
      },
    };

    store.items.push(item);
    store.comments[item.id] = [];
    store.nextNumber += 1;
    this.saveStore(projectRoot, store);
    return item;
  }

  async listWorkItems(query: WorkItemQuery = {}): Promise<WorkItem[]> {
    const projectRoot = this.resolveProjectRoot(query.projectRoot);
    const statuses =
      query.status === undefined
        ? undefined
        : new Set(Array.isArray(query.status) ? query.status : [query.status]);
    if (statuses) {
      for (const status of statuses) {
        assertWorkStatus(status);
      }
    }

    const labels = normalizeStringArray(query.labels, "labels");
    const assignees = normalizeStringArray(query.assignees, "assignees");
    const search = query.search?.trim().toLowerCase();
    const limit = normalizeLimit(query.limit);

    let items = this.loadStore(projectRoot).items.filter((item) => {
      if (statuses && !statuses.has(item.status)) {
        return false;
      }
      if (labels.some((label) => !item.labels?.includes(label))) {
        return false;
      }
      if (assignees.some((assignee) => !item.assignees?.includes(assignee))) {
        return false;
      }
      if (search && !matchesSearch(item, search)) {
        return false;
      }

      return true;
    });

    if (limit !== undefined) {
      items = items.slice(0, limit);
    }

    return items;
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    const store = this.loadStore(this.resolveProjectRoot());
    return findWorkItem(store, ref);
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    const projectRoot = this.resolveProjectRoot();
    const store = this.loadStore(projectRoot);
    const item = findWorkItem(store, ref);
    const timestamp = this.now();

    const updated: WorkItem = {
      ...item,
      updatedAt: timestamp,
    };

    if (patch.title !== undefined) {
      updated.title = requiredNonEmptyString(patch.title, "title");
    }
    if (patch.description !== undefined) {
      updated.description = patch.description;
    }
    if (patch.status !== undefined) {
      assertWorkStatus(patch.status);
      updated.status = patch.status;
      updated.closedAt = isClosedStatus(patch.status)
        ? item.closedAt ?? timestamp
        : null;
    }
    if (patch.labels !== undefined) {
      updated.labels = normalizeStringArray(patch.labels, "labels");
    }
    if (patch.assignees !== undefined) {
      updated.assignees = normalizeStringArray(patch.assignees, "assignees");
    }
    if (patch.milestone !== undefined) {
      updated.milestone = optionalNullableString(patch.milestone, "milestone");
    }

    store.items[store.items.indexOf(item)] = updated;
    this.saveStore(projectRoot, store);
    return updated;
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    const projectRoot = this.resolveProjectRoot();
    const store = this.loadStore(projectRoot);
    const item = findWorkItem(store, ref);
    const timestamp = this.now();
    const id = `local-comment-${store.nextCommentNumber}`;
    const comment: WorkComment = {
      id,
      body: requiredNonEmptyString(body, "body"),
      author: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      externalRef: {
        provider: "local",
        itemId: id,
      },
    };

    store.nextCommentNumber += 1;
    store.comments[item.id] = [...(store.comments[item.id] ?? []), comment];
    item.updatedAt = timestamp;
    this.saveStore(projectRoot, store);
    return comment;
  }

  async setStatus(ref: WorkItemRef, status: WorkStatus): Promise<WorkItem> {
    return this.updateWorkItem(ref, { status });
  }

  private resolveProjectRoot(projectRoot?: string): string {
    return resolveProjectRoot(projectRoot ?? this.projectRoot);
  }

  private storePathFor(projectRoot: string): string {
    return resolveLocalWorkTrackingStorePath(
      projectRoot,
      this.storePath ?? this.config,
    );
  }

  private loadStore(projectRoot: string): LocalWorkTrackingStore {
    return loadLocalWorkTrackingStore(this.storePathFor(projectRoot), this.now());
  }

  private saveStore(projectRoot: string, store: LocalWorkTrackingStore): void {
    saveLocalWorkTrackingStore(this.storePathFor(projectRoot), {
      ...store,
      updatedAt: this.now(),
    });
  }

  private now(): string {
    const value = this.nowProvider();
    return typeof value === "string" ? value : value.toISOString();
  }
}

export function loadLocalWorkTrackingStore(
  storePath: string,
  timestamp: string = new Date().toISOString(),
): LocalWorkTrackingStore {
  if (!fs.existsSync(storePath)) {
    return emptyStore(timestamp);
  }

  const raw = JSON.parse(fs.readFileSync(storePath, "utf8").replace(/^\uFEFF/, ""));
  return validateStore(raw);
}

export function saveLocalWorkTrackingStore(
  storePath: string,
  store: LocalWorkTrackingStore,
): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(
    storePath,
    `${JSON.stringify(validateStore(store), null, 2)}\n`,
    "utf8",
  );
}

function emptyStore(timestamp: string): LocalWorkTrackingStore {
  return {
    version: localWorkTrackingStoreVersion,
    nextNumber: 1,
    nextCommentNumber: 1,
    updatedAt: timestamp,
    items: [],
    comments: {},
  };
}

function resolveProjectRoot(projectRoot: string | undefined): string {
  if (!projectRoot || projectRoot.trim().length === 0) {
    throw new LocalWorkTrackerProviderError("projectRoot is required");
  }

  return path.resolve(projectRoot);
}

function validateStore(value: unknown): LocalWorkTrackingStore {
  const record = assertRecord(value, "local work tracking store");
  if (record.version !== localWorkTrackingStoreVersion) {
    throw new LocalWorkTrackerProviderError(
      `local work tracking store.version must be ${localWorkTrackingStoreVersion}`,
    );
  }

  const items = record.items;
  if (!Array.isArray(items)) {
    throw new LocalWorkTrackerProviderError(
      "local work tracking store.items must be an array",
    );
  }

  return {
    version: localWorkTrackingStoreVersion,
    nextNumber: positiveInteger(record.nextNumber, "nextNumber"),
    nextCommentNumber: positiveInteger(
      record.nextCommentNumber,
      "nextCommentNumber",
    ),
    updatedAt: requiredNonEmptyString(record.updatedAt, "updatedAt"),
    items: items.map(validateWorkItem),
    comments: validateComments(record.comments),
  };
}

function validateWorkItem(value: unknown, index: number): WorkItem {
  const record = assertRecord(value, `items[${index}]`);
  if (record.provider !== "local") {
    throw new LocalWorkTrackerProviderError(
      `items[${index}].provider must be local`,
    );
  }

  const status = workStatus(record.status, `items[${index}].status`);
  return {
    id: requiredNonEmptyString(record.id, `items[${index}].id`),
    title: requiredNonEmptyString(record.title, `items[${index}].title`),
    description:
      optionalNullableText(record.description, `items[${index}].description`) ??
      null,
    status,
    provider: "local",
    labels: stringArray(record.labels, `items[${index}].labels`),
    assignees: stringArray(record.assignees, `items[${index}].assignees`),
    milestone:
      optionalNullableString(record.milestone, `items[${index}].milestone`) ??
      null,
    createdAt:
      optionalNullableString(record.createdAt, `items[${index}].createdAt`) ??
      null,
    updatedAt:
      optionalNullableString(record.updatedAt, `items[${index}].updatedAt`) ??
      null,
    closedAt:
      optionalNullableString(record.closedAt, `items[${index}].closedAt`) ??
      null,
    webUrl:
      optionalNullableString(record.webUrl, `items[${index}].webUrl`) ?? null,
    externalRef: {
      provider: "local",
      itemId: requiredNonEmptyString(record.id, `items[${index}].id`),
      itemNumber: localItemNumber(record),
    },
  };
}

function validateComments(value: unknown): Record<string, WorkComment[]> {
  if (value === undefined) {
    return {};
  }

  const record = assertRecord(value, "comments");
  const comments: Record<string, WorkComment[]> = {};
  for (const [itemId, itemComments] of Object.entries(record)) {
    if (!Array.isArray(itemComments)) {
      throw new LocalWorkTrackerProviderError(
        `comments.${itemId} must be an array`,
      );
    }

    comments[itemId] = itemComments.map((comment, index) =>
      validateComment(comment, `comments.${itemId}[${index}]`),
    );
  }

  return comments;
}

function validateComment(value: unknown, pathName: string): WorkComment {
  const record = assertRecord(value, pathName);
  return {
    id: requiredNonEmptyString(record.id, `${pathName}.id`),
    body: requiredNonEmptyString(record.body, `${pathName}.body`),
    author: optionalNullableString(record.author, `${pathName}.author`) ?? null,
    createdAt:
      optionalNullableString(record.createdAt, `${pathName}.createdAt`) ?? null,
    updatedAt:
      optionalNullableString(record.updatedAt, `${pathName}.updatedAt`) ?? null,
    externalRef: {
      provider: "local",
      itemId: requiredNonEmptyString(record.id, `${pathName}.id`),
    },
  };
}

function findWorkItem(store: LocalWorkTrackingStore, ref: WorkItemRef): WorkItem {
  if (ref.provider && ref.provider !== "local") {
    throw new LocalWorkTrackerProviderError(
      `local provider cannot resolve ${ref.provider} work item refs`,
    );
  }
  if (ref.externalRef?.provider && ref.externalRef.provider !== "local") {
    throw new LocalWorkTrackerProviderError(
      `local provider cannot resolve ${ref.externalRef.provider} external refs`,
    );
  }

  const id = ref.id ?? ref.externalRef?.itemId;
  if (!id) {
    throw new LocalWorkTrackerProviderError("work item id is required");
  }

  const item = store.items.find((candidate) => candidate.id === id);
  if (!item) {
    throw new LocalWorkTrackerProviderError(`Local work item not found: ${id}`);
  }

  return item;
}

function matchesSearch(item: WorkItem, search: string): boolean {
  return [item.id, item.title, item.description ?? ""].some((value) =>
    value.toLowerCase().includes(search),
  );
}

function localItemNumber(record: Record<string, unknown>): number | null {
  const externalRef =
    record.externalRef && typeof record.externalRef === "object"
      ? (record.externalRef as Record<string, unknown>)
      : undefined;
  const itemNumber = externalRef?.itemNumber;
  return typeof itemNumber === "number" && Number.isInteger(itemNumber)
    ? itemNumber
    : null;
}

function isClosedStatus(status: WorkStatus): boolean {
  return status === "done" || status === "wont_do";
}

function assertWorkStatus(status: WorkStatus): void {
  if (!workStatuses.has(status)) {
    throw new LocalWorkTrackerProviderError(`Invalid work status: ${status}`);
  }
}

function workStatus(value: unknown, pathName: string): WorkStatus {
  if (typeof value !== "string" || !workStatuses.has(value as WorkStatus)) {
    throw new LocalWorkTrackerProviderError(`${pathName} must be a valid status`);
  }

  return value as WorkStatus;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new LocalWorkTrackerProviderError(
      "limit must be a non-negative integer",
    );
  }

  return limit;
}

function normalizeStringArray(
  values: string[] | undefined,
  pathName: string,
): string[] {
  if (values === undefined) {
    return [];
  }

  return stringArray(values, pathName);
}

function stringArray(value: unknown, pathName: string): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new LocalWorkTrackerProviderError(`${pathName} must be an array`);
  }

  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    const normalized = requiredNonEmptyString(item, pathName);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function optionalNullableString(
  value: unknown,
  pathName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, pathName);
}

function optionalNullableText(
  value: unknown,
  pathName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new LocalWorkTrackerProviderError(`${pathName} must be a string`);
  }

  return value;
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LocalWorkTrackerProviderError(
      `${pathName} must be a non-empty string`,
    );
  }

  return value.trim();
}

function positiveInteger(value: unknown, pathName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new LocalWorkTrackerProviderError(
      `${pathName} must be a positive integer`,
    );
  }

  return value;
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalWorkTrackerProviderError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}
