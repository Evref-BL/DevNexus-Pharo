import { spawnSync } from "node:child_process";
import type {
  CreateWorkItemInput,
  ExternalRef,
  GitHubWorkTrackingConfig,
  TrackerCapabilities,
  WorkComment,
  WorkItem,
  WorkItemPatch,
  WorkItemQuery,
  WorkItemRef,
  WorkStatus,
  WorkTrackerProvider,
} from "./workTrackingTypes.js";

export const defaultGitHubApiBaseUrl = "https://api.github.com";
export const defaultGitHubApiVersion = "2026-03-10";
export const githubStatusLabelPrefix = "status:";

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

export interface GitHubWorkTrackerProviderOptions {
  config: GitHubWorkTrackingConfig;
  token?: string | null;
  fetch?: typeof fetch;
  apiBaseUrl?: string | null;
  apiVersion?: string | null;
  env?: Record<string, string | undefined>;
  credentialRunner?: GitCredentialRunner | false;
  credentialInteractive?: boolean;
}

export interface GitCredentialCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface GitCredentialRequest {
  protocol: "https";
  host: string;
  path?: string;
}

export type GitCredentialRunner = (
  request: GitCredentialRequest,
  options: { interactive: boolean },
) => GitCredentialCommandResult;

interface GitHubIssue {
  id: number;
  node_id?: string | null;
  number: number;
  title: string;
  body?: string | null;
  state: string;
  state_reason?: string | null;
  labels?: Array<string | { name?: string | null }>;
  assignees?: Array<{ login?: string | null }>;
  milestone?: { title?: string | null; number?: number | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  closed_at?: string | null;
  html_url?: string | null;
  pull_request?: unknown;
}

interface GitHubComment {
  id: number;
  node_id?: string | null;
  body?: string | null;
  user?: { login?: string | null } | null;
  created_at?: string | null;
  updated_at?: string | null;
  html_url?: string | null;
}

interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
}

export class GitHubWorkTrackerProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubWorkTrackerProviderError";
  }
}

export const githubWorkTrackerCapabilities: TrackerCapabilities = {
  createItem: true,
  listItems: true,
  getItem: true,
  updateItem: true,
  comment: true,
  labels: true,
  assignees: true,
  milestones: true,
  board: false,
  boardStatus: false,
  draftItems: false,
  webhooks: false,
};

export function createGitHubWorkTrackerProvider(
  options: GitHubWorkTrackerProviderOptions,
): GitHubWorkTrackerProvider {
  return new GitHubWorkTrackerProvider(options);
}

export class GitHubWorkTrackerProvider implements WorkTrackerProvider {
  readonly provider = "github";
  readonly capabilities = githubWorkTrackerCapabilities;

  private readonly config: GitHubWorkTrackingConfig;
  private readonly fetchFn: typeof fetch;
  private readonly apiBaseUrl: string;
  private readonly apiVersion: string;
  private readonly staticAuthorizationHeader?: string;
  private readonly credentialRunner?: GitCredentialRunner;
  private readonly credentialInteractive: boolean;
  private credentialAuthorizationHeader: string | null | undefined;

  constructor(options: GitHubWorkTrackerProviderOptions) {
    this.config = options.config;
    this.fetchFn = options.fetch ?? fetch;
    this.apiBaseUrl = normalizeGitHubApiBaseUrl(
      options.apiBaseUrl ?? options.config.host,
    );
    this.apiVersion = requiredNonEmptyString(
      options.apiVersion ?? defaultGitHubApiVersion,
      "apiVersion",
    );
    const token =
      optionalNonEmptyString(options.token, "token") ??
      optionalNonEmptyString(
        (options.env ?? process.env).GITHUB_TOKEN,
        "GITHUB_TOKEN",
      ) ??
      optionalNonEmptyString((options.env ?? process.env).GH_TOKEN, "GH_TOKEN");
    this.staticAuthorizationHeader = token ? `Bearer ${token}` : undefined;
    this.credentialRunner =
      options.credentialRunner === false
        ? undefined
        : options.credentialRunner ?? defaultGitCredentialRunner;
    this.credentialInteractive = options.credentialInteractive ?? false;
  }

  async createWorkItem(input: CreateWorkItemInput): Promise<WorkItem> {
    const status = input.status ?? "todo";
    assertWorkStatus(status);

    const created = await this.requestJson<GitHubIssue>("POST", this.issuePath(), {
      title: requiredNonEmptyString(input.title, "title"),
      ...(input.description !== undefined ? { body: input.description } : {}),
      ...requestArray("labels", labelsWithStatus(input.labels, status)),
      ...requestArray("assignees", normalizeStringArray(input.assignees, "assignees")),
      ...requestMilestone(input.milestone),
    });

    if (closedStatuses.has(status)) {
      return this.updateWorkItem({ id: String(created.number) }, { status });
    }

    return this.issueToWorkItem(created);
  }

  async listWorkItems(query: WorkItemQuery = {}): Promise<WorkItem[]> {
    const statuses = normalizeStatusFilter(query.status);
    const state = githubStateForQuery(statuses);
    const limit = normalizeLimit(query.limit);
    const params = new URLSearchParams({
      state,
      per_page: String(limit ? Math.min(Math.max(limit, 1), 100) : 100),
      page: "1",
    });
    const labels = normalizeStringArray(query.labels, "labels");
    if (labels.length > 0) {
      params.set("labels", labels.join(","));
    }
    const assignees = normalizeStringArray(query.assignees, "assignees");
    if (assignees.length === 1) {
      params.set("assignee", assignees[0]!);
    }

    const issues = await this.requestJson<GitHubIssue[]>(
      "GET",
      `${this.issuePath()}?${params.toString()}`,
    );
    const search = query.search?.trim().toLowerCase();
    const items = issues
      .filter((issue) => !issue.pull_request)
      .map((issue) => this.issueToWorkItem(issue))
      .filter((item) => matchesStatusFilter(item, statuses))
      .filter((item) => matchesStringFilter(item.assignees, assignees))
      .filter((item) => !search || matchesSearch(item, search));

    return limit === undefined ? items : items.slice(0, limit);
  }

  async getWorkItem(ref: WorkItemRef): Promise<WorkItem> {
    return this.issueToWorkItem(await this.getIssue(ref));
  }

  async updateWorkItem(ref: WorkItemRef, patch: WorkItemPatch): Promise<WorkItem> {
    const issueNumber = issueNumberFromRef(ref);
    const body: Record<string, unknown> = {};

    if (patch.title !== undefined) {
      body.title = requiredNonEmptyString(patch.title, "title");
    }
    if (patch.description !== undefined) {
      body.body = patch.description;
    }
    if (patch.assignees !== undefined) {
      body.assignees = normalizeStringArray(patch.assignees, "assignees");
    }
    if (patch.milestone !== undefined) {
      Object.assign(body, requestMilestone(patch.milestone));
    }

    if (patch.status !== undefined) {
      assertWorkStatus(patch.status);
      body.state = githubStateForStatus(patch.status);
      if (closedStatuses.has(patch.status)) {
        body.state_reason =
          patch.status === "wont_do" ? "not_planned" : "completed";
      }
    }

    if (patch.labels !== undefined || patch.status !== undefined) {
      const baseLabels =
        patch.labels !== undefined
          ? normalizeStringArray(patch.labels, "labels")
          : labelNames(await this.getIssue(ref));
      body.labels = labelsWithStatus(baseLabels, patch.status);
    }

    return this.issueToWorkItem(
      await this.requestJson<GitHubIssue>(
        "PATCH",
        `${this.issuePath()}/${issueNumber}`,
        body,
      ),
    );
  }

  async addComment(ref: WorkItemRef, body: string): Promise<WorkComment> {
    const issueNumber = issueNumberFromRef(ref);
    const comment = await this.requestJson<GitHubComment>(
      "POST",
      `${this.issuePath()}/${issueNumber}/comments`,
      {
        body: requiredNonEmptyString(body, "body"),
      },
    );

    return this.commentToWorkComment(comment, issueNumber);
  }

  async setStatus(ref: WorkItemRef, status: WorkStatus): Promise<WorkItem> {
    return this.updateWorkItem(ref, { status });
  }

  private async getIssue(ref: WorkItemRef): Promise<GitHubIssue> {
    const issueNumber = issueNumberFromRef(ref);
    return this.requestJson<GitHubIssue>(
      "GET",
      `${this.issuePath()}/${issueNumber}`,
    );
  }

  private issuePath(): string {
    return `/repos/${encodePathSegment(this.config.repository.owner)}/${encodePathSegment(
      this.config.repository.name,
    )}/issues`;
  }

  private async requestJson<T>(
    method: string,
    pathAndQuery: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = new URL(pathAndQuery.replace(/^\/+/, ""), `${this.apiBaseUrl}/`);
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "pharo-nexus",
      "X-GitHub-Api-Version": this.apiVersion,
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
      throw new GitHubWorkTrackerProviderError(
        await githubErrorMessage(response, method, url),
      );
    }

    return (await response.json()) as T;
  }

  private issueToWorkItem(issue: GitHubIssue): WorkItem {
    return {
      id: `github-${issue.number}`,
      title: requiredNonEmptyString(issue.title, "issue.title"),
      description: issue.body ?? null,
      status: workStatusFromIssue(issue),
      provider: "github",
      labels: userLabelNames(issue),
      assignees: assigneeLogins(issue),
      milestone: issue.milestone?.title ?? null,
      createdAt: issue.created_at ?? null,
      updatedAt: issue.updated_at ?? null,
      closedAt: issue.closed_at ?? null,
      webUrl: issue.html_url ?? null,
      externalRef: this.issueExternalRef(issue),
    };
  }

  private commentToWorkComment(
    comment: GitHubComment,
    issueNumber: number,
  ): WorkComment {
    return {
      id: `github-comment-${comment.id}`,
      body: comment.body ?? "",
      author: comment.user?.login ?? null,
      createdAt: comment.created_at ?? null,
      updatedAt: comment.updated_at ?? null,
      externalRef: {
        provider: "github",
        host: this.config.host ?? null,
        repositoryOwner: this.config.repository.owner,
        repositoryName: this.config.repository.name,
        itemId: String(comment.id),
        itemNumber: issueNumber,
        nodeId: comment.node_id ?? null,
        webUrl: comment.html_url ?? null,
      },
    };
  }

  private issueExternalRef(issue: GitHubIssue): ExternalRef {
    return {
      provider: "github",
      host: this.config.host ?? null,
      repositoryOwner: this.config.repository.owner,
      repositoryName: this.config.repository.name,
      itemId: String(issue.number),
      itemNumber: issue.number,
      nodeId: issue.node_id ?? null,
      webUrl: issue.html_url ?? null,
    };
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

    const credential = fillGitCredential(
      this.credentialRunner,
      githubCredentialRequest(this.config),
      { interactive: this.credentialInteractive },
    );
    this.credentialAuthorizationHeader = credential
      ? authorizationHeaderFromCredential(credential)
      : null;
    return this.credentialAuthorizationHeader ?? undefined;
  }
}

export function normalizeGitHubApiBaseUrl(hostOrApiBaseUrl?: string | null): string {
  const value = hostOrApiBaseUrl?.trim();
  if (!value || value === "github.com" || value === "https://github.com") {
    return defaultGitHubApiBaseUrl;
  }
  if (value === "api.github.com" || value === "https://api.github.com") {
    return defaultGitHubApiBaseUrl;
  }
  if (value.startsWith("http://") || value.startsWith("https://")) {
    return value.replace(/\/+$/, "");
  }

  return `https://${value.replace(/\/+$/, "")}/api/v3`;
}

export function githubCredentialRequest(
  config: Pick<GitHubWorkTrackingConfig, "host" | "repository">,
): GitCredentialRequest {
  const host = normalizeGitHubCredentialHost(config.host);
  return {
    protocol: "https",
    host,
    path: `${config.repository.owner}/${config.repository.name}.git`,
  };
}

export function normalizeGitHubCredentialHost(hostOrApiBaseUrl?: string | null): string {
  const value = hostOrApiBaseUrl?.trim();
  if (!value || value === "github.com" || value === "https://github.com") {
    return "github.com";
  }
  if (value === "api.github.com" || value === "https://api.github.com") {
    return "github.com";
  }

  const url = value.startsWith("http://") || value.startsWith("https://")
    ? new URL(value)
    : new URL(`https://${value}`);
  return url.host;
}

export function defaultGitCredentialRunner(
  request: GitCredentialRequest,
  options: { interactive: boolean },
): GitCredentialCommandResult {
  const result = spawnSync("git", ["credential", "fill"], {
    input: gitCredentialInput(request),
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

function fillGitCredential(
  runner: GitCredentialRunner,
  request: GitCredentialRequest,
  options: { interactive: boolean },
): Record<string, string> | undefined {
  const result = runner(request, options);
  if (result.status !== 0 || result.error) {
    return undefined;
  }

  const credential = parseGitCredentialOutput(result.stdout);
  return credential.password || (credential.authtype && credential.credential)
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

  const password = optionalNonEmptyString(credential.password, "password");
  return password ? `Bearer ${password}` : undefined;
}

function gitCredentialInput(request: GitCredentialRequest): string {
  return [
    `protocol=${request.protocol}`,
    `host=${request.host}`,
    ...(request.path ? [`path=${request.path}`] : []),
    "",
  ].join("\n");
}

function parseGitCredentialOutput(output: string): Record<string, string> {
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

function workStatusFromIssue(issue: GitHubIssue): WorkStatus {
  if (issue.state === "closed") {
    return issue.state_reason === "not_planned" ? "wont_do" : "done";
  }

  const statusLabel = labelNames(issue).find((label) =>
    label.startsWith(githubStatusLabelPrefix),
  );
  if (!statusLabel) {
    return "todo";
  }

  const candidate = statusLabel.slice(githubStatusLabelPrefix.length);
  return workStatuses.has(candidate as WorkStatus)
    ? (candidate as WorkStatus)
    : "todo";
}

function githubStateForStatus(status: WorkStatus): "open" | "closed" {
  assertWorkStatus(status);
  return closedStatuses.has(status) ? "closed" : "open";
}

function githubStateForQuery(
  statuses: Set<WorkStatus> | undefined,
): "open" | "closed" | "all" {
  if (!statuses || statuses.size === 0) {
    return "all";
  }

  let hasOpen = false;
  let hasClosed = false;
  for (const status of statuses) {
    hasOpen ||= openStatuses.has(status);
    hasClosed ||= closedStatuses.has(status);
  }

  return hasOpen && hasClosed ? "all" : hasClosed ? "closed" : "open";
}

function labelsWithStatus(
  labels: string[] | undefined,
  status?: WorkStatus,
): string[] {
  const normalized = normalizeStringArray(labels, "labels").filter(
    (label) => !label.startsWith(githubStatusLabelPrefix),
  );
  if (status && openStatuses.has(status) && status !== "todo") {
    normalized.push(`${githubStatusLabelPrefix}${status}`);
  }

  return dedupeStrings(normalized);
}

function userLabelNames(issue: GitHubIssue): string[] {
  return labelNames(issue).filter(
    (label) => !label.startsWith(githubStatusLabelPrefix),
  );
}

function labelNames(issue: GitHubIssue): string[] {
  return (issue.labels ?? [])
    .map((label) => (typeof label === "string" ? label : label.name))
    .filter((label): label is string => Boolean(label && label.trim()))
    .map((label) => label.trim());
}

function assigneeLogins(issue: GitHubIssue): string[] {
  return (issue.assignees ?? [])
    .map((assignee) => assignee.login)
    .filter((login): login is string => Boolean(login && login.trim()))
    .map((login) => login.trim());
}

function issueNumberFromRef(ref: WorkItemRef): number {
  if (ref.provider && ref.provider !== "github") {
    throw new GitHubWorkTrackerProviderError(
      `github provider cannot resolve ${ref.provider} work item refs`,
    );
  }
  if (ref.externalRef?.provider && ref.externalRef.provider !== "github") {
    throw new GitHubWorkTrackerProviderError(
      `github provider cannot resolve ${ref.externalRef.provider} external refs`,
    );
  }

  const candidate =
    ref.externalRef?.itemNumber ??
    ref.id ??
    ref.externalRef?.itemId;
  if (candidate === undefined || candidate === null) {
    throw new GitHubWorkTrackerProviderError(
      "GitHub issue number is required",
    );
  }

  if (typeof candidate === "number") {
    return positiveInteger(candidate, "issue number");
  }

  const normalized = candidate.trim().replace(/^github-/, "");
  return positiveInteger(Number(normalized), "issue number");
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
  return [item.id, item.title, item.description ?? ""].some((value) =>
    value.toLowerCase().includes(search),
  );
}

function requestArray(
  key: string,
  values: string[],
): Record<string, string[]> {
  return values.length > 0 ? { [key]: values } : {};
}

function requestMilestone(
  value: string | null | undefined,
): Record<string, string | number | null> {
  if (value === undefined) {
    return {};
  }
  if (value === null) {
    return { milestone: null };
  }

  const normalized = requiredNonEmptyString(value, "milestone");
  const numeric = Number(normalized);
  return Number.isInteger(numeric) && numeric > 0
    ? { milestone: numeric }
    : { milestone: normalized };
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }
  if (!Number.isInteger(limit) || limit < 0) {
    throw new GitHubWorkTrackerProviderError(
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
    throw new GitHubWorkTrackerProviderError(`${pathName} must be an array`);
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
    throw new GitHubWorkTrackerProviderError(`Invalid work status: ${status}`);
  }
}

function positiveInteger(value: number, pathName: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new GitHubWorkTrackerProviderError(
      `${pathName} must be a positive integer`,
    );
  }

  return value;
}

function requiredNonEmptyString(value: unknown, pathName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new GitHubWorkTrackerProviderError(
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

async function githubErrorMessage(
  response: Response,
  method: string,
  url: URL,
): Promise<string> {
  let detail: string | undefined;
  try {
    const body = (await response.json()) as GitHubErrorBody;
    detail = body.message;
  } catch {
    detail = await response.text().catch(() => undefined);
  }

  return [
    `GitHub request failed: ${method} ${url.pathname} returned ${response.status}`,
    detail ? `: ${detail}` : "",
  ].join("");
}
