import { type NexusProjectConfig } from "./config.js";
import {
  type CreateDevNexusPharoProjectResult,
  type ImportDevNexusPharoProjectResult,
} from "./devNexusPharoProjectService.js";
import { type NexusProjectStatus } from "./nexusProjectService.js";

function asRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}
export function summarizeProjectSetupResult(
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

export function summarizeProjectStatus(project: NexusProjectStatus) {
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

export function summarizeSkillStatus(status: unknown) {
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

export function summarizeSkillRefresh(refresh: unknown) {
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
