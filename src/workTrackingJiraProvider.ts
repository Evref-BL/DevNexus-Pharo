import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import type {
  CreateWorkItemInput,
  ExternalRef,
  JiraWorkTrackingConfig,
  TrackerCapabilities,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export const jiraStatusLabelPrefix = "status:";
export const jiraRestApiPath = "/rest/api/3";

const openStatuses = new Set<WorkStatus>([
  "todo",
  "ready",
  "in_progress",
  "blocked",
]);
const closedStatuses = new Set<WorkStatus>(["done", "wont_do"]);
const workStatuses = new Set<WorkStatus>([
  ...openStatuses,
  ...closedStatuses,
]);
const jiraIssueFields = [
  "summary",
  "description",
  "status",
  "labels",
  "assignee",
  "created",
  "updated",
  "resolutiondate",
  "issuetype",
  "project",
];

export interface JiraWorkTrackerProviderOptions {
  config: JiraWorkTrackingConfig;
  email?: string | null;
  apiToken?: string | null;
  token?: string | null;
  fetch?: typeof fetch;
  apiBaseUrl?: string | null;
  env?: Record<string, string | undefined>;
  credentialRunner?: JiraCredentialRunner | false;
  credentialInteractive?: boolean;
}

export interface JiraCredentialCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface JiraCredentialRequest {
  protocol: "https";
  host: string;
}

export type JiraCredentialRunner = (
  request: JiraCredentialRequest,
  options: { interactive: boolean },
) => JiraCredentialCommandResult;

interface JiraAdfDocument {
  type: "doc";
  version: 1;
  content: JiraAdfNode[];
}

interface JiraAdfNode {
  type: string;
  text?: string;
  content?: JiraAdfNode[];
}

interface JiraIssue {
  id: string;
  key: string;
  self?: string | null;
  fields: {
    summary?: string | null;
    description?: JiraAdfDocument | string | null;
    status?: {
      name?: string | null;
      statusCategory?: {
        key?: string | null;
        name?: string | null;
      } | null;
    } | null;
    labels?: string[] | null;
    assignee?: {
      accountId?: string | null;
      displayName?: string | null;
    } | null;
    created?: string | null;
    updated?: string | null;
    resolutiondate?: string | null;
    issuetype?: {
      name?: string | null;
    } | null;
    project?: {
      key?: string | null;
      id?: string | null;
    } | null;
  };
}

interface JiraCreatedIssue {
  id?: string | null;
  key?: string | null;
  self?: string | null;
}

interface JiraSearchResponse {
  issues?: JiraIssue[];
}

interface JiraComment {
  id: string;
  self?: string | null;
  body?: JiraAdfDocument | string | null;
  author?: {
    accountId?: string | null;
    displayName?: string | null;
  } | null;
  created?: string | null;
  updated?: string | null;
}

interface JiraErrorBody {
  errorMessages?: string[];
  errors?: Record<string, string>;
  message?: string;
}

export class JiraWorkTrackerProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraWorkTrackerProviderError";
  }
}

export const jiraWorkTrackerCapabilities: TrackerCapabilities = {
  createItem: true,
  listItems: true,
  getItem: true,
  updateItem: true,
  comment: true,
  labels: true,
  assignees: true,
  milestones: false,
  board: false,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

export function jiraWorkTrackerCapabilitiesForConfig(
  config: Pick<JiraWorkTrackingConfig, "board">,
): TrackerCapabilities {
  return {
    ...jiraWorkTrackerCapabilities,
    boardStatus: Object.keys(jiraStatusTransitionOptions(config)).length > 0,
  };
}

export function createJiraWorkTrackerProvider(
  options: JiraWorkTrackerProviderOptions,
): JiraWorkTrackerProvider {
  return new JiraWorkTrackerProvider(options);
}

export class JiraWorkTrackerProvider implements WorkTrackerProvider {
  readonly provider = "jira";
  readonly capabilities: TrackerCapabilities;

  private readonly config: JiraWorkTrackingConfig;
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly webBaseUrl: string;
  private readonly staticAuthorizationHeader?: string;
  private readonly credentialRunner?: JiraCredentialRunner;
  private readonly credentialInteractive: boolean;
  private credentialAuthorizationHeader: string | null | undefined;

  constructor(options: JiraWorkTrackerProviderOptions) {
    this.config = options.config;
    this.fetchFn = options.fetch ?? fetch;
    this.apiBaseUrl = normalizeJiraApiBaseUrl(
      options.apiBaseUrl ?? options.config.host,
    );
    this.webBaseUrl = normalizeJiraWebBaseUrl(
      options.apiBaseUrl ?? options.config.host,
    );
    this.capabilities = jiraWorkTrackerCapabilitiesForConfig(options.config);

    const env = options.env ?? process.env;
    const token =
      optionalNonEmptyString(options.token, "token") ??
      optionalNonEmptyString(env.JIRA_TOKEN, "JIRA_TOKEN");
    const email =
      optionalNonEmptyString(options.email, "email") ??
      optionalNonEmptyString(env.JIRA_EMAIL, "JIRA_EMAIL") ??
      optionalNonEmptyString(env.ATLASSIAN_EMAIL, "ATLASSIAN_EMAIL");
    const apiToken =
      optionalNonEmptyString(options.apiToken, "apiToken") ??
      optionalNonEmptyString(env.JIRA_API_TOKEN, "JIRA_API_TOKEN") ??
      optionalNonEmptyString(env.ATLASSIAN_API_TOKEN, "ATLASSIAN_API_TOKEN");
    this.staticAuthorizationHeader = token
      ? `Bearer ${token}`
      : email && apiToken
        ? basicAuthorizationHeader(email, apiToken)
        : undefined;
    this.credentialRunner =
      options.credentialRunner === false
        ? undefined
        : options.credentialRunner ?? defaultJiraCredentialRunner;
    this.credentialInteractive = options.credentialInteractive ?? false;
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    const status = input.status ?? "todo";
    assertWorkStatus(status);
    rejectUnsupportedMilestone(input.milestone);

    const fields: Record<string, unknown> = {
      project: { key: requiredNonEmptyString(this.config.projectKey, "projectKey") },
      issuetype: {
        name:
          optionalNonEmptyString(this.config.issueType, "issueType") ?? "Task",
      },
      summary: requiredNonEmptyString(input.title, "title"),
      ...(input.description !== undefined
        ? { description: adfFromPlainText(input.description) }
        : {}),
      ...requestLabels(labelsWithStatus(input.labels, status)),
      ...requestAssignee(input.assignees),
    };

    const created = await this.requestJson<JiraCreatedIssue>("POST", "/issue", {
      fields,
    });
    const issueKey = requiredNonEmptyString(
      created.key ?? created.id,
      "created.key",
    );
    await this.applyConfiguredTransition(issueKey, status);

    return this.getWorkItem({ id: issueKey });
  }

  async listWorkItems(query: WorkItemQuery = {}): Promise<WorkItem[]> {
    const statuses = normalizeStatusFilter(query.status);
    const limit = normalizeLimit(query.limit);
    const labels = normalizeStringArray(query.labels, "labels");
    const assignees = normalizeStringArray(query.assignees, "assignees");
    const body = {
      jql: jiraJqlForQuery(this.config.projectKey, labels, assignees),
      fields: jiraIssueFields,
      maxResults: limit ? Math.min(Math.max(limit, 1), 100) : 100,
    };

    const searchResult = await this.requestJson<JiraSearchResponse>(
      "POST",
      "/search/jql",
      body,
    );
    const search = query.search?.trim().toLowerCase();
    const items = (searchResult.issues ?? [])
      .map((issue) => this.issueToWorkItem(issue))
      .filter((item) => matchesStatusFilter(item, statuses))
      .filter((item) => matchesStringFilter(item.labels, labels))
      .filter((item) => matchesStringFilter(item.assignees, assignees))
      .filter((item) => !search || matchesSearch(item, search));

    return limit === undefined ? items : items.slice(0, limit);
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    return this.issueToWorkItem(await this.getIssue(ref));
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    rejectUnsupportedMilestone(patch.milestone);

    const issueKey = issueKeyFromRef(ref);
    const fields: Record<string, unknown> = {};
    if (patch.title !== undefined) {
      fields.summary = requiredNonEmptyString(patch.title, "title");
    }
    if (patch.description !== undefined) {
      fields.description = adfFromPlainText(patch.description);
    }
    if (patch.assignees !== undefined) {
      Object.assign(fields, requestAssignee(patch.assignees));
    }
    if (patch.status !== undefined) {
      assertWorkStatus(patch.status);
    }
    if (patch.labels !== undefined || patch.status !== undefined) {
      const baseLabels =
        patch.labels !== undefined
          ? normalizeStringArray(patch.labels, "labels")
          : labelNames(await this.getIssue(ref));
      Object.assign(fields, requestLabels(labelsWithStatus(baseLabels, patch.status)));
    }

    if (Object.keys(fields).length > 0) {
      await this.requestJson<undefined>("PUT", `/issue/${encodePathSegment(issueKey)}`, {
        fields,
      });
    }
    if (patch.status !== undefined) {
      await this.applyConfiguredTransition(issueKey, patch.status);
    }

    return this.getWorkItem({ id: issueKey });
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    const issueKey = issueKeyFromRef(ref);
    const comment = await this.requestJson<JiraComment>(
      "POST",
      `/issue/${encodePathSegment(issueKey)}/comment`,
      {
        body: adfFromPlainText(requiredNonEmptyString(body, "body")),
      },
    );

    return this.commentToWorkComment(comment, issueKey);
  }

  async setStatus(ref: WorkItemRef, status: WorkStatus): Promise<WorkItem> {
    return this.updateWorkItem(ref, { status });
  }

  private async getIssue(ref: WorkItemRef): Promise<JiraIssue> {
    const issueKey = issueKeyFromRef(ref);
    const params = new URLSearchParams({
      fields: jiraIssueFields.join(","),
    });
    return this.requestJson<JiraIssue>(
      "GET",
      `/issue/${encodePathSegment(issueKey)}?${params.toString()}`,
    );
  }

  private async applyConfiguredTransition(
    issueKey: string,
    status: WorkStatus,
  ): Promise<void> {
    const transitionId = jiraStatusTransitionOptions(this.config)[status];
    if (!transitionId) {
      return;
    }

    await this.requestJson<undefined>(
      "POST",
      `/issue/${encodePathSegment(issueKey)}/transitions`,
      {
        transition: {
          id: transitionId,
        },
      },
    );
  }

  private async requestJson<T>(
    method: string,
    pathAndQuery: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(pathAndQuery.replace(/^\/+/, ""), `${this.apiBaseUrl}/`);
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "dev-nexus",
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    const authorizationHeader = this.authorizationHeader();
    if (authorizationHeader) {
      headers.Authorization = authorizationHeader;
    }

    const response = await this.fetchFn(url, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      throw new JiraWorkTrackerProviderError(
        await jiraErrorMessage(response, method, url),
      );
    }
    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  }

  private issueToWorkItem(issue: JiraIssue): WorkItem {
    return {
      id: `jira-${requiredNonEmptyString(issue.key, "issue.key")}`,
      title: requiredNonEmptyString(issue.fields.summary, "issue.fields.summary"),
      description: adfToPlainText(issue.fields.description),
      status: workStatusFromIssue(issue),
      provider: "jira",
      labels: userLabelNames(issue),
      assignees: assigneeAccountIds(issue),
      milestone: null,
      createdAt: issue.fields.created ?? null,
      updatedAt: issue.fields.updated ?? null,
      closedAt: issue.fields.resolutiondate ?? null,
      webUrl: this.issueWebUrl(issue),
      externalRef: this.issueExternalRef(issue),
    };
  }

  private commentToWorkComment(
    comment: JiraComment,
    issueKey: string,
  ): WorkComment {
    return {
      id: `jira-comment-${requiredNonEmptyString(comment.id, "comment.id")}`,
      body: adfToPlainText(comment.body) ?? "",
      author: comment.author?.displayName ?? comment.author?.accountId ?? null,
      createdAt: comment.created ?? null,
      updatedAt: comment.updated ?? null,
      externalRef: {
        provider: "jira",
        host: this.config.host ?? null,
        projectId: this.config.projectKey,
        itemId: comment.id,
        itemKey: issueKey,
        webUrl: comment.self ?? null,
      },
    };
  }

  private issueExternalRef(issue: JiraIssue): ExternalRef {
    return {
      provider: "jira",
      host: this.config.host ?? null,
      projectId: issue.fields.project?.key ?? this.config.projectKey,
      itemId: issue.id,
      itemKey: issue.key,
      webUrl: this.issueWebUrl(issue),
    };
  }

  private issueWebUrl(issue: JiraIssue): string {
    return `${this.webBaseUrl}/browse/${encodeURIComponent(issue.key)}`;
  }

  private authorizationHeader(): string | undefined {
    if (this.staticAuthorizationHeader) {
      return this.staticAuthorizationHeader;
    }
    if (this.credentialAuthorizationHeader !== undefined) {
      return this.credentialAuthorizationHeader ?? undefined;
    }
    if (!this.credentialRunner) {
      this.credentialAuthorizationHeader = null;
      return undefined;
    }

    const credential = fillJiraCredential(
      this.credentialRunner,
      jiraCredentialRequest(this.config),
      { interactive: this.credentialInteractive },
    );
    this.credentialAuthorizationHeader = credential
      ? authorizationHeaderFromCredential(credential)
      : null;
    return this.credentialAuthorizationHeader ?? undefined;
  }
}

export function normalizeJiraApiBaseUrl(hostOrApiBaseUrl?: string | null): string {
  const url = jiraUrl(hostOrApiBaseUrl);
  const normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith(jiraRestApiPath)) {
    return `${url.protocol}//${url.host}${normalizedPath}`;
  }

  return `${url.protocol}//${url.host}${normalizedPath}${jiraRestApiPath}`;
}

export function normalizeJiraWebBaseUrl(hostOrApiBaseUrl?: string | null): string {
  const url = jiraUrl(hostOrApiBaseUrl);
  let normalizedPath = url.pathname.replace(/\/+$/, "");
  if (normalizedPath.endsWith(jiraRestApiPath)) {
    normalizedPath = normalizedPath.slice(0, -jiraRestApiPath.length);
  }

  return `${url.protocol}//${url.host}${normalizedPath}`;
}

export function jiraCredentialRequest(
  config: Pick<JiraWorkTrackingConfig, "host">,
): JiraCredentialRequest {
  return {
    protocol: "https",
    host: normalizeJiraCredentialHost(config.host),
  };
}

export function normalizeJiraCredentialHost(
  hostOrApiBaseUrl?: string | null,
): string {
  return jiraUrl(hostOrApiBaseUrl).host;
}

export function defaultJiraCredentialRunner(
  request: JiraCredentialRequest,
  options: { interactive: boolean },
): JiraCredentialCommandResult {
  const result = spawnSync("git", ["credential", "fill"], {
    input: jiraCredentialInput(request),
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.interactive
        ? {}
        : {
            GCM_INTERACTIVE: "0",
            GIT_TERMINAL_PROMPT: "0",
          }),
    },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    ...(result.error ? { error: result.error } : {}),
  };
}

function jiraStatusTransitionOptions(
  config: Pick<JiraWorkTrackingConfig, "board">,
): Record<string, string> {
  const board = config.board;
  if (!board || board.kind !== "jira-workflow" || !board.statusOptions) {
    return {};
  }

  return board.statusOptions;
}

function fillJiraCredential(
  runner: JiraCredentialRunner,
  request: JiraCredentialRequest,
  options: { interactive: boolean },
): Record<string, string> | undefined {
  const result = runner(request, options);
  if (result.status !== 0 || result.error) {
    return undefined;
  }

  const credential = parseJiraCredentialOutput(result.stdout);
  return credential.authtype && credential.credential
    ? credential
    : credential.username && credential.password
      ? credential
      : undefined;
}

function authorizationHeaderFromCredential(
  credential: Record<string, string>,
): string | undefined {
  const authtype = optionalNonEmptyString(credential.authtype, "authtype");
  const encodedCredential = optionalNonEmptyString(
    credential.credential,
    "credential",
  );
  if (authtype && encodedCredential) {
    return `${authtype} ${encodedCredential}`;
  }

  const username = optionalNonEmptyString(credential.username, "username");
  const password = optionalNonEmptyString(credential.password, "password");
  return username && password
    ? basicAuthorizationHeader(username, password)
    : undefined;
}

function jiraCredentialInput(request: JiraCredentialRequest): string {
  return [`protocol=${request.protocol}`, `host=${request.host}`, ""].join("\n");
}

function parseJiraCredentialOutput(output: string): Record<string, string> {
  const credential: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    if (line.length === 0) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator <= 0) {
      continue;
    }

    credential[line.slice(0, separator)] = line.slice(separator + 1);
  }

  return credential;
}

function workStatusFromIssue(issue: JiraIssue): WorkStatus {
  const statusLabel = labelNames(issue).find((label) =>
    label.startsWith(jiraStatusLabelPrefix),
  );
  if (statusLabel) {
    const candidate = statusLabel.slice(jiraStatusLabelPrefix.length);
    if (workStatuses.has(candidate as WorkStatus)) {
      return candidate as WorkStatus;
    }
  }

  const statusName = issue.fields.status?.name?.trim().toLowerCase();
  if (statusName === "ready") {
    return "ready";
  }
  if (statusName === "in progress" || statusName === "in_progress") {
    return "in_progress";
  }
  if (statusName === "blocked") {
    return "blocked";
  }
  if (statusName === "won't do" || statusName === "wont do") {
    return "wont_do";
  }

  const categoryKey = issue.fields.status?.statusCategory?.key;
  if (categoryKey === "done") {
    return "done";
  }
  if (categoryKey === "indeterminate") {
    return "in_progress";
  }

  return "todo";
}

function labelsWithStatus(
  labels: string[] | undefined,
  status?: WorkStatus,
): string[] {
  const normalized = normalizeStringArray(labels, "labels").filter(
    (label) => !label.startsWith(jiraStatusLabelPrefix),
  );
  if (status && status !== "todo") {
    normalized.push(`${jiraStatusLabelPrefix}${status}`);
  }

  return dedupeStrings(normalized);
}

function userLabelNames(issue: JiraIssue): string[] {
  return labelNames(issue).filter(
    (label) => !label.startsWith(jiraStatusLabelPrefix),
  );
}

function labelNames(issue: JiraIssue): string[] {
  return (issue.fields.labels ?? [])
    .filter((label): label is string => Boolean(label && label.trim()))
    .map((label) => label.trim());
}

function assigneeAccountIds(issue: JiraIssue): string[] {
  const accountId = issue.fields.assignee?.accountId?.trim();
  return accountId ? [accountId] : [];
}

function issueKeyFromRef(ref: WorkItemRef): string {
  if (ref.provider && ref.provider !== "jira") {
    throw new JiraWorkTrackerProviderError(
      `jira provider cannot resolve ${ref.provider} work item refs`,
    );
  }
  if (ref.externalRef?.provider && ref.externalRef.provider !== "jira") {
    throw new JiraWorkTrackerProviderError(
      `jira provider cannot resolve ${ref.externalRef.provider} external refs`,
    );
  }

  const candidate =
    ref.externalRef?.itemKey ?? ref.id ?? ref.externalRef?.itemId;
  if (candidate === undefined || candidate === null) {
    throw new JiraWorkTrackerProviderError("Jira issue key or id is required");
  }

  return requiredNonEmptyString(String(candidate), "issue key").replace(
    /^jira-/,
    "",
  );
}

function normalizeStatusFilter(
  status: WorkStatus | WorkStatus[] | undefined,
): Set<WorkStatus> | undefined {
  if (status === undefined) {
    return undefined;
  }

  const values = Array.isArray(status) ? status : [status];
  const normalized = new Set<WorkStatus>();
  for (const value of values) {
    assertWorkStatus(value);
    normalized.add(value);
  }

  return normalized;
}

function matchesStatusFilter(
  item: WorkItem,
  statuses: Set<WorkStatus> | undefined,
): boolean {
  return !statuses || statuses.size === 0 || statuses.has(item.status);
}

function matchesStringFilter(
  itemValues: string[] | undefined,
  requiredValues: string[],
): boolean {
  return requiredValues.every((value) => itemValues?.includes(value));
}

function matchesSearch(item: WorkItem, search: string): boolean {
  return [
    item.id,
    item.externalRef?.itemKey ?? "",
    item.title,
    item.description ?? "",
  ].some((value) => value.toLowerCase().includes(search));
}

function requestLabels(labels: string[]): Record<string, string[]> {
  return labels.length > 0 ? { labels } : {};
}

function requestAssignee(
  assignees: string[] | undefined,
): Record<string, { accountId: string } | null> {
  if (assignees === undefined) {
    return {};
  }

  const normalized = normalizeStringArray(assignees, "assignees");
  if (normalized.length > 1) {
    throw new JiraWorkTrackerProviderError(
      "Jira supports only one assignee account id per issue",
    );
  }

  return {
    assignee: normalized.length === 0 ? null : { accountId: normalized[0]! },
  };
}

function jiraJqlForQuery(
  projectKey: string,
  labels: string[],
  assignees: string[],
): string {
  const clauses = [`project = ${jqlString(projectKey)}`];
  if (labels.length > 0) {
    clauses.push(`labels in (${labels.map(jqlString).join(", ")})`);
  }
  if (assignees.length > 0) {
    clauses.push(`assignee in (${assignees.map(jqlString).join(", ")})`);
  }

  return `${clauses.join(" AND ")} ORDER BY updated DESC`;
}

function jqlString(value: string): string {
  return `"${requiredNonEmptyString(value, "jql value").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function adfFromPlainText(value: string | null | undefined): JiraAdfDocument | null {
  if (value === null || value === undefined) {
    return null;
  }

  const lines = value.split(/\r?\n/);
  return {
    type: "doc",
    version: 1,
    content: (lines.length > 0 ? lines : [""]).map((line) => ({
      type: "paragraph",
      ...(line.length > 0
        ? {
            content: [
              {
                type: "text",
                text: line,
              },
            ],
          }
        : {}),
    })),
  };
}

function adfToPlainText(value: JiraAdfDocument | string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }

  return value.content.map(adfNodeText).join("\n");
}

function adfNodeText(node: JiraAdfNode): string {
  if (typeof node.text === "string") {
    return node.text;
  }
  if (node.type === "hardBreak") {
    return "\n";
  }
  if (!node.content) {
    return "";
  }

  return node.content.map(adfNodeText).join("");
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new JiraWorkTrackerProviderError(
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
  if (!Array.isArray(values)) {
    throw new JiraWorkTrackerProviderError(`${pathName} must be an array`);
  }

  return dedupeStrings(
    values.map((value, index) =>
      requiredNonEmptyString(value, `${pathName}[${index}]`),
    ),
  );
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
}

function assertWorkStatus(status: WorkStatus): void {
  if (!workStatuses.has(status)) {
    throw new JiraWorkTrackerProviderError(`Invalid work status: ${status}`);
  }
}

function rejectUnsupportedMilestone(value: string | null | undefined): void {
  if (value !== undefined && value !== null) {
    throw new JiraWorkTrackerProviderError(
      "Jira milestone mapping is not configured; use Jira labels or issue fields directly",
    );
  }
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new JiraWorkTrackerProviderError(
      `${pathName} must be a non-empty string`,
    );
  }

  return value.trim();
}

function optionalNonEmptyString(
  value: string | null | undefined,
  pathName: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value.trim().length === 0) {
    return undefined;
  }

  return requiredNonEmptyString(value, pathName);
}

function encodePathSegment(value: string): string {
  return encodeURIComponent(requiredNonEmptyString(value, "path segment"));
}

function jiraUrl(hostOrApiBaseUrl?: string | null): URL {
  const value = optionalNonEmptyString(hostOrApiBaseUrl, "host");
  if (!value) {
    throw new JiraWorkTrackerProviderError(
      "Jira provider requires a host or apiBaseUrl",
    );
  }

  return value.startsWith("http://") || value.startsWith("https://")
    ? new URL(value)
    : new URL(`https://${value}`);
}

function basicAuthorizationHeader(username: string, password: string): string {
  return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

async function jiraErrorMessage(
  response: Response,
  method: string,
  url: URL,
): Promise<string> {
  let detail: string | undefined;
  try {
    const body = (await response.json()) as JiraErrorBody;
    detail = jiraErrorDetail(body);
  } catch {
    detail = await response.text().catch(() => undefined);
  }

  return [
    `Jira request failed: ${method} ${url.pathname} returned ${response.status}`,
    detail ? `: ${detail}` : "",
  ].join("");
}

function jiraErrorDetail(body: JiraErrorBody): string | undefined {
  if (body.message) {
    return body.message;
  }
  if (body.errorMessages?.length) {
    return body.errorMessages.join("; ");
  }
  if (body.errors && Object.keys(body.errors).length > 0) {
    return JSON.stringify(body.errors);
  }

  return undefined;
}
