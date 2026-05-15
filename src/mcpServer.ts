import { Buffer } from "node:buffer";
import http from "node:http";
import process from "node:process";
import { buildCodexWorktreeGuide } from "./codexWorktreeGuide.js";
import {
  archiveCodexWorktree,
  getCodexWorktreeStatus,
  listCodexWorktrees,
  prepareCodexWorktree,
  recordCodexWorktreeExecution,
  type CodexWorktreePublicationDecisionType,
  type CodexWorktreeState,
  type CodexWorktreeVerificationStatus,
} from "./codexWorktreeService.js";
import { commentCodexWorktreeHandoff } from "./codexWorktreeTrackerHandoff.js";
import { defaultPharoNexusHomePath, loadProjectConfig } from "./config.js";
import {
  createPharoNexusProject,
  getPharoNexusProjectStatus,
  importPharoNexusProject,
  linkPharoNexusProjectTracker,
  listPharoNexusProjects,
  syncPharoNexusProjectTracker,
  type GitRunner,
  type SyncPharoNexusProjectTrackerResult,
} from "./projectService.js";
import { createWorkItemService } from "./workItemService.js";
import type {
  ExternalRef,
  WorkItemPatch,
  WorkItemRef,
  WorkStatus,
} from "./workTrackingTypes.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export const defaultPharoNexusMcpHost = "127.0.0.1";
export const defaultPharoNexusMcpEndpointPath = "/mcp";
export const defaultPharoNexusMcpHealthPath = "/health";
export const pharoNexusMcpProtocolVersion = "2024-11-05";

export interface PharoNexusMcpHttpServerOptions {
  host?: string;
  port: number;
  endpointPath?: string;
  healthPath?: string;
  allowedOrigins?: string[];
  requestBodyLimitBytes?: number;
}

export interface PharoNexusMcpHttpServer {
  server: http.Server;
  host: string;
  port: number;
  endpointPath: string;
  healthPath: string;
  url: string;
  healthUrl: string;
  close: () => Promise<void>;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface PharoNexusMcpToolContext {
  gitRunner?: GitRunner;
  fetch?: typeof fetch;
}

const tools: McpTool[] = [
  {
    name: "project_create",
    description: "Create a PharoNexus project from scratch or by cloning a Git repository.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        name: { type: "string" },
        root: { type: "string" },
        remoteUrl: { type: "string" },
        from: { type: "string" },
        gitInit: { type: "boolean" },
        trackerProjectId: { type: "string" },
        syncTracker: { type: "boolean" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "project_import",
    description: "Import an existing local Git repository as a PharoNexus project without writing PharoNexus metadata into the source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        root: { type: "string" },
        projectRoot: { type: "string" },
        name: { type: "string" },
        trackerProjectId: { type: "string" },
        syncTracker: { type: "boolean" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "project_link_tracker",
    description: "Link a PharoNexus project to an existing tracker project id.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        trackerProjectId: { type: "string" },
      },
      required: ["project", "trackerProjectId"],
      additionalProperties: false,
    },
  },
  {
    name: "project_sync_tracker",
    description: "Register a PharoNexus project with its configured tracker provider.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "project_list",
    description: "List registered PharoNexus projects.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "project_status",
    description: "Show one PharoNexus project by registered id or filesystem path.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_worktree_prepare",
    description: "Prepare a local Codex Git worktree for a managed project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        branchName: { type: "string" },
        worktreeName: { type: "string" },
        baseRef: { type: "string" },
        workItemId: { type: "string" },
        commentWorkItem: { type: "boolean" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_worktree_guide",
    description: "Return read-only guidance for the direct local Codex worktree workflow without starting agents.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        id: { type: "string" },
        project: { type: "string" },
        workItemId: { type: "string" },
        branchName: { type: "string" },
        commentWorkItem: { type: "boolean" },
        removeWorktree: { type: "boolean" },
        publicationDecision: {
          type: "string",
          enum: [
            "not_decided",
            "local_only",
            "direct_integration",
            "review_handoff",
            "blocked",
          ],
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "codex_worktree_list",
    description: "List recorded local Codex worktrees from the PharoNexus home metadata store.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        state: { type: "string", enum: ["active", "archived"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "codex_worktree_status",
    description: "Show one recorded local Codex worktree status from the PharoNexus home metadata store.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        id: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_worktree_record_execution",
    description: "Record commit ids, verification, and publication decisions for a local Codex worktree metadata record.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        id: { type: "string" },
        commitIds: { type: "array", items: { type: "string" } },
        verificationCommand: { type: "string" },
        verificationStatus: {
          type: "string",
          enum: ["passed", "failed", "not_run"],
        },
        verificationSummary: { type: "string" },
        publicationDecision: {
          type: "object",
          properties: {
            type: {
              type: "string",
              enum: [
                "not_decided",
                "local_only",
                "direct_integration",
                "review_handoff",
                "blocked",
              ],
            },
            targetBranch: { type: ["string", "null"] },
            remote: { type: ["string", "null"] },
            prUrl: { type: ["string", "null"] },
            reason: { type: ["string", "null"] },
          },
          required: ["type"],
          additionalProperties: false,
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "codex_worktree_archive",
    description: "Archive a local Codex worktree metadata record, optionally removing the Git worktree.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        id: { type: "string" },
        removeWorktree: { type: "boolean" },
        commentWorkItem: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_create",
    description: "Create a work item through the configured PharoNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        status: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        milestone: { type: ["string", "null"] },
      },
      required: ["title"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_list",
    description: "List work items through the configured PharoNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        status: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } },
          ],
        },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        search: { type: "string" },
        limit: { type: "number" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_get",
    description: "Get a work item through the configured PharoNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_update",
    description: "Update a work item through the configured PharoNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        status: { type: "string" },
        labels: { type: "array", items: { type: "string" } },
        assignees: { type: "array", items: { type: "string" } },
        milestone: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
  },
  {
    name: "work_item_comment",
    description: "Add a comment to a work item through the configured PharoNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        body: { type: "string" },
      },
      required: ["body"],
      additionalProperties: false,
    },
  },
  {
    name: "work_item_set_status",
    description: "Set a work item's status through the configured PharoNexus work tracker.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        projectRoot: { type: "string" },
        id: { type: "string" },
        provider: { type: "string" },
        externalRef: { type: "object" },
        ref: { type: "object" },
        status: { type: "string" },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
];

function asRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string`);
  }

  return value;
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${pathName}.${key} must be a boolean`);
  }

  return value;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${pathName}.${key} must be a number`);
  }

  return value;
}

function optionalNullableString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string | null | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${pathName}.${key} must be a non-empty string or null`);
  }

  return value;
}

function optionalStringArray(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be an array of strings`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error(`${pathName}.${key}[${index}] must be a non-empty string`);
    }

    return item;
  });
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = optionalString(record, key, pathName);
  if (!value) {
    throw new Error(`${pathName}.${key} is required`);
  }

  return value;
}

const workStatuses = new Set<WorkStatus>([
  "todo",
  "ready",
  "in_progress",
  "blocked",
  "done",
  "wont_do",
]);

function parseWorkStatus(value: string, pathName: string): WorkStatus {
  if (!workStatuses.has(value as WorkStatus)) {
    throw new Error(
      `${pathName} must be todo, ready, in_progress, blocked, done, or wont_do`,
    );
  }

  return value as WorkStatus;
}

function optionalWorkStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | undefined {
  const value = optionalString(record, key, pathName);
  return value === undefined ? undefined : parseWorkStatus(value, `${pathName}.${key}`);
}

function optionalWorkStatusQuery(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): WorkStatus | WorkStatus[] | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return parseWorkStatus(value, `${pathName}.${key}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`${pathName}.${key} must be a status or array of statuses`);
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${pathName}.${key}[${index}] must be a status`);
    }

    return parseWorkStatus(item, `${pathName}.${key}[${index}]`);
  });
}

function optionalCodexWorktreeState(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): CodexWorktreeState | undefined {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return undefined;
  }
  if (value !== "active" && value !== "archived") {
    throw new Error(`${pathName}.${key} must be active or archived`);
  }

  return value;
}

function optionalCodexVerificationStatus(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): CodexWorktreeVerificationStatus | undefined {
  const value = optionalString(record, key, pathName);
  if (value === undefined) {
    return undefined;
  }
  if (value !== "passed" && value !== "failed" && value !== "not_run") {
    throw new Error(`${pathName}.${key} must be passed, failed, or not_run`);
  }

  return value;
}

function codexPublicationDecisionType(
  value: string,
  pathName: string,
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

  throw new Error(
    `${pathName} must be not_decided, local_only, direct_integration, review_handoff, or blocked`,
  );
}

function optionalCodexPublicationDecisionType(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): CodexWorktreePublicationDecisionType | undefined {
  const value = optionalString(record, key, pathName);
  return value === undefined
    ? undefined
    : codexPublicationDecisionType(value, `${pathName}.${key}`);
}

function homePathFromArgs(args: Record<string, unknown>): string {
  return optionalString(args, "homePath", "arguments") ?? defaultPharoNexusHomePath();
}

function remoteUrlFromCreateArgs(args: Record<string, unknown>): string | undefined {
  const remoteUrl = optionalString(args, "remoteUrl", "arguments");
  const from = optionalString(args, "from", "arguments");
  if (remoteUrl && from && remoteUrl !== from) {
    throw new Error("arguments.remoteUrl and arguments.from must match when both are provided");
  }

  return remoteUrl ?? from;
}

function projectSelectorFromArgs(args: Record<string, unknown>): {
  project?: string;
  projectRoot?: string;
} {
  const project = optionalString(args, "project", "arguments");
  const projectRoot = optionalString(args, "projectRoot", "arguments");
  return {
    ...(project ? { project } : {}),
    ...(projectRoot ? { projectRoot } : {}),
  };
}

function optionalExternalRef(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): ExternalRef | undefined {
  const value = record[key];
  if (value === undefined || value === null) {
    return undefined;
  }

  const externalRef = asRecord(value, `${pathName}.${key}`);
  const externalRefPath = `${pathName}.${key}`;
  const itemNumber = optionalNumber(externalRef, "itemNumber", externalRefPath);
  return {
    provider: requiredString(externalRef, "provider", externalRefPath),
    host: optionalNullableString(externalRef, "host", externalRefPath),
    repositoryId: optionalNullableString(
      externalRef,
      "repositoryId",
      externalRefPath,
    ),
    repositoryOwner: optionalNullableString(
      externalRef,
      "repositoryOwner",
      externalRefPath,
    ),
    repositoryName: optionalNullableString(
      externalRef,
      "repositoryName",
      externalRefPath,
    ),
    projectId: optionalNullableString(externalRef, "projectId", externalRefPath),
    boardId: optionalNullableString(externalRef, "boardId", externalRefPath),
    itemId: requiredString(externalRef, "itemId", externalRefPath),
    itemNumber:
      itemNumber === undefined
        ? undefined
        : Number.isInteger(itemNumber)
          ? itemNumber
          : (() => {
              throw new Error(`${externalRefPath}.itemNumber must be an integer`);
            })(),
    itemKey: optionalNullableString(externalRef, "itemKey", externalRefPath),
    nodeId: optionalNullableString(externalRef, "nodeId", externalRefPath),
    webUrl: optionalNullableString(externalRef, "webUrl", externalRefPath),
  };
}

function workItemRefFromRecord(
  record: Record<string, unknown>,
  pathName: string,
): WorkItemRef {
  const provider = optionalString(record, "provider", pathName);
  const id = optionalString(record, "id", pathName);
  const externalRef = optionalExternalRef(record, "externalRef", pathName);
  return {
    ...(provider ? { provider } : {}),
    ...(id ? { id } : {}),
    ...(externalRef ? { externalRef } : {}),
  };
}

function workItemRefFromArgs(args: Record<string, unknown>): WorkItemRef {
  const ref = args.ref;
  if (ref !== undefined && ref !== null) {
    return workItemRefFromRecord(asRecord(ref, "arguments.ref"), "arguments.ref");
  }

  return workItemRefFromRecord(args, "arguments");
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function workItemPatchFromArgs(args: Record<string, unknown>): WorkItemPatch {
  const patch: WorkItemPatch = {};
  if (hasOwn(args, "title")) {
    patch.title = requiredString(args, "title", "arguments");
  }
  if (hasOwn(args, "description")) {
    patch.description = optionalNullableString(args, "description", "arguments") ?? null;
  }
  if (hasOwn(args, "status")) {
    patch.status = optionalWorkStatus(args, "status", "arguments");
  }
  if (hasOwn(args, "labels")) {
    patch.labels = optionalStringArray(args, "labels", "arguments") ?? [];
  }
  if (hasOwn(args, "assignees")) {
    patch.assignees = optionalStringArray(args, "assignees", "arguments") ?? [];
  }
  if (hasOwn(args, "milestone")) {
    patch.milestone = optionalNullableString(args, "milestone", "arguments") ?? null;
  }
  if (Object.keys(patch).length === 0) {
    throw new Error("arguments must include at least one work item field to update");
  }

  return patch;
}

function toolResult(value: unknown, isError = false): {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
} {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  };
}

export function listPharoNexusMcpTools(): McpTool[] {
  return tools;
}

function shouldSyncTracker(args: Record<string, unknown>): boolean {
  const requested = optionalBoolean(args, "syncTracker", "arguments");
  if (requested !== undefined) {
    return requested;
  }

  return !optionalString(args, "trackerProjectId", "arguments");
}

async function syncProjectForMcp(
  args: Record<string, unknown>,
  context: PharoNexusMcpToolContext,
  homePath: string,
  projectRoot: string,
): Promise<SyncPharoNexusProjectTrackerResult | undefined> {
  if (!shouldSyncTracker(args)) {
    return undefined;
  }

  return syncPharoNexusProjectTracker({
    homePath,
    project: projectRoot,
    host: optionalString(args, "vibeHost", "arguments"),
    port: optionalNumber(args, "vibePort", "arguments"),
    fetch: context.fetch,
  });
}

export async function callPharoNexusMcpTool(
  name: string,
  argsValue: unknown,
  context: PharoNexusMcpToolContext = {},
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "project_create": {
        const homePath = homePathFromArgs(args);
        const created = createPharoNexusProject({
          homePath,
          name: requiredString(args, "name", "arguments"),
          root: optionalString(args, "root", "arguments"),
          from: remoteUrlFromCreateArgs(args),
          gitInit: optionalBoolean(args, "gitInit", "arguments"),
          vibeKanbanProjectId: optionalString(
            args,
            "trackerProjectId",
            "arguments",
          ),
          gitRunner: context.gitRunner,
        });
        let trackerSync: SyncPharoNexusProjectTrackerResult | undefined;
        try {
          trackerSync = await syncProjectForMcp(
            args,
            context,
            homePath,
            created.projectRoot,
          );
        } catch (error) {
          throw new Error(
            `Project was created locally at ${created.projectRoot}, but tracker sync failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        return toolResult({
          ok: true,
          ...created,
          projectConfig: trackerSync
            ? loadProjectConfig(created.projectRoot)
            : created.projectConfig,
          plexusProjectConfig:
            trackerSync?.plexusProjectConfig ?? created.plexusProjectConfig,
          ...(trackerSync ? { trackerSync } : {}),
        });
      }
      case "project_import": {
        const homePath = homePathFromArgs(args);
        const imported = importPharoNexusProject({
          homePath,
          root: requiredString(args, "root", "arguments"),
          projectRoot: optionalString(args, "projectRoot", "arguments"),
          name: optionalString(args, "name", "arguments"),
          vibeKanbanProjectId: optionalString(
            args,
            "trackerProjectId",
            "arguments",
          ),
          gitRunner: context.gitRunner,
        });
        let trackerSync: SyncPharoNexusProjectTrackerResult | undefined;
        try {
          trackerSync = await syncProjectForMcp(
            args,
            context,
            homePath,
            imported.projectRoot,
          );
        } catch (error) {
          throw new Error(
            `Project was imported locally at ${imported.projectRoot}, but tracker sync failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }

        return toolResult({
          ok: true,
          ...imported,
          projectConfig: trackerSync
            ? loadProjectConfig(imported.projectRoot)
            : imported.projectConfig,
          plexusProjectConfig:
            trackerSync?.plexusProjectConfig ?? imported.plexusProjectConfig,
          ...(trackerSync ? { trackerSync } : {}),
        });
      }
      case "project_link_tracker":
        return toolResult({
          ok: true,
          ...linkPharoNexusProjectTracker({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
            trackerProjectId: requiredString(
              args,
              "trackerProjectId",
              "arguments",
            ),
          }),
        });
      case "project_sync_tracker":
        return toolResult({
          ok: true,
          ...(await syncPharoNexusProjectTracker({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
            host: optionalString(args, "vibeHost", "arguments"),
            port: optionalNumber(args, "vibePort", "arguments"),
            fetch: context.fetch,
          })),
        });
      case "project_list":
        return toolResult({
          ok: true,
          ...listPharoNexusProjects({
            homePath: homePathFromArgs(args),
          }),
        });
      case "project_status":
        return toolResult({
          ok: true,
          ...getPharoNexusProjectStatus({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
      case "codex_worktree_guide":
        return toolResult({
          ok: true,
          ...buildCodexWorktreeGuide({
            homePath: homePathFromArgs(args),
            id: optionalString(args, "id", "arguments"),
            project: optionalString(args, "project", "arguments"),
            workItemId: optionalString(args, "workItemId", "arguments"),
            branchName: optionalString(args, "branchName", "arguments"),
            commentWorkItem: optionalBoolean(args, "commentWorkItem", "arguments"),
            removeWorktree: optionalBoolean(args, "removeWorktree", "arguments"),
            publicationDecision: optionalCodexPublicationDecisionType(
              args,
              "publicationDecision",
              "arguments",
            ),
          }),
        });
      case "codex_worktree_prepare": {
        const workItemId = optionalString(args, "workItemId", "arguments");
        const homePath = homePathFromArgs(args);
        const prepared = prepareCodexWorktree({
          homePath,
          project: requiredString(args, "project", "arguments"),
          branchName: optionalString(args, "branchName", "arguments"),
          worktreeName: optionalString(args, "worktreeName", "arguments"),
          baseRef: optionalString(args, "baseRef", "arguments"),
          workItem: workItemId ? { id: workItemId } : undefined,
          gitRunner: context.gitRunner,
        });
        const trackerComment = optionalBoolean(args, "commentWorkItem", "arguments")
          ? await commentCodexWorktreeHandoff({
              homePath,
              metadataPath: prepared.metadataPath,
              metadataRecord: prepared.metadataRecord,
              event: "prepared",
            })
          : undefined;
        return toolResult({
          ok: true,
          ...prepared,
          ...(trackerComment ? { trackerComment } : {}),
        });
      }
      case "codex_worktree_list":
        return toolResult({
          ok: true,
          ...listCodexWorktrees({
            homePath: homePathFromArgs(args),
            project: optionalString(args, "project", "arguments"),
            state: optionalCodexWorktreeState(args, "state", "arguments"),
          }),
        });
      case "codex_worktree_status":
        return toolResult({
          ok: true,
          ...getCodexWorktreeStatus({
            homePath: homePathFromArgs(args),
            id: requiredString(args, "id", "arguments"),
          }),
        });
      case "codex_worktree_record_execution": {
        const publicationValue = args.publicationDecision;
        const publication = publicationValue === undefined || publicationValue === null
          ? undefined
          : asRecord(publicationValue, "arguments.publicationDecision");
        const verificationCommand = optionalString(
          args,
          "verificationCommand",
          "arguments",
        );
        if (
          !verificationCommand &&
          (args.verificationStatus !== undefined ||
            args.verificationSummary !== undefined)
        ) {
          throw new Error(
            "arguments.verificationStatus and arguments.verificationSummary require arguments.verificationCommand",
          );
        }
        return toolResult({
          ok: true,
          ...recordCodexWorktreeExecution({
            homePath: homePathFromArgs(args),
            id: requiredString(args, "id", "arguments"),
            commitIds: optionalStringArray(args, "commitIds", "arguments"),
            verification: verificationCommand
              ? {
                  command: verificationCommand,
                  status: optionalCodexVerificationStatus(
                    args,
                    "verificationStatus",
                    "arguments",
                  ),
                  summary: optionalString(
                    args,
                    "verificationSummary",
                    "arguments",
                  ),
                }
              : undefined,
            publicationDecision: publication
              ? {
                  type: codexPublicationDecisionType(
                    requiredString(
                      publication,
                      "type",
                      "arguments.publicationDecision",
                    ),
                    "arguments.publicationDecision.type",
                  ),
                  targetBranch: optionalNullableString(
                    publication,
                    "targetBranch",
                    "arguments.publicationDecision",
                  ),
                  remote: optionalNullableString(
                    publication,
                    "remote",
                    "arguments.publicationDecision",
                  ),
                  prUrl: optionalNullableString(
                    publication,
                    "prUrl",
                    "arguments.publicationDecision",
                  ),
                  reason: optionalNullableString(
                    publication,
                    "reason",
                    "arguments.publicationDecision",
                  ),
                }
              : undefined,
          }),
        });
      }
      case "codex_worktree_archive": {
        const homePath = homePathFromArgs(args);
        const archived = archiveCodexWorktree({
          homePath,
          id: requiredString(args, "id", "arguments"),
          removeWorktree: optionalBoolean(args, "removeWorktree", "arguments"),
          gitRunner: context.gitRunner,
        });
        const trackerComment = optionalBoolean(args, "commentWorkItem", "arguments")
          ? await commentCodexWorktreeHandoff({
              homePath,
              metadataPath: archived.metadataPath,
              metadataRecord: archived.metadataRecord,
              event: "archived",
              removedWorktree: archived.removedWorktree,
            })
          : undefined;
        return toolResult({
          ok: true,
          ...archived,
          ...(trackerComment ? { trackerComment } : {}),
        });
      }
      case "work_item_create": {
        const service = createWorkItemService({ homePath: homePathFromArgs(args) });
        return toolResult({
          ok: true,
          workItem: await service.createWorkItem({
            ...projectSelectorFromArgs(args),
            title: requiredString(args, "title", "arguments"),
            description: optionalNullableString(args, "description", "arguments"),
            status: optionalWorkStatus(args, "status", "arguments"),
            labels: optionalStringArray(args, "labels", "arguments"),
            assignees: optionalStringArray(args, "assignees", "arguments"),
            milestone: optionalNullableString(args, "milestone", "arguments"),
          }),
        });
      }
      case "work_item_list": {
        const service = createWorkItemService({ homePath: homePathFromArgs(args) });
        return toolResult({
          ok: true,
          workItems: await service.listWorkItems({
            ...projectSelectorFromArgs(args),
            status: optionalWorkStatusQuery(args, "status", "arguments"),
            labels: optionalStringArray(args, "labels", "arguments"),
            assignees: optionalStringArray(args, "assignees", "arguments"),
            search: optionalString(args, "search", "arguments"),
            limit: optionalNumber(args, "limit", "arguments"),
          }),
        });
      }
      case "work_item_get": {
        const service = createWorkItemService({ homePath: homePathFromArgs(args) });
        return toolResult({
          ok: true,
          workItem: await service.getWorkItem({
            ...projectSelectorFromArgs(args),
            ...workItemRefFromArgs(args),
          }),
        });
      }
      case "work_item_update": {
        const service = createWorkItemService({ homePath: homePathFromArgs(args) });
        return toolResult({
          ok: true,
          workItem: await service.updateWorkItem({
            ...projectSelectorFromArgs(args),
            ref: workItemRefFromArgs(args),
            patch: workItemPatchFromArgs(args),
          }),
        });
      }
      case "work_item_comment": {
        const service = createWorkItemService({ homePath: homePathFromArgs(args) });
        return toolResult({
          ok: true,
          comment: await service.addComment({
            ...projectSelectorFromArgs(args),
            ref: workItemRefFromArgs(args),
            body: requiredString(args, "body", "arguments"),
          }),
        });
      }
      case "work_item_set_status": {
        const service = createWorkItemService({ homePath: homePathFromArgs(args) });
        return toolResult({
          ok: true,
          workItem: await service.setStatus({
            ...projectSelectorFromArgs(args),
            ref: workItemRefFromArgs(args),
            status: parseWorkStatus(requiredString(args, "status", "arguments"), "arguments.status"),
          }),
        });
      }
      default:
        return toolResult(
          {
            ok: false,
            error: `Unknown PharoNexus MCP tool: ${name}`,
          },
          true,
        );
    }
  } catch (error) {
    return toolResult(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}

function jsonRpcResult(id: JsonRpcId | undefined, result: unknown): unknown {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
): unknown {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function normalizePath(pathName: string): string {
  return pathName.startsWith("/") ? pathName : `/${pathName}`;
}

function writeJsonResponse(
  response: http.ServerResponse,
  statusCode: number,
  value: unknown,
): void {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body, "utf8"),
    "mcp-protocol-version": pharoNexusMcpProtocolVersion,
  });
  response.end(body);
}

function writeEmptyResponse(
  response: http.ServerResponse,
  statusCode: number,
): void {
  response.writeHead(statusCode, {
    "mcp-protocol-version": pharoNexusMcpProtocolVersion,
  });
  response.end();
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function headerHostName(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value.startsWith("[")) {
    const endIndex = value.indexOf("]");
    return endIndex >= 0 ? value.slice(0, endIndex + 1) : value;
  }

  return value.split(":")[0];
}

function isAllowedHostHeader(
  hostHeader: string | undefined,
  configuredHost: string,
): boolean {
  const host = headerHostName(hostHeader);
  if (!host) {
    return true;
  }

  if (host === configuredHost) {
    return true;
  }

  return isLoopbackHostname(host) && isLoopbackHostname(configuredHost);
}

function isAllowedOrigin(
  origin: string | undefined,
  configuredHost: string,
  allowedOrigins: string[],
): boolean {
  if (!origin) {
    return true;
  }

  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      isLoopbackHostname(parsed.hostname) &&
      isLoopbackHostname(configuredHost)
    );
  } catch {
    return false;
  }
}

function readRequestBody(
  request: http.IncomingMessage,
  limitBytes: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let totalLength = 0;

    request.on("data", (chunk: Buffer) => {
      totalLength += chunk.length;
      if (totalLength > limitBytes) {
        reject(new Error("MCP request body is too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.once("error", reject);
    request.once("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, ""));
    });
  });
}

function parseToolCallParams(value: unknown): { name: string; arguments?: unknown } {
  const params = asRecord(value, "params");
  const name = requiredString(params, "name", "params");

  return {
    name,
    arguments: params.arguments,
  };
}

async function handleJsonRpcMessage(message: JsonRpcRequest): Promise<unknown | undefined> {
  switch (message.method) {
    case "initialize":
      return jsonRpcResult(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: "pharo-nexus",
          version: "0.1.0",
        },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return jsonRpcResult(message.id, {
        tools: listPharoNexusMcpTools(),
      });
    case "tools/call": {
      const params = parseToolCallParams(message.params);
      return jsonRpcResult(
        message.id,
        await callPharoNexusMcpTool(params.name, params.arguments),
      );
    }
    default:
      if (message.id === undefined) {
        return undefined;
      }

      return jsonRpcError(message.id, -32601, `Method not found: ${message.method}`);
  }
}

async function handleJsonRpcHttpPayload(
  payload: unknown,
): Promise<unknown | undefined> {
  if (Array.isArray(payload)) {
    const responses = (
      await Promise.all(
        payload.map((entry) => handleJsonRpcMessage(entry as JsonRpcRequest)),
      )
    ).filter((entry) => entry !== undefined);

    return responses.length > 0 ? responses : undefined;
  }

  return handleJsonRpcMessage(payload as JsonRpcRequest);
}

function pharoNexusMcpServerUrl(
  host: string,
  port: number,
  pathName: string,
): string {
  const formattedHost = host.includes(":") && !host.startsWith("[")
    ? `[${host}]`
    : host;
  return `http://${formattedHost}:${port}${pathName}`;
}

export function startPharoNexusMcpHttpServer(
  options: PharoNexusMcpHttpServerOptions,
): Promise<PharoNexusMcpHttpServer> {
  const host = options.host ?? defaultPharoNexusMcpHost;
  const endpointPath = normalizePath(
    options.endpointPath ?? defaultPharoNexusMcpEndpointPath,
  );
  const healthPath = normalizePath(
    options.healthPath ?? defaultPharoNexusMcpHealthPath,
  );
  const requestBodyLimitBytes = options.requestBodyLimitBytes ?? 1024 * 1024;

  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error("PharoNexus MCP HTTP port must be an integer between 1 and 65535");
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? "/",
        pharoNexusMcpServerUrl(host, options.port, "/"),
      );
      if (
        !isAllowedHostHeader(request.headers.host, host) ||
        !isAllowedOrigin(request.headers.origin, host, options.allowedOrigins ?? [])
      ) {
        writeJsonResponse(response, 403, {
          ok: false,
          error: "Forbidden MCP request origin",
        });
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === healthPath) {
        writeJsonResponse(response, 200, {
          ok: true,
          service: "pharo-nexus-mcp",
        });
        return;
      }

      if (requestUrl.pathname !== endpointPath) {
        writeJsonResponse(response, 404, {
          ok: false,
          error: "Not found",
        });
        return;
      }

      if (request.method !== "POST") {
        response.setHeader("allow", "POST");
        writeJsonResponse(response, 405, {
          ok: false,
          error: "Method not allowed",
        });
        return;
      }

      let payload: unknown;
      try {
        payload = JSON.parse(
          await readRequestBody(request, requestBodyLimitBytes),
        );
      } catch (error) {
        writeJsonResponse(
          response,
          error instanceof Error &&
            error.message === "MCP request body is too large"
            ? 413
            : 400,
          jsonRpcError(
            undefined,
            -32700,
            error instanceof Error ? error.message : String(error),
          ),
        );
        return;
      }

      try {
        const result = await handleJsonRpcHttpPayload(payload);
        if (result === undefined) {
          writeEmptyResponse(response, 202);
          return;
        }

        writeJsonResponse(response, 200, result);
      } catch (error) {
        writeJsonResponse(
          response,
          500,
          jsonRpcError(
            undefined,
            -32603,
            error instanceof Error ? error.message : String(error),
          ),
        );
      }
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        writeJsonResponse(response, 500, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } else {
        response.end();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, host, () => {
      server.off("error", reject);
      resolve({
        server,
        host,
        port: options.port,
        endpointPath,
        healthPath,
        url: pharoNexusMcpServerUrl(host, options.port, endpointPath),
        healthUrl: pharoNexusMcpServerUrl(host, options.port, healthPath),
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }

              closeResolve();
            });
          }),
      });
    });
  });
}

class StdioJsonRpcTransport {
  private buffer = Buffer.alloc(0);
  private processing = false;

  constructor(
    private readonly onMessage: (
      message: JsonRpcRequest,
    ) => Promise<unknown | undefined>,
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      process.stdin.on("data", (chunk: Buffer) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        void this.processBuffer().catch((error: unknown) => {
          this.send(
            jsonRpcError(
              undefined,
              -32603,
              error instanceof Error ? error.message : String(error),
            ),
          );
        });
      });
      process.stdin.once("end", resolve);
    });
  }

  private async processBuffer(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      while (true) {
        const headerEnd = this.headerEndIndex();
        if (!headerEnd) {
          return;
        }

        const [endIndex, separatorLength] = headerEnd;
        const header = this.buffer.slice(0, endIndex).toString("utf8");
        const lengthMatch = /^Content-Length:\s*(\d+)\s*$/im.exec(header);
        if (!lengthMatch) {
          throw new Error("Missing Content-Length header");
        }

        const contentLength = Number(lengthMatch[1]);
        const messageStart = endIndex + separatorLength;
        const messageEnd = messageStart + contentLength;
        if (this.buffer.length < messageEnd) {
          return;
        }

        const body = this.buffer.slice(messageStart, messageEnd).toString("utf8");
        this.buffer = this.buffer.slice(messageEnd);
        const response = await this.onMessage(JSON.parse(body) as JsonRpcRequest);
        if (response) {
          this.send(response);
        }
      }
    } finally {
      this.processing = false;
      if (this.headerEndIndex()) {
        void this.processBuffer();
      }
    }
  }

  private headerEndIndex(): [number, number] | undefined {
    const crlfIndex = this.buffer.indexOf("\r\n\r\n");
    if (crlfIndex >= 0) {
      return [crlfIndex, 4];
    }

    const lfIndex = this.buffer.indexOf("\n\n");
    return lfIndex >= 0 ? [lfIndex, 2] : undefined;
  }

  private send(message: unknown): void {
    const body = JSON.stringify(message);
    process.stdout.write(
      `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
    );
  }
}

export async function runPharoNexusMcpStdioServer(): Promise<void> {
  const transport = new StdioJsonRpcTransport(handleJsonRpcMessage);
  await transport.start();
}

export async function runPharoNexusMcpServer(
  options: PharoNexusMcpHttpServerOptions,
): Promise<void> {
  const running = await startPharoNexusMcpHttpServer(options);
  process.stderr.write(`PharoNexus MCP HTTP server listening at ${running.url}\n`);
  await new Promise<void>((resolve) => {
    running.server.once("close", resolve);
  });
}
