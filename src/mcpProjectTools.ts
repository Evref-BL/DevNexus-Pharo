import { providerCompatibleMcpTools } from "dev-nexus";
import { defaultNexusHomePath } from "./config.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
} from "./devNexusPharoProjectService.js";
import {
  getNexusProjectStatus,
  listNexusProjects,
  type GitRunner,
} from "./nexusProjectService.js";
import {
  getProjectSkillStatus,
  refreshProjectSkills,
} from "./nexusProjectSkillService.js";
import {
  summarizeProjectSetupResult,
  summarizeProjectStatus,
  summarizeSkillRefresh,
  summarizeSkillStatus,
} from "./mcpProjectToolSummaries.js";
import {
  summarizePlexusWorkspaceHandoff,
} from "./plexusWorkspaceHandoff.js";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface DevNexusPharoMcpToolContext {
  gitRunner?: GitRunner;
  fetch?: typeof fetch;
}

type McpDetail = "summary" | "full";

const tools: McpTool[] = [
  {
    name: "pharo_project_create",
    description: "Create a DevNexus-Pharo project from scratch or by cloning a Git repository.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        name: { type: "string" },
        root: { type: "string" },
        remoteUrl: { type: "string" },
        from: { type: "string" },
        gitInit: { type: "boolean" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_import",
    description: "Import an existing local Git repository as a DevNexus-Pharo project without writing DevNexus-Pharo metadata into the source checkout.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        root: { type: "string" },
        projectRoot: { type: "string" },
        name: { type: "string" },
      },
      required: ["root"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_list",
    description: "List registered DevNexus-Pharo projects.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_status",
    description: "Show one DevNexus-Pharo project by registered id or filesystem path.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_skill_status",
    description: "Inspect installed DevNexus support skills for a DevNexus-Pharo project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_project_skill_refresh",
    description: "Refresh selected DevNexus support skills for a DevNexus-Pharo project.",
    inputSchema: {
      type: "object",
      properties: {
        homePath: { type: "string" },
        detail: { type: "string", enum: ["summary", "full"], default: "summary" },
        project: { type: "string" },
      },
      required: ["project"],
      additionalProperties: false,
    },
  },
  {
    name: "pharo_workspace_handoff_summarize",
    description: "Summarize a PLexus workspace status result for provider-neutral Pharo runtime handoff.",
    inputSchema: {
      type: "object",
      properties: {
        plexusStatus: {
          type: "object",
          additionalProperties: true,
        },
      },
      required: ["plexusStatus"],
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

function requiredRecord(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): Record<string, unknown> {
  return asRecord(record[key], `${pathName}.${key}`);
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

function mcpDetailFromArgs(args: Record<string, unknown>): McpDetail {
  const detail = optionalString(args, "detail", "arguments") ?? "summary";
  if (detail === "summary" || detail === "full") {
    return detail;
  }

  throw new Error("arguments.detail must be summary or full");
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
  return providerCompatibleMcpTools(tools);
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
    const args = argsValue === undefined ? {} : asRecord(argsValue, "arguments");
    switch (name) {
      case "pharo_project_create": {
        const detail = mcpDetailFromArgs(args);
        const homePath = homePathFromArgs(args);
        const created = createDevNexusPharoProject({
          homePath,
          name: requiredString(args, "name", "arguments"),
          root: optionalString(args, "root", "arguments"),
          from: remoteUrlFromCreateArgs(args),
          gitInit: optionalBoolean(args, "gitInit", "arguments"),
          gitRunner: context.gitRunner,
        });

        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? created
            : summarizeProjectSetupResult(created)),
        });
      }
      case "pharo_project_import": {
        const detail = mcpDetailFromArgs(args);
        const homePath = homePathFromArgs(args);
        const imported = importDevNexusPharoProject({
          homePath,
          root: requiredString(args, "root", "arguments"),
          projectRoot: optionalString(args, "projectRoot", "arguments"),
          name: optionalString(args, "name", "arguments"),
          gitRunner: context.gitRunner,
        });

        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? imported
            : summarizeProjectSetupResult(imported)),
        });
      }
      case "pharo_project_list": {
        const detail = mcpDetailFromArgs(args);
        const result = listNexusProjects({
          homePath: homePathFromArgs(args),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                projectCount: result.projects.length,
                projects: result.projects.map(summarizeProjectStatus),
              }),
        });
      }
      case "pharo_project_status": {
        const detail = mcpDetailFromArgs(args);
        const result = getNexusProjectStatus({
          homePath: homePathFromArgs(args),
          project: requiredString(args, "project", "arguments"),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                project: summarizeProjectStatus(result.project),
              }),
        });
      }
      case "pharo_project_skill_status": {
        const detail = mcpDetailFromArgs(args);
        const result = getProjectSkillStatus({
          homePath: homePathFromArgs(args),
          project: requiredString(args, "project", "arguments"),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                project: summarizeProjectStatus(result.project),
                skillStatus: summarizeSkillStatus(result.skillStatus),
              }),
        });
      }
      case "pharo_project_skill_refresh": {
        const detail = mcpDetailFromArgs(args);
        const result = refreshProjectSkills({
          homePath: homePathFromArgs(args),
          project: requiredString(args, "project", "arguments"),
        });
        return toolResult({
          ok: true,
          detail,
          ...(detail === "full"
            ? result
            : {
                homePath: result.homePath,
                project: summarizeProjectStatus(result.project),
                refresh: summarizeSkillRefresh(result.refresh),
              }),
        });
      }
      case "pharo_workspace_handoff_summarize":
        return toolResult({
          ok: true,
          summary: summarizePlexusWorkspaceHandoff(
            requiredRecord(args, "plexusStatus", "arguments"),
          ),
        });
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
