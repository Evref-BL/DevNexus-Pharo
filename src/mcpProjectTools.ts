import { providerCompatibleMcpTools } from "dev-nexus";
import { defaultNexusHomePath, type NexusProjectConfig } from "./config.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
  type CreateDevNexusPharoProjectResult,
  type ImportDevNexusPharoProjectResult,
} from "./devNexusPharoProjectService.js";
import {
  getNexusProjectStatus,
  listNexusProjects,
  type GitRunner,
  type NexusProjectStatus,
} from "./nexusProjectService.js";
import {
  getProjectSkillStatus,
  refreshProjectSkills,
} from "./nexusProjectSkillService.js";

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

function summarizeProjectSetupResult(
  result: CreateDevNexusPharoProjectResult | ImportDevNexusPharoProjectResult,
) {
  return {
    homePath: result.homePath,
    projectRoot: result.projectRoot,
    projectConfigPath: result.projectConfigPath,
    plexusProjectConfigPath: result.plexusProjectConfigPath,
    worktreesRoot: result.worktreesRoot,
    agentsPath: result.agentsPath,
    suggestedFirstPromptPath: result.suggestedFirstPromptPath,
    codexConfigPath: result.codexConfigPath,
    projectConfig: summarizeProjectConfig(result.projectConfig),
    plexusProjectConfig: summarizePlexusProjectConfig(result.plexusProjectConfig),
    codex: summarizeCodexInitResult(result.codex),
    git: summarizeGitOperation(result.git),
  };
}

function summarizeProjectConfig(config: NexusProjectConfig) {
  return {
    version: config.version,
    id: config.id,
    name: config.name,
    repo: {
      kind: config.repo.kind,
      remoteUrl: config.repo.remoteUrl,
      defaultBranch: config.repo.defaultBranch,
      sourceRoot: config.repo.sourceRoot ?? null,
    },
    componentCount: config.components.length,
    components: config.components.map((component) => ({
      id: component.id,
      name: component.name,
      kind: component.kind,
      role: component.role,
      remoteUrl: component.remoteUrl,
      defaultBranch: component.defaultBranch,
      sourceRoot: component.sourceRoot ?? null,
      relationshipCount: component.relationships.length,
    })),
    pluginCount: config.plugins?.length ?? 0,
    enabledPlugins: config.plugins
      ?.filter((plugin) => plugin.enabled !== false)
      .map((plugin) => ({
        id: plugin.id,
        capabilityCount: plugin.capabilities.length,
      })) ?? [],
    worktreesRoot: config.worktreesRoot,
  };
}

function summarizeProjectStatus(project: NexusProjectStatus) {
  return {
    id: project.id,
    name: project.name,
    projectRoot: project.projectRoot,
    repo: project.repo
      ? {
          kind: project.repo.kind,
          remoteUrl: project.repo.remoteUrl,
          defaultBranch: project.repo.defaultBranch,
          sourceRoot: project.repo.sourceRoot ?? null,
        }
      : null,
    componentCount: project.components.length,
    components: project.components.map((component) => ({
      id: component.id,
      name: component.name,
      kind: component.kind,
      role: component.role,
      sourceRoot: component.sourceRoot,
      sourceRootExists: component.sourceRootExists,
      worktreesRoot: component.worktreesRoot,
      worktreesRootExists: component.worktreesRootExists,
      workTrackerCount: component.workTrackers.length,
      workTracking: component.workTracking
        ? { provider: component.workTracking.provider }
        : null,
      relationshipCount: component.relationships.length,
    })),
    workTracking: project.workTracking
      ? { provider: project.workTracking.provider }
      : null,
    projectConfigPath: project.projectConfigPath,
    projectConfigExists: project.projectConfigExists,
    plexusProjectConfigPath: project.plexusProjectConfigPath,
    plexusProjectConfigExists: project.plexusProjectConfigExists,
    worktreesRoot: project.worktreesRoot,
    worktreesRootExists: project.worktreesRootExists,
  };
}

function summarizePlexusProjectConfig(config: unknown) {
  const record = asRecord(config, "plexusProjectConfig");
  const imageExecution = record.imageExecution &&
    typeof record.imageExecution === "object"
    ? record.imageExecution as Record<string, unknown>
    : null;
  const runtime = record.runtime && typeof record.runtime === "object"
    ? record.runtime as Record<string, unknown>
    : null;
  const gateway = runtime?.gateway && typeof runtime.gateway === "object"
    ? runtime.gateway as Record<string, unknown>
    : null;
  return {
    id: record.id,
    name: record.name,
    imageCount: Array.isArray(record.images) ? record.images.length : 0,
    imageExecution: imageExecution
      ? {
          mode: imageExecution.mode,
          requireDisposableImage: imageExecution.requireDisposableImage,
          requireCleanupPlan: imageExecution.requireCleanupPlan,
        }
      : null,
    gateway: gateway
      ? {
          mode: gateway.mode,
          host: gateway.host,
          port: gateway.port,
          agentMcpServerName: gateway.agentMcpServerName,
          agentMcpPath: gateway.agentMcpPath,
          routeControlMcpPath: gateway.routeControlMcpPath,
        }
      : null,
  };
}

function summarizeCodexInitResult(codex: unknown) {
  const record = asRecord(codex, "codex");
  const servers = record.servers && typeof record.servers === "object"
    ? record.servers as Record<string, unknown>
    : {};
  return {
    workspacePath: record.workspacePath,
    configPath: record.configPath,
    plexusProjectConfigPath: record.plexusProjectConfigPath,
    plexusProjectConfigCreated: record.plexusProjectConfigCreated,
    updated: record.updated,
    serverCount: Object.keys(servers).length,
    servers: Object.entries(servers).map(([name, serverValue]) => {
      const server = serverValue && typeof serverValue === "object"
        ? serverValue as Record<string, unknown>
        : {};
      return {
        name,
        type: server.type ?? "stdio",
        enabled: server.enabled,
        command: server.command,
        argCount: Array.isArray(server.args) ? server.args.length : 0,
        url: server.url,
        envCount:
          server.env && typeof server.env === "object"
            ? Object.keys(server.env).length
            : 0,
      };
    }),
    contentLength:
      typeof record.content === "string" ? record.content.length : null,
  };
}

function summarizeGitOperation(
  git:
    | CreateDevNexusPharoProjectResult["git"]
    | ImportDevNexusPharoProjectResult["git"],
) {
  return {
    operation: git.operation,
    remoteUrl: git.remoteUrl,
    defaultBranch: git.defaultBranch,
    commandCount: git.commands.length,
    commands: git.commands.map((command) => ({
      args: command.args,
      exitCode: command.exitCode,
      stdoutLength: command.stdout.length,
      stderrLength: command.stderr.length,
    })),
  };
}

function summarizeSkillStatus(status: unknown) {
  const record = asRecord(status, "skillStatus");
  const skills = Array.isArray(record.skills) ? record.skills : [];
  const attentionSkills = skills.filter(skillNeedsAttention);
  return {
    skillsDirectory: record.skillsDirectory,
    summary: record.summary,
    skillCount: skills.length,
    skillIds: skills.flatMap((skill) => {
      const record = skill && typeof skill === "object"
        ? skill as Record<string, unknown>
        : {};
      return typeof record.id === "string" ? [record.id] : [];
    }),
    attentionSkillCount: attentionSkills.length,
    omittedInstalledSkillCount: skills.length - attentionSkills.length,
    skills: attentionSkills.slice(0, 10).map(summarizeSkillRecord),
  };
}

function summarizeSkillRefresh(refresh: unknown) {
  const record = asRecord(refresh, "refresh");
  const materialized = Array.isArray(record.materialized)
    ? record.materialized
    : [];
  return {
    before: summarizeSkillStatus(record.before),
    after: summarizeSkillStatus(record.after),
    materializedCount: materialized.length,
    materialized: materialized.slice(0, 10).map(summarizeSkillRecord),
  };
}

function skillNeedsAttention(value: unknown): boolean {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  return (
    record.state !== "installed" ||
    record.installed !== true ||
    record.expected !== true ||
    reasons.length > 0
  );
}

function summarizeSkillRecord(value: unknown) {
  const record = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const reasons = Array.isArray(record.reasons) ? record.reasons : [];
  return {
    id: record.id,
    state: record.state,
    expected: record.expected,
    installed: record.installed,
    name: record.name,
    expectedVersion: record.expectedVersion,
    installedVersion: record.installedVersion,
    materialization: record.materialization,
    sourceControl: record.sourceControl,
    reasonCount: reasons.length,
    reasons: reasons.slice(0, 3),
  };
}
