import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { codexConfigPath } from "./codexConfig.js";
import {
  loadProjectConfig,
  nexusGeneratedDirectoryName,
  projectWorktreesRootPath,
  resolveNexusHome,
  type NexusProjectConfig,
} from "./config.js";
import {
  getNexusProjectStatus,
  type GitCommandResult,
  type GitRunner,
} from "./nexusProjectService.js";
import type { WorkItemRef } from "./workTrackingTypes.js";

export const codexWorktreeMetadataFileName = "codex-worktrees.json";
export const codexWorktreeMetadataStoreVersion = 1;

export interface PrepareCodexWorktreeOptions {
  homePath: string;
  project: string;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string;
  workItem?: WorkItemRef;
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface ArchiveCodexWorktreeOptions {
  homePath: string;
  id: string;
  removeWorktree?: boolean;
  gitRunner?: GitRunner;
  now?: () => Date | string;
}

export interface ListCodexWorktreesOptions {
  homePath: string;
  project?: string;
  state?: CodexWorktreeState;
  now?: () => Date | string;
}

export interface GetCodexWorktreeStatusOptions {
  homePath: string;
  id: string;
  now?: () => Date | string;
}

export interface RecordCodexWorktreeExecutionOptions {
  homePath: string;
  id: string;
  commitIds?: string[];
  verification?: CodexWorktreeVerificationInput;
  publicationDecision?: CodexWorktreePublicationDecisionInput;
  now?: () => Date | string;
}

export interface PrepareCodexWorktreeResult {
  homePath: string;
  metadataPath: string;
  metadataRecord: CodexWorktreeRecord;
  projectRoot: string;
  sourceRoot: string;
  worktreesRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  copiedFiles: string[];
  skippedFiles: string[];
  excludedEntries: string[];
  git: {
    commands: GitCommandResult[];
  };
}

export interface ArchiveCodexWorktreeResult {
  homePath: string;
  metadataPath: string;
  metadataRecord: CodexWorktreeRecord;
  removedWorktree: boolean;
  git: {
    commands: GitCommandResult[];
  };
}

export interface CodexWorktreeStatus {
  metadataRecord: CodexWorktreeRecord;
  projectRootExists: boolean;
  sourceRootExists: boolean;
  worktreeExists: boolean;
}

export interface ListCodexWorktreesResult {
  homePath: string;
  metadataPath: string;
  worktrees: CodexWorktreeStatus[];
}

export interface GetCodexWorktreeStatusResult {
  homePath: string;
  metadataPath: string;
  worktree: CodexWorktreeStatus;
}

export interface RecordCodexWorktreeExecutionResult {
  homePath: string;
  metadataPath: string;
  metadataRecord: CodexWorktreeRecord;
}

export type CodexWorktreeState = "active" | "archived";
export type CodexWorktreeVerificationStatus = "passed" | "failed" | "not_run";
export type CodexWorktreePublicationDecisionType =
  | "not_decided"
  | "local_only"
  | "direct_integration"
  | "review_handoff"
  | "blocked";

export interface CodexWorktreeVerificationInput {
  command: string;
  status?: CodexWorktreeVerificationStatus;
  summary?: string | null;
}

export interface CodexWorktreeVerificationRecord {
  command: string;
  status: CodexWorktreeVerificationStatus;
  summary: string | null;
  recordedAt: string;
}

export interface CodexWorktreePublicationDecisionInput {
  type: CodexWorktreePublicationDecisionType;
  targetBranch?: string | null;
  remote?: string | null;
  prUrl?: string | null;
  reason?: string | null;
}

export interface CodexWorktreePublicationDecision {
  type: CodexWorktreePublicationDecisionType;
  targetBranch: string | null;
  remote: string | null;
  prUrl: string | null;
  reason: string | null;
  decidedAt: string;
}

export interface CodexWorktreeExecutionMetadata {
  commitIds: string[];
  verification: CodexWorktreeVerificationRecord[];
  publicationDecision: CodexWorktreePublicationDecision | null;
  updatedAt: string | null;
}

export interface CodexWorktreeRecord {
  id: string;
  state: CodexWorktreeState;
  projectId: string;
  projectRoot: string;
  sourceRoot: string;
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
  workItem: WorkItemRef | null;
  createdAt: string;
  archivedAt: string | null;
  removedAt: string | null;
  copiedFiles: string[];
  skippedFiles: string[];
  excludedEntries: string[];
  execution: CodexWorktreeExecutionMetadata;
}

export interface CodexWorktreeMetadataStore {
  version: typeof codexWorktreeMetadataStoreVersion;
  updatedAt: string;
  worktrees: CodexWorktreeRecord[];
}

export class CodexWorktreeServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexWorktreeServiceError";
  }
}

export function prepareCodexWorktree(
  options: PrepareCodexWorktreeOptions,
): PrepareCodexWorktreeResult {
  const homePath = resolveNexusHome(options.homePath);
  const status = getNexusProjectStatus({
    homePath,
    project: options.project,
  }).project;
  const projectRoot = path.resolve(status.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const sourceRoot = resolveProjectSourceRoot(projectRoot, projectConfig);
  const worktreesRoot = projectWorktreesRootPath(projectRoot, projectConfig);
  const branchName = resolveBranchName(status.id, options);
  const worktreeName = options.worktreeName ?? safeDirectoryName(branchName);
  const worktreePath = path.join(worktreesRoot, worktreeName);

  assertSafeWorktreePath(worktreesRoot, worktreePath);
  if (fs.existsSync(worktreePath)) {
    throw new CodexWorktreeServiceError(
      `Worktree path already exists: ${worktreePath}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const commands: GitCommandResult[] = [];
  fs.mkdirSync(worktreesRoot, { recursive: true });
  runGitCommand(
    gitRunner,
    commands,
    [
      "worktree",
      "add",
      "-b",
      branchName,
      worktreePath,
      ...(options.baseRef ? [options.baseRef] : []),
    ],
    sourceRoot,
  );

  const copiedFiles = copyCodexWorktreeSupportFiles(projectRoot, worktreePath);
  const excludedEntries = ensureSupportFileExcludes(
    gitRunner,
    commands,
    worktreePath,
  );
  const createdAt = nowString(options.now);
  const metadataPath = codexWorktreeMetadataStorePath(homePath);
  const metadataRecord: CodexWorktreeRecord = {
    id: `${status.id}:${branchName}`,
    projectId: status.id,
    projectRoot,
    sourceRoot,
    worktreePath,
    branchName,
    baseRef: options.baseRef ?? null,
    workItem: options.workItem ?? null,
    createdAt,
    state: "active",
    archivedAt: null,
    removedAt: null,
    copiedFiles: copiedFiles.copied,
    skippedFiles: copiedFiles.skipped,
    excludedEntries,
    execution: emptyCodexWorktreeExecution(),
  };
  saveCodexWorktreeMetadataRecord(metadataPath, metadataRecord, createdAt);

  return {
    homePath,
    metadataPath,
    metadataRecord,
    projectRoot,
    sourceRoot,
    worktreesRoot,
    worktreePath,
    branchName,
    baseRef: options.baseRef ?? null,
    copiedFiles: copiedFiles.copied,
    skippedFiles: copiedFiles.skipped,
    excludedEntries,
    git: {
      commands,
    },
  };
}

export function archiveCodexWorktree(
  options: ArchiveCodexWorktreeOptions,
): ArchiveCodexWorktreeResult {
  const homePath = resolveNexusHome(options.homePath);
  const metadataPath = codexWorktreeMetadataStorePath(homePath);
  const archivedAt = nowString(options.now);
  const store = readCodexWorktreeMetadataStore(metadataPath, archivedAt);
  const existing = store.worktrees.find((record) => record.id === options.id);
  if (!existing) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata record was not found: ${options.id}`,
    );
  }

  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const commands: GitCommandResult[] = [];
  let removedWorktree = false;
  if (options.removeWorktree) {
    runGitCommand(
      gitRunner,
      commands,
      ["worktree", "remove", existing.worktreePath],
      existing.sourceRoot,
    );
    removedWorktree = true;
  }

  const metadataRecord: CodexWorktreeRecord = {
    ...existing,
    state: "archived",
    archivedAt,
    removedAt: removedWorktree ? archivedAt : existing.removedAt,
  };
  saveCodexWorktreeMetadataRecord(metadataPath, metadataRecord, archivedAt);

  return {
    homePath,
    metadataPath,
    metadataRecord,
    removedWorktree,
    git: {
      commands,
    },
  };
}

export function listCodexWorktrees(
  options: ListCodexWorktreesOptions,
): ListCodexWorktreesResult {
  const homePath = resolveNexusHome(options.homePath);
  const metadataPath = codexWorktreeMetadataStorePath(homePath);
  const store = readCodexWorktreeMetadataStore(
    metadataPath,
    nowString(options.now),
  );
  const projectId = options.project
    ? getNexusProjectStatus({
        homePath,
        project: options.project,
      }).project.id
    : undefined;
  const worktrees = store.worktrees
    .filter((record) => !projectId || record.projectId === projectId)
    .filter((record) => !options.state || record.state === options.state)
    .map(codexWorktreeStatusFromRecord);

  return {
    homePath,
    metadataPath,
    worktrees,
  };
}

export function getCodexWorktreeStatus(
  options: GetCodexWorktreeStatusOptions,
): GetCodexWorktreeStatusResult {
  const homePath = resolveNexusHome(options.homePath);
  const metadataPath = codexWorktreeMetadataStorePath(homePath);
  const store = readCodexWorktreeMetadataStore(
    metadataPath,
    nowString(options.now),
  );
  const metadataRecord = store.worktrees.find((record) => record.id === options.id);
  if (!metadataRecord) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata record was not found: ${options.id}`,
    );
  }

  return {
    homePath,
    metadataPath,
    worktree: codexWorktreeStatusFromRecord(metadataRecord),
  };
}

export function recordCodexWorktreeExecution(
  options: RecordCodexWorktreeExecutionOptions,
): RecordCodexWorktreeExecutionResult {
  const homePath = resolveNexusHome(options.homePath);
  const metadataPath = codexWorktreeMetadataStorePath(homePath);
  const updatedAt = nowString(options.now);
  const store = readCodexWorktreeMetadataStore(metadataPath, updatedAt);
  const existing = store.worktrees.find((record) => record.id === options.id);
  if (!existing) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata record was not found: ${options.id}`,
    );
  }

  const hasCommitIds = Boolean(options.commitIds?.length);
  const hasVerification = Boolean(options.verification);
  const hasPublicationDecision = Boolean(options.publicationDecision);
  if (!hasCommitIds && !hasVerification && !hasPublicationDecision) {
    throw new CodexWorktreeServiceError(
      "At least one execution field is required",
    );
  }

  const execution = normalizeCodexWorktreeExecution(existing.execution);
  const commitIds = [...execution.commitIds];
  for (const commitId of options.commitIds ?? []) {
    const normalized = requiredNonEmptyString(commitId, "commitId");
    if (!commitIds.includes(normalized)) {
      commitIds.push(normalized);
    }
  }

  const verification = [...execution.verification];
  if (options.verification) {
    verification.push({
      command: requiredNonEmptyString(
        options.verification.command,
        "verification.command",
      ),
      status: options.verification.status ?? "passed",
      summary: optionalNullableString(options.verification.summary) ?? null,
      recordedAt: updatedAt,
    });
  }

  const publicationDecision = options.publicationDecision
    ? {
        type: options.publicationDecision.type,
        targetBranch:
          optionalNullableString(options.publicationDecision.targetBranch) ??
          null,
        remote: optionalNullableString(options.publicationDecision.remote) ?? null,
        prUrl: optionalNullableString(options.publicationDecision.prUrl) ?? null,
        reason: optionalNullableString(options.publicationDecision.reason) ?? null,
        decidedAt: updatedAt,
      }
    : execution.publicationDecision;

  const metadataRecord: CodexWorktreeRecord = {
    ...existing,
    execution: {
      commitIds,
      verification,
      publicationDecision,
      updatedAt,
    },
  };
  saveCodexWorktreeMetadataRecord(metadataPath, metadataRecord, updatedAt);

  return {
    homePath,
    metadataPath,
    metadataRecord,
  };
}

export function codexWorktreeMetadataStorePath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    nexusGeneratedDirectoryName,
    codexWorktreeMetadataFileName,
  );
}

function codexWorktreeStatusFromRecord(
  metadataRecord: CodexWorktreeRecord,
): CodexWorktreeStatus {
  return {
    metadataRecord,
    projectRootExists: fs.existsSync(metadataRecord.projectRoot),
    sourceRootExists: fs.existsSync(metadataRecord.sourceRoot),
    worktreeExists: fs.existsSync(metadataRecord.worktreePath),
  };
}

function resolveProjectSourceRoot(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  const sourceRoot = projectConfig.repo.sourceRoot;
  if (!sourceRoot) {
    return path.resolve(projectRoot);
  }

  return path.isAbsolute(sourceRoot)
    ? path.resolve(sourceRoot)
    : path.resolve(projectRoot, sourceRoot);
}

function resolveBranchName(
  projectId: string,
  options: Pick<PrepareCodexWorktreeOptions, "branchName" | "workItem" | "now">,
): string {
  if (options.branchName?.trim()) {
    return normalizeBranchName(options.branchName);
  }

  const workItemId =
    options.workItem?.id ??
    options.workItem?.externalRef?.itemKey ??
    options.workItem?.externalRef?.itemId ??
    timestampSuffix(options.now);

  return normalizeBranchName(`codex/${projectId}/${safeBranchSegment(workItemId)}`);
}

function timestampSuffix(optionsNow: PrepareCodexWorktreeOptions["now"]): string {
  return nowString(optionsNow).replace(/[^0-9A-Za-z]+/g, "").slice(0, 14) || "worktree";
}

function nowString(optionsNow: PrepareCodexWorktreeOptions["now"]): string {
  const value = optionsNow?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function normalizeBranchName(value: string): string {
  const trimmed = value.trim().replaceAll("\\", "/");
  if (trimmed.length === 0) {
    throw new CodexWorktreeServiceError("branchName must be non-empty");
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.endsWith("/") ||
    trimmed.includes("..") ||
    trimmed.includes("//") ||
    /[\u0000-\u001F ~^:?*[\\]/u.test(trimmed)
  ) {
    throw new CodexWorktreeServiceError(`Invalid branchName: ${value}`);
  }

  return trimmed;
}

function safeBranchSegment(value: string): string {
  return safeDirectoryName(value).replaceAll(".", "-");
}

function safeDirectoryName(value: string): string {
  const sanitized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  if (!sanitized) {
    throw new CodexWorktreeServiceError(
      "Worktree name must contain at least one filesystem-safe character",
    );
  }

  return sanitized;
}

function assertSafeWorktreePath(worktreesRoot: string, worktreePath: string): void {
  const resolvedRoot = path.resolve(worktreesRoot);
  const resolvedTarget = path.resolve(worktreePath);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CodexWorktreeServiceError(
      `Worktree path must be inside worktrees root: ${resolvedTarget}`,
    );
  }
}

function copyCodexWorktreeSupportFiles(
  projectRoot: string,
  worktreePath: string,
): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];
  copyFileIfMissing(
    path.join(projectRoot, "AGENTS.md"),
    path.join(worktreePath, "AGENTS.md"),
    copied,
    skipped,
  );
  copyDirectoryIfMissing(
    path.dirname(codexConfigPath(projectRoot)),
    path.dirname(codexConfigPath(worktreePath)),
    copied,
    skipped,
  );

  return { copied, skipped };
}

function copyFileIfMissing(
  source: string,
  target: string,
  copied: string[],
  skipped: string[],
): void {
  if (!fs.existsSync(source)) {
    skipped.push(source);
    return;
  }
  if (fs.existsSync(target)) {
    skipped.push(target);
    return;
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  copied.push(target);
}

function copyDirectoryIfMissing(
  source: string,
  target: string,
  copied: string[],
  skipped: string[],
): void {
  if (!fs.existsSync(source)) {
    skipped.push(source);
    return;
  }
  if (fs.existsSync(target)) {
    skipped.push(target);
    return;
  }

  fs.cpSync(source, target, { recursive: true });
  copied.push(target);
}

function ensureSupportFileExcludes(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  worktreePath: string,
): string[] {
  const entries = [
    fs.existsSync(path.join(worktreePath, "AGENTS.md")) ? "AGENTS.md" : undefined,
    fs.existsSync(path.dirname(codexConfigPath(worktreePath))) ? ".codex/" : undefined,
  ].filter((entry): entry is string => Boolean(entry));
  if (entries.length === 0) {
    return [];
  }

  const excludePathResult = runGitCommand(
    gitRunner,
    commands,
    ["rev-parse", "--git-path", "info/exclude"],
    worktreePath,
  );
  const excludePath = excludePathResult.stdout.trim();
  if (!excludePath) {
    throw new CodexWorktreeServiceError(
      "git rev-parse --git-path info/exclude returned an empty path",
    );
  }

  const resolvedExcludePath = path.isAbsolute(excludePath)
    ? path.resolve(excludePath)
    : path.resolve(worktreePath, excludePath);
  fs.mkdirSync(path.dirname(resolvedExcludePath), { recursive: true });
  const existingText = fs.existsSync(resolvedExcludePath)
    ? fs.readFileSync(resolvedExcludePath, "utf8")
    : "";
  const existing = existingText.split(/\r?\n/u);
  const appended = entries.filter((entry) => !existing.includes(entry));
  if (appended.length > 0) {
    const prefix =
      existingText.length > 0 && !existingText.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(resolvedExcludePath, `${prefix}${appended.join("\n")}\n`, "utf8");
  }

  return entries;
}

function saveCodexWorktreeMetadataRecord(
  metadataPath: string,
  record: CodexWorktreeRecord,
  updatedAt: string,
): void {
  const store = readCodexWorktreeMetadataStore(metadataPath, updatedAt);
  const existingIndex = store.worktrees.findIndex(
    (candidate) => candidate.id === record.id,
  );
  const updatedStore: CodexWorktreeMetadataStore = {
    ...store,
    updatedAt,
    worktrees:
      existingIndex >= 0
        ? store.worktrees.map((candidate, index) =>
            index === existingIndex ? record : candidate,
          )
        : [...store.worktrees, record],
  };
  fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
  fs.writeFileSync(
    metadataPath,
    `${JSON.stringify(updatedStore, null, 2)}\n`,
    "utf8",
  );
}

function readCodexWorktreeMetadataStore(
  metadataPath: string,
  updatedAt: string,
): CodexWorktreeMetadataStore {
  if (!fs.existsSync(metadataPath)) {
    return {
      version: codexWorktreeMetadataStoreVersion,
      updatedAt,
      worktrees: [],
    };
  }

  const raw = JSON.parse(fs.readFileSync(metadataPath, "utf8").replace(/^\uFEFF/u, ""));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata store must be an object: ${metadataPath}`,
    );
  }
  const record = raw as Record<string, unknown>;
  if (record.version !== codexWorktreeMetadataStoreVersion) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata store version must be ${codexWorktreeMetadataStoreVersion}`,
    );
  }
  if (!Array.isArray(record.worktrees)) {
    throw new CodexWorktreeServiceError(
      `Codex worktree metadata store worktrees must be an array: ${metadataPath}`,
    );
  }

  return {
    version: codexWorktreeMetadataStoreVersion,
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : updatedAt,
    worktrees: record.worktrees.map(normalizeCodexWorktreeRecord),
  };
}

function normalizeCodexWorktreeRecord(value: unknown): CodexWorktreeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CodexWorktreeServiceError(
      "Codex worktree metadata records must be objects",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    ...(record as unknown as CodexWorktreeRecord),
    state: record.state === "archived" ? "archived" : "active",
    archivedAt: typeof record.archivedAt === "string" ? record.archivedAt : null,
    removedAt: typeof record.removedAt === "string" ? record.removedAt : null,
    execution: normalizeCodexWorktreeExecution(record.execution),
  };
}

function emptyCodexWorktreeExecution(): CodexWorktreeExecutionMetadata {
  return {
    commitIds: [],
    verification: [],
    publicationDecision: null,
    updatedAt: null,
  };
}

function normalizeCodexWorktreeExecution(
  value: unknown,
): CodexWorktreeExecutionMetadata {
  if (value === undefined || value === null) {
    return emptyCodexWorktreeExecution();
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CodexWorktreeServiceError(
      "Codex worktree execution metadata must be an object",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    commitIds: normalizeStringArray(record.commitIds, "execution.commitIds"),
    verification: normalizeVerificationRecords(record.verification),
    publicationDecision: normalizePublicationDecision(record.publicationDecision),
    updatedAt:
      typeof record.updatedAt === "string" && record.updatedAt.trim()
        ? record.updatedAt
        : null,
  };
}

function normalizeVerificationRecords(
  value: unknown,
): CodexWorktreeVerificationRecord[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new CodexWorktreeServiceError(
      "execution.verification must be an array",
    );
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new CodexWorktreeServiceError(
        `execution.verification[${index}] must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    return {
      command: requiredNonEmptyString(
        record.command,
        `execution.verification[${index}].command`,
      ),
      status: normalizeVerificationStatus(
        record.status,
        `execution.verification[${index}].status`,
      ),
      summary: optionalNullableString(record.summary) ?? null,
      recordedAt: requiredNonEmptyString(
        record.recordedAt,
        `execution.verification[${index}].recordedAt`,
      ),
    };
  });
}

function normalizePublicationDecision(
  value: unknown,
): CodexWorktreePublicationDecision | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new CodexWorktreeServiceError(
      "execution.publicationDecision must be an object or null",
    );
  }

  const record = value as Record<string, unknown>;
  return {
    type: normalizePublicationDecisionType(
      record.type,
      "execution.publicationDecision.type",
    ),
    targetBranch: optionalNullableString(record.targetBranch) ?? null,
    remote: optionalNullableString(record.remote) ?? null,
    prUrl: optionalNullableString(record.prUrl) ?? null,
    reason: optionalNullableString(record.reason) ?? null,
    decidedAt: requiredNonEmptyString(
      record.decidedAt,
      "execution.publicationDecision.decidedAt",
    ),
  };
}

function normalizeStringArray(value: unknown, name: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new CodexWorktreeServiceError(`${name} must be an array`);
  }

  return value.map((item, index) =>
    requiredNonEmptyString(item, `${name}[${index}]`),
  );
}

function normalizeVerificationStatus(
  value: unknown,
  name: string,
): CodexWorktreeVerificationStatus {
  if (value === "passed" || value === "failed" || value === "not_run") {
    return value;
  }

  throw new CodexWorktreeServiceError(`${name} must be passed, failed, or not_run`);
}

function normalizePublicationDecisionType(
  value: unknown,
  name: string,
): CodexWorktreePublicationDecisionType {
  if (
    value === "not_decided" ||
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff" ||
    value === "blocked"
  ) {
    return value;
  }

  throw new CodexWorktreeServiceError(
    `${name} must be not_decided, local_only, direct_integration, review_handoff, or blocked`,
  );
}

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  return requiredNonEmptyString(value, "value");
}

function requiredNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new CodexWorktreeServiceError(`${name} must be a non-empty string`);
  }

  return value.trim();
}

function defaultGitRunner(
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = spawnSync("git", [...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });

  if (result.error) {
    throw new CodexWorktreeServiceError(
      `Failed to run git ${args.join(" ")}: ${result.error.message}`,
    );
  }

  return {
    args: [...args],
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status,
  };
}

function runGitCommand(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  const result = gitRunner(args, cwd);
  commands.push(result);

  if (result.exitCode !== 0) {
    throw new CodexWorktreeServiceError(
      `git ${args.join(" ")} failed with exit code ${result.exitCode}: ${
        result.stderr.trim() || result.stdout.trim()
      }`,
    );
  }

  return result;
}
