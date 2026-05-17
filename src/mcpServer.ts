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
import { defaultNexusHomePath, loadProjectConfig } from "./config.js";
import {
  configureNexusProjectTracker,
  createNexusProject,
  getNexusProjectStatus,
  importNexusProject,
  linkNexusProjectTracker,
  listNexusProjects,
  type GitRunner,
} from "./nexusProjectService.js";
import {
  getProjectSkillStatus,
  refreshProjectSkills,
} from "./nexusProjectSkillService.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
  syncDevNexusPharoProjectTracker,
  type SyncDevNexusPharoProjectTrackerResult,
} from "./devNexusPharoProjectService.js";
import {
  callDevNexusMcpTool,
  listDevNexusMcpTools,
  type DevNexusMcpToolContext,
} from "dev-nexus";
import { legacyTrackerWrapperToolDescription } from "./trackerDeprecation.js";

type JsonRpcId = string | number | null;

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}

export const defaultDevNexusPharoMcpHost = "127.0.0.1";
export const defaultDevNexusPharoMcpEndpointPath = "/mcp";
export const defaultDevNexusPharoMcpHealthPath = "/health";
export const devNexusPharoMcpProtocolVersion = "2024-11-05";

export interface DevNexusPharoMcpHttpServerOptions {
  host?: string;
  port: number;
  endpointPath?: string;
  healthPath?: string;
  allowedOrigins?: string[];
  requestBodyLimitBytes?: number;
}

export interface DevNexusPharoMcpHttpServer {
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

export interface DevNexusPharoMcpToolContext {
  gitRunner?: GitRunner;
  fetch?: typeof fetch;
  now?: DevNexusMcpToolContext["now"];
}

const delegatedDevNexusToolNames = new Set([
  "automation_status",
  "target_cycle_list",
  "target_cycle_record",
  "target_report",
  "work_item_create",
  "work_item_list",
  "work_item_get",
  "work_item_update",
  "work_item_comment",
  "work_item_set_status",
]);

function isDelegatedDevNexusTool(name: string): boolean {
  return delegatedDevNexusToolNames.has(name);
}

const tools: McpTool[] = [
  {
    name: "project_create",
    description: "Create a DevNexus-Pharo project from scratch or by cloning a Git repository.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        name: { type: "string" },
        root: { type: "string" },
        remoteUrl: { type: "string" },
        from: { type: "string" },
        gitInit: { type: "boolean" },
        trackerProjectId: {
          type: "string",
          description: "Legacy Vibe Kanban board id compatibility.",
        },
        syncTracker: {
          type: "boolean",
          description: "Legacy Vibe Kanban repo/board registration compatibility.",
        },
        generic: { type: "boolean" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "project_import",
    description: "Import an existing local Git repository as a DevNexus-Pharo project without writing DevNexus-Pharo metadata into the source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        root: { type: "string" },
        projectRoot: { type: "string" },
        name: { type: "string" },
        trackerProjectId: {
          type: "string",
          description: "Legacy Vibe Kanban board id compatibility.",
        },
        syncTracker: {
          type: "boolean",
          description: "Legacy Vibe Kanban repo/board registration compatibility.",
        },
        generic: { type: "boolean" },
        vibeHost: { type: "string" },
        vibePort: { type: "number" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "project_link_tracker",
    description: legacyTrackerWrapperToolDescription("link-tracker"),
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
    name: "project_configure_tracker",
    description: legacyTrackerWrapperToolDescription("configure-tracker"),
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        provider: { type: "string" },
        host: { type: "string" },
        repositoryOwner: { type: "string" },
        repositoryName: { type: "string" },
        repositoryId: { type: "string" },
        projectKey: { type: "string" },
        issueType: { type: "string" },
        storePath: { type: "string" },
      },
      required: ["project", "provider"],
      additionalProperties: false,
    },
  },
  {
    name: "project_sync_tracker",
    description: legacyTrackerWrapperToolDescription("sync-tracker"),
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
    description: "List registered DevNexus-Pharo projects.",
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
    description: "Show one DevNexus-Pharo project by registered id or filesystem path.",
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
    name: "project_skill_status",
    description: "Inspect installed DevNexus support skills for a DevNexus-Pharo project.",
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
    name: "project_skill_refresh",
    description: "Refresh selected DevNexus support skills for a DevNexus-Pharo project.",
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
    name: "worktree_prepare",
    description: "Prepare a local Git worktree for direct Codex work on a managed project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        project: { type: "string" },
        componentId: { type: "string" },
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
    name: "worktree_guide",
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
    name: "worktree_list",
    description: "List recorded local worktrees from the home metadata store.",
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
    name: "worktree_status",
    description: "Show one recorded local worktree status from the home metadata store.",
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
    name: "worktree_record_execution",
    description: "Record commit ids, verification, and publication decisions for a local worktree metadata record.",
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
    name: "worktree_archive",
    description: "Archive a local worktree metadata record, optionally removing the Git worktree.",
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

function trackerProviderFromArgs(
  record: Record<string, unknown>,
): "local" | "github" | "gitlab" | "jira" {
  const value = requiredString(record, "provider", "arguments");
  if (
    value === "local" ||
    value === "github" ||
    value === "gitlab" ||
    value === "jira"
  ) {
    return value;
  }

  throw new Error("arguments.provider must be local, github, gitlab, or jira");
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
  return optionalString(args, "homePath", "arguments") ?? defaultNexusHomePath();
}

function remoteUrlFromCreateArgs(args: Record<string, unknown>): string | undefined {
  const remoteUrl = optionalString(args, "remoteUrl", "arguments");
  const from = optionalString(args, "from", "arguments");
  if (remoteUrl && from && remoteUrl !== from) {
    throw new Error("arguments.remoteUrl and arguments.from must match when both are provided");
  }

  return remoteUrl ?? from;
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

export function listDevNexusPharoMcpTools(): McpTool[] {
  const delegatedTools = listDevNexusMcpTools().filter((tool) =>
    isDelegatedDevNexusTool(tool.name),
  );
  const localTools = tools.filter((tool) => !isDelegatedDevNexusTool(tool.name));

  return [...localTools, ...delegatedTools];
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
  context: DevNexusPharoMcpToolContext,
  homePath: string,
  projectRoot: string,
): Promise<SyncDevNexusPharoProjectTrackerResult | undefined> {
  if (!shouldSyncTracker(args)) {
    return undefined;
  }

  return syncDevNexusPharoProjectTracker({
    homePath,
    project: projectRoot,
    host: optionalString(args, "vibeHost", "arguments"),
    port: optionalNumber(args, "vibePort", "arguments"),
    fetch: context.fetch,
  });
}

export async function callDevNexusPharoMcpTool(
  name: string,
  argsValue: unknown,
  context: DevNexusPharoMcpToolContext = {},
): Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}> {
  try {
    if (isDelegatedDevNexusTool(name)) {
      return callDevNexusMcpTool(name, argsValue, {
        now: context.now,
      });
    }

    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "project_create": {
        const homePath = homePathFromArgs(args);
        if (optionalBoolean(args, "generic", "arguments")) {
          if (optionalBoolean(args, "syncTracker", "arguments")) {
            throw new Error("generic project_create does not support syncTracker");
          }
          return toolResult({
            ok: true,
            ...createNexusProject({
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
            }),
          });
        }

        const created = createDevNexusPharoProject({
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
        let trackerSync: SyncDevNexusPharoProjectTrackerResult | undefined;
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
        if (optionalBoolean(args, "generic", "arguments")) {
          if (optionalBoolean(args, "syncTracker", "arguments")) {
            throw new Error("generic project_import does not support syncTracker");
          }
          return toolResult({
            ok: true,
            ...importNexusProject({
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
            }),
          });
        }

        const imported = importDevNexusPharoProject({
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
        let trackerSync: SyncDevNexusPharoProjectTrackerResult | undefined;
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
          ...linkNexusProjectTracker({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
            trackerProjectId: requiredString(
              args,
              "trackerProjectId",
              "arguments",
            ),
          }),
        });
      case "project_configure_tracker":
        return toolResult({
          ok: true,
          ...configureNexusProjectTracker({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
            provider: trackerProviderFromArgs(args),
            host: optionalString(args, "host", "arguments"),
            repositoryOwner: optionalString(
              args,
              "repositoryOwner",
              "arguments",
            ),
            repositoryName: optionalString(
              args,
              "repositoryName",
              "arguments",
            ),
            repositoryId: optionalString(args, "repositoryId", "arguments"),
            projectKey: optionalString(args, "projectKey", "arguments"),
            issueType: optionalString(args, "issueType", "arguments"),
            storePath: optionalString(args, "storePath", "arguments"),
          }),
        });
      case "project_sync_tracker":
        return toolResult({
          ok: true,
          ...(await syncDevNexusPharoProjectTracker({
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
          ...listNexusProjects({
            homePath: homePathFromArgs(args),
          }),
        });
      case "project_status":
        return toolResult({
          ok: true,
          ...getNexusProjectStatus({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
      case "project_skill_status":
        return toolResult({
          ok: true,
          ...getProjectSkillStatus({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
      case "project_skill_refresh":
        return toolResult({
          ok: true,
          ...refreshProjectSkills({
            homePath: homePathFromArgs(args),
            project: requiredString(args, "project", "arguments"),
          }),
        });
      case "worktree_guide":
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
      case "worktree_prepare": {
        const workItemId = optionalString(args, "workItemId", "arguments");
        const homePath = homePathFromArgs(args);
        const prepared = prepareCodexWorktree({
          homePath,
          project: requiredString(args, "project", "arguments"),
          componentId: optionalString(args, "componentId", "arguments"),
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
      case "worktree_list":
        return toolResult({
          ok: true,
          ...listCodexWorktrees({
            homePath: homePathFromArgs(args),
            project: optionalString(args, "project", "arguments"),
            state: optionalCodexWorktreeState(args, "state", "arguments"),
          }),
        });
      case "worktree_status":
        return toolResult({
          ok: true,
          ...getCodexWorktreeStatus({
            homePath: homePathFromArgs(args),
            id: requiredString(args, "id", "arguments"),
          }),
        });
      case "worktree_record_execution": {
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
      case "worktree_archive": {
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
      default:
        return toolResult(
          {
            ok: false,
            error: `Unknown DevNexus-Pharo MCP tool: ${name}`,
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
    "mcp-protocol-version": devNexusPharoMcpProtocolVersion,
  });
  response.end(body);
}

function writeEmptyResponse(
  response: http.ServerResponse,
  statusCode: number,
): void {
  response.writeHead(statusCode, {
    "mcp-protocol-version": devNexusPharoMcpProtocolVersion,
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
          name: "dev-nexus-pharo",
          version: "0.1.0",
        },
      });
    case "notifications/initialized":
      return undefined;
    case "tools/list":
      return jsonRpcResult(message.id, {
        tools: listDevNexusPharoMcpTools(),
      });
    case "tools/call": {
      const params = parseToolCallParams(message.params);
      return jsonRpcResult(
        message.id,
        await callDevNexusPharoMcpTool(params.name, params.arguments),
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

function devNexusPharoMcpServerUrl(
  host: string,
  port: number,
  pathName: string,
): string {
  const formattedHost = host.includes(":") && !host.startsWith("[")
    ? `[${host}]`
    : host;
  return `http://${formattedHost}:${port}${pathName}`;
}

export function startDevNexusPharoMcpHttpServer(
  options: DevNexusPharoMcpHttpServerOptions,
): Promise<DevNexusPharoMcpHttpServer> {
  const host = options.host ?? defaultDevNexusPharoMcpHost;
  const endpointPath = normalizePath(
    options.endpointPath ?? defaultDevNexusPharoMcpEndpointPath,
  );
  const healthPath = normalizePath(
    options.healthPath ?? defaultDevNexusPharoMcpHealthPath,
  );
  const requestBodyLimitBytes = options.requestBodyLimitBytes ?? 1024 * 1024;

  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65_535
  ) {
    throw new Error("DevNexus-Pharo MCP HTTP port must be an integer between 1 and 65535");
  }

  const server = http.createServer((request, response) => {
    void (async () => {
      const requestUrl = new URL(
        request.url ?? "/",
        devNexusPharoMcpServerUrl(host, options.port, "/"),
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
          service: "dev-nexus-pharo-mcp",
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
        url: devNexusPharoMcpServerUrl(host, options.port, endpointPath),
        healthUrl: devNexusPharoMcpServerUrl(host, options.port, healthPath),
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

export async function runDevNexusPharoMcpStdioServer(): Promise<void> {
  const transport = new StdioJsonRpcTransport(handleJsonRpcMessage);
  await transport.start();
}

export async function runDevNexusPharoMcpServer(
  options: DevNexusPharoMcpHttpServerOptions,
): Promise<void> {
  const running = await startDevNexusPharoMcpHttpServer(options);
  process.stderr.write(`DevNexus-Pharo MCP HTTP server listening at ${running.url}\n`);
  await new Promise<void>((resolve) => {
    running.server.once("close", resolve);
  });
}
