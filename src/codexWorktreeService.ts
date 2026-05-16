import fs from "node:fs";
import path from "node:path";
import { codexConfigPath, initCodexWorkspace } from "./codexConfig.js";
import {
  loadHomeConfig,
  loadProjectConfig,
  nexusGeneratedDirectoryName,
  resolveNexusHome,
  type NexusHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  defaultGitRunner,
  GitWorktreeServiceError,
  normalizeBranchName,
  prepareGitWorktree,
  removeGitWorktree,
  runGitCommand,
  safeDirectoryName,
} from "dev-nexus";
import {
  getNexusProjectStatus,
  type GitCommandResult,
  type GitRunner,
} from "./nexusProjectService.js";
import {
  applyWorktreeExecutionUpdate,
  emptyWorktreeExecutionMetadata,
  normalizeWorktreeExecutionMetadata,
  WorktreeExecutionMetadataError,
  type WorktreeExecutionUpdate,
  type WorktreeExecutionMetadata,
  type WorktreePublicationDecision,
  type WorktreePublicationDecisionInput,
  type WorktreePublicationDecisionType,
  type WorktreeVerificationInput,
  type WorktreeVerificationRecord,
  type WorktreeVerificationStatus,
} from "dev-nexus";
import type { WorkItemRef } from "dev-nexus";

export const codexWorktreeMetadataFileName = "codex-worktrees.json";
export const codexWorktreeMetadataStoreVersion = 1;

export interface PrepareCodexWorktreeOptions {
  homePath: string;
  project: string;
  componentId?: string;
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
  componentId: string;
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
export type CodexWorktreeVerificationStatus = WorktreeVerificationStatus;
export type CodexWorktreePublicationDecisionType =
  WorktreePublicationDecisionType;
export type CodexWorktreeVerificationInput = WorktreeVerificationInput;
export type CodexWorktreeVerificationRecord = WorktreeVerificationRecord;
export type CodexWorktreePublicationDecisionInput =
  WorktreePublicationDecisionInput;
export type CodexWorktreePublicationDecision = WorktreePublicationDecision;
export type CodexWorktreeExecutionMetadata = WorktreeExecutionMetadata;

export interface CodexWorktreeRecord {
  id: string;
  state: CodexWorktreeState;
  projectId: string;
  componentId: string | null;
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

interface CodexWorktreeComponent {
  id: string;
  role: string;
  sourceRoot: string;
  worktreesRoot: string;
}

function resolveCodexWorktreeComponent(
  components: readonly CodexWorktreeComponent[],
  componentId: string | undefined,
): CodexWorktreeComponent {
  const component = componentId
    ? components.find((candidate) => candidate.id === componentId)
    : components.find((candidate) => candidate.role === "primary") ?? components[0];
  if (!component) {
    throw new CodexWorktreeServiceError(
      componentId
        ? `Project component is not configured: ${componentId}`
        : "DevNexus project has no components",
    );
  }

  return component;
}

function projectUsesDevNexusPharoExtension(
  projectConfig: Pick<NexusProjectConfig, "extensions">,
): boolean {
  return Boolean(projectConfig.extensions?.["dev-nexus-pharo"]);
}

function refreshCodexWorktreeMcpConfig(options: {
  homePath: string;
  homeConfig: NexusHomeConfig;
  projectConfig: NexusProjectConfig;
  projectRoot: string;
  worktreePath: string;
  projectId: string;
  componentId: string;
}): void {
  if (!projectUsesDevNexusPharoExtension(options.projectConfig)) {
    return;
  }

  initCodexWorkspace({
    homePath: options.homePath,
    workspacePath: options.worktreePath,
    config: options.homeConfig,
    projectRoot: options.projectRoot,
    projectId: options.projectId,
    workspaceId: `${options.componentId}-${path.basename(options.worktreePath)}`,
    includePharo: true,
  });
}

export function prepareCodexWorktree(
  options: PrepareCodexWorktreeOptions,
): PrepareCodexWorktreeResult {
  const homePath = resolveNexusHome(options.homePath);
  const homeConfig = loadHomeConfig(homePath);
  const status = getNexusProjectStatus({
    homePath,
    project: options.project,
  }).project;
  const projectRoot = path.resolve(status.projectRoot);
  const projectConfig = loadProjectConfig(projectRoot);
  const component = resolveCodexWorktreeComponent(
    status.components,
    options.componentId,
  );
  const sourceRoot = component.sourceRoot;
  const worktreesRoot = component.worktreesRoot;
  const branchName = resolveBranchName(status.id, options);
  const gitRunner = options.gitRunner ?? defaultGitRunner;
  const preparedGit = runGitWorktreeOperation(() =>
    prepareGitWorktree({
      componentId: component.id,
      sourceRoot,
      worktreesRoot,
      branchName,
      worktreeName: options.worktreeName,
      baseRef: options.baseRef,
      workItemId: options.workItem?.id,
      gitRunner,
    }),
  );
  const commands: GitCommandResult[] = [...preparedGit.git.commands];

  const copiedFiles = copyCodexWorktreeSupportFiles(
    projectRoot,
    preparedGit.worktreePath,
  );
  refreshCodexWorktreeMcpConfig({
    homePath,
    homeConfig,
    projectConfig,
    projectRoot,
    worktreePath: preparedGit.worktreePath,
    projectId: status.id,
    componentId: component.id,
  });
  const excludedEntries = ensureSupportFileExcludes(
    gitRunner,
    commands,
    preparedGit.worktreePath,
  );
  const createdAt = nowString(options.now);
  const metadataPath = codexWorktreeMetadataStorePath(homePath);
  const metadataRecord: CodexWorktreeRecord = {
    id: `${status.id}:${branchName}`,
    projectId: status.id,
    componentId: component.id,
    projectRoot,
    sourceRoot,
    worktreePath: preparedGit.worktreePath,
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
    execution: emptyWorktreeExecutionMetadata(),
  };
  saveCodexWorktreeMetadataRecord(metadataPath, metadataRecord, createdAt);

  return {
    homePath,
    metadataPath,
    metadataRecord,
    projectRoot,
    componentId: component.id,
    sourceRoot,
    worktreesRoot: preparedGit.worktreesRoot,
    worktreePath: preparedGit.worktreePath,
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
    const removed = runGitWorktreeOperation(() =>
      removeGitWorktree({
        sourceRoot: existing.sourceRoot,
        worktreePath: existing.worktreePath,
        gitRunner,
      }),
    );
    commands.push(...removed.git.commands);
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

  const execution = applyCodexWorktreeExecutionUpdate(existing.execution, {
    commitIds: options.commitIds,
    verification: options.verification,
    publicationDecision: options.publicationDecision,
  }, updatedAt);

  const metadataRecord: CodexWorktreeRecord = {
    ...existing,
    execution,
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

function resolveBranchName(
  projectId: string,
  options: Pick<PrepareCodexWorktreeOptions, "branchName" | "workItem" | "now">,
): string {
  if (options.branchName?.trim()) {
    return runGitWorktreeOperation(() => normalizeBranchName(options.branchName!));
  }

  const workItemId =
    options.workItem?.id ??
    options.workItem?.externalRef?.itemKey ??
    options.workItem?.externalRef?.itemId ??
    timestampSuffix(options.now);

  return runGitWorktreeOperation(() =>
    normalizeBranchName(`codex/${projectId}/${safeBranchSegment(workItemId)}`),
  );
}

function timestampSuffix(optionsNow: PrepareCodexWorktreeOptions["now"]): string {
  return nowString(optionsNow).replace(/[^0-9A-Za-z]+/g, "").slice(0, 14) || "worktree";
}

function nowString(optionsNow: PrepareCodexWorktreeOptions["now"]): string {
  const value = optionsNow?.() ?? new Date();
  return typeof value === "string" ? value : value.toISOString();
}

function safeBranchSegment(value: string): string {
  return runGitWorktreeOperation(() => safeDirectoryName(value)).replaceAll(".", "-");
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

  const excludePathResult = runCodexGitCommand(
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
    componentId:
      typeof record.componentId === "string" && record.componentId.trim()
        ? record.componentId
        : null,
    state: record.state === "archived" ? "archived" : "active",
    archivedAt: typeof record.archivedAt === "string" ? record.archivedAt : null,
    removedAt: typeof record.removedAt === "string" ? record.removedAt : null,
    execution: normalizeWorktreeExecutionMetadata(record.execution),
  };
}

function applyCodexWorktreeExecutionUpdate(
  existing: unknown,
  update: WorktreeExecutionUpdate,
  updatedAt: string,
): CodexWorktreeExecutionMetadata {
  try {
    return applyWorktreeExecutionUpdate(existing, update, updatedAt);
  } catch (error) {
    if (error instanceof WorktreeExecutionMetadataError) {
      throw new CodexWorktreeServiceError(error.message);
    }

    throw error;
  }
}

function runCodexGitCommand(
  gitRunner: GitRunner,
  commands: GitCommandResult[],
  args: readonly string[],
  cwd?: string,
): GitCommandResult {
  return runGitWorktreeOperation(() =>
    runGitCommand(gitRunner, commands, args, cwd),
  );
}

function runGitWorktreeOperation<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    if (error instanceof GitWorktreeServiceError) {
      throw new CodexWorktreeServiceError(error.message);
    }

    throw error;
  }
}
