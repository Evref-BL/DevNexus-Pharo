import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultCoreSkillPack,
  type NexusExtension,
  type NexusSkillDefinition,
} from "dev-nexus";
import {
  type NexusProjectConfig,
} from "./config.js";
import type {
  NexusProjectStatusExtensionContribution,
  NexusProjectTrackerLinkExtensionContribution,
} from "./nexusProjectService.js";

export interface PlexusProjectConfig {
  name: string;
  kanban: {
    provider: "vibe-kanban";
    projectId: string;
  };
  images: unknown[];
  imageExecution: PlexusImageExecutionPolicy;
}

export interface PharoNexusProjectFiles {
  agentsPath: string;
  suggestedFirstPromptPath: string;
  plexusProjectConfigPath: string;
  plexusProjectConfig: PlexusProjectConfig;
}

export const plexusProjectConfigFileName = "plexus.project.json";
export const pharoNexusProjectExtensionConfigKey = "pharo-nexus";

export type PlexusImageExecutionMode = "disabled" | "docker";
export type PlexusImageExecutionDockerNetwork = "none" | "bridge";

export interface PlexusImageExecutionDockerPolicy {
  image: string | null;
  network: PlexusImageExecutionDockerNetwork;
  autoRemove: boolean;
  mountProjectReadOnly: boolean;
}

export interface PlexusImageExecutionPolicy {
  mode: PlexusImageExecutionMode;
  requireDisposableImage: boolean;
  requireCleanupPlan: boolean;
  docker: PlexusImageExecutionDockerPolicy;
}

export const defaultPlexusImageExecutionPolicy: PlexusImageExecutionPolicy = {
  mode: "disabled",
  requireDisposableImage: true,
  requireCleanupPlan: true,
  docker: {
    image: null,
    network: "none",
    autoRemove: true,
    mountProjectReadOnly: true,
  },
};

export interface PharoNexusProjectExtensionConfig {
  plexusProjectConfig?: string;
  imageExecution?: PlexusImageExecutionPolicy;
}

export function pharoNexusProjectExtensionEntry(
  config: PharoNexusProjectExtensionConfig = {},
): Record<typeof pharoNexusProjectExtensionConfigKey, Record<string, unknown>> {
  return {
    [pharoNexusProjectExtensionConfigKey]: { ...config },
  };
}

export function projectUsesPharoNexusExtension(
  projectConfig: Pick<NexusProjectConfig, "extensions"> | undefined,
): boolean {
  return Boolean(
    projectConfig?.extensions?.[pharoNexusProjectExtensionConfigKey],
  );
}

export interface InstallPharoNexusProjectFilesOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  vibeKanbanProjectId?: string | null;
}

const suggestedFirstPromptFileName = "suggestedFirstPrompt.md";

function skillMarkdown(name: string, description: string, body: string): string {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    "---",
    "",
    body.trim(),
    "",
  ].join("\n");
}

function pharoNexusSkill(
  id: string,
  name: string,
  description: string,
  body: string,
): NexusSkillDefinition {
  return {
    manifest: {
      id,
      name,
      description,
      version: "0.1.0",
      license: "Apache-2.0",
      source: {
        type: "curated",
        uri: "pharo-nexus:specialization",
      },
      supportedAgents: ["codex"],
      materialization: "copy",
      sourceControl: "support",
    },
    files: {
      "SKILL.md": skillMarkdown(name, description, body),
    },
  };
}

export const pharoNexusSkillPack: readonly NexusSkillDefinition[] = [
  pharoNexusSkill(
    "pharo-nexus-workflow",
    "pharo-nexus-workflow",
    "Workflow guidance for PharoNexus-managed projects, boards, worktrees, and publication decisions.",
    `
# PharoNexus Workflow

Use this skill when working inside a PharoNexus-managed project.

1. Identify whether the request belongs to the control project or an owning source project.
2. Read local AGENTS.md, NOTES.md, and the project config before changing files.
3. Use provider-neutral project and work-item tools where possible.
4. Confirm direct \`pharo\` MCP tools are available before changing Pharo code; if not, report the MCP infrastructure blocker instead of editing Pharo files.
5. Keep Vibe Kanban as tracker context only unless a task explicitly asks for Vibe diagnostics.
6. Verify focused behavior before broader checks, then record commits and publication state.
`,
  ),
  pharoNexusSkill(
    "plexus-diagnostics",
    "plexus-diagnostics",
    "Diagnostic workflow for PLexus gateway status, route health, and safe project-boundary probes.",
    `
# PLexus Diagnostics

Use this skill when checking PLexus gateway status or route behavior.

1. Prefer non-mutating status calls before live open or route probes.
2. Name the project path, state root, workspace id, target id, and cleanup boundary before live checks.
3. Do not launch images or Docker unless the selected task documents isolation and cleanup.
4. Route findings to the owning project board with reproduction details and expected behavior.
`,
  ),
  pharoNexusSkill(
    "pharo-launcher-lifecycle",
    "pharo-launcher-lifecycle",
    "Safety guidance for Pharo Launcher image creation, launch, inspection, and cleanup operations.",
    `
# Pharo Launcher Lifecycle

Use this skill when a task touches image creation, launch, or cleanup.

1. Treat image launch as host mutation unless an isolated runner is documented.
2. Use disposable image copies for smoke probes when available.
3. Record image identity, filesystem paths, processes, and cleanup commands.
4. Stop and report a blocker if cleanup or ownership is unclear.
`,
  ),
  pharoNexusSkill(
    "mcp-pharo-execution",
    "mcp-pharo-execution",
    "Execution guidance for in-image MCP calls, JSON-RPC reachability, and routed Pharo tool checks.",
    `
# MCP Pharo Execution

Use this skill when validating in-image MCP tool reachability or routed calls.

1. Prove transport reachability before assuming tool behavior is wrong.
2. Use direct \`pharo\` MCP tools for Pharo code work; do not substitute file edits when the MCP surface is missing.
3. Keep routed calls non-mutating until an isolated image boundary is explicit.
4. Capture request shape, response payload, route id, and owning project.
5. Add regression coverage at the lowest layer that owns the failure.
`,
  ),
];

function packageRootPath(): string {
  return path.dirname(path.dirname(fileURLToPath(import.meta.url)));
}

function defaultAgentsTemplatePath(): string {
  return path.join(packageRootPath(), "AGENTS.md");
}

export function projectAgentsPath(projectRoot: string): string {
  return path.join(projectRoot, "AGENTS.md");
}

export function projectSuggestedFirstPromptPath(projectRoot: string): string {
  return path.join(projectRoot, suggestedFirstPromptFileName);
}

function saveJsonFile(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, "")) as T;
}

function resolveFromProject(projectRootPath: string, value: string): string {
  return path.resolve(projectRootPath, value);
}

export function pharoNexusProjectExtensionConfig(
  projectConfig: Pick<NexusProjectConfig, "extensions">,
): PharoNexusProjectExtensionConfig {
  const value = projectConfig.extensions?.[pharoNexusProjectExtensionConfigKey];
  if (value === undefined) {
    return {};
  }

  const plexusProjectConfig = value.plexusProjectConfig;
  if (
    plexusProjectConfig !== undefined &&
    typeof plexusProjectConfig !== "string"
  ) {
    throw new Error(
      `extensions.${pharoNexusProjectExtensionConfigKey}.plexusProjectConfig must be a string`,
    );
  }
  const imageExecution =
    value.imageExecution === undefined
      ? undefined
      : resolvePlexusImageExecutionPolicy(
          value.imageExecution,
          `extensions.${pharoNexusProjectExtensionConfigKey}.imageExecution`,
        );

  return {
    ...(plexusProjectConfig ? { plexusProjectConfig } : {}),
    ...(imageExecution ? { imageExecution } : {}),
  };
}

export function projectPlexusImageExecutionPolicy(
  config?: Pick<NexusProjectConfig, "extensions">,
): PlexusImageExecutionPolicy {
  if (!config) {
    return clonePlexusImageExecutionPolicy(defaultPlexusImageExecutionPolicy);
  }

  return (
    pharoNexusProjectExtensionConfig(config).imageExecution ??
    clonePlexusImageExecutionPolicy(defaultPlexusImageExecutionPolicy)
  );
}

export function resolvePlexusImageExecutionPolicy(
  value: unknown,
  pathName = "imageExecution",
): PlexusImageExecutionPolicy {
  const record = value === undefined ? {} : assertRecord(value, pathName);
  const dockerRecord =
    record.docker === undefined
      ? {}
      : assertRecord(record.docker, `${pathName}.docker`);
  const mode = imageExecutionMode(
    record.mode,
    `${pathName}.mode`,
    defaultPlexusImageExecutionPolicy.mode,
  );
  const docker = {
    image:
      nullableString(dockerRecord.image, `${pathName}.docker.image`) ??
      defaultPlexusImageExecutionPolicy.docker.image,
    network: dockerNetwork(
      dockerRecord.network,
      `${pathName}.docker.network`,
      defaultPlexusImageExecutionPolicy.docker.network,
    ),
    autoRemove:
      optionalBoolean(dockerRecord.autoRemove, `${pathName}.docker.autoRemove`) ??
      defaultPlexusImageExecutionPolicy.docker.autoRemove,
    mountProjectReadOnly:
      optionalBoolean(
        dockerRecord.mountProjectReadOnly,
        `${pathName}.docker.mountProjectReadOnly`,
      ) ?? defaultPlexusImageExecutionPolicy.docker.mountProjectReadOnly,
  };

  if (mode === "docker" && !docker.image) {
    throw new Error(`${pathName}.docker.image is required when mode is docker`);
  }

  return {
    mode,
    requireDisposableImage:
      optionalBoolean(
        record.requireDisposableImage,
        `${pathName}.requireDisposableImage`,
      ) ?? defaultPlexusImageExecutionPolicy.requireDisposableImage,
    requireCleanupPlan:
      optionalBoolean(record.requireCleanupPlan, `${pathName}.requireCleanupPlan`) ??
      defaultPlexusImageExecutionPolicy.requireCleanupPlan,
    docker,
  };
}

export function projectPlexusConfigPath(
  projectRootPath: string,
  config?: Pick<NexusProjectConfig, "extensions">,
): string {
  const extensionConfig = config
    ? pharoNexusProjectExtensionConfig(config)
    : {};
  return resolveFromProject(
    projectRootPath,
    extensionConfig.plexusProjectConfig ?? plexusProjectConfigFileName,
  );
}

function installDefaultAgentsFile(projectRoot: string): string {
  const agentsPath = projectAgentsPath(projectRoot);
  if (fs.existsSync(agentsPath)) {
    return agentsPath;
  }

  const templatePath = defaultAgentsTemplatePath();
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Default AGENTS.md template is missing: ${templatePath}`);
  }

  fs.copyFileSync(templatePath, agentsPath);
  return agentsPath;
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

function formatPromptValue(value: string | null | undefined): string {
  return value && value.trim().length > 0 ? value : "(not known yet)";
}

function buildSuggestedFirstPrompt(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  const sourceRoot = resolveProjectSourceRoot(projectRoot, projectConfig);
  const kanbanProjectId = projectConfig.kanban.projectId;
  const genericSkills = defaultCoreSkillPack
    .map((skill) => skill.manifest.id)
    .join(", ");
  const specializationSkills = pharoNexusSkillPack
    .map((skill) => skill.manifest.id)
    .join(", ");

  return [
    `This is a Codex and PharoNexus project for ${projectConfig.name}.`,
    "",
    "Use the local AGENTS.md as the workflow contract. Then make this local project yours:",
    "",
    `- Inspect the PharoNexus project root at ${projectRoot}.`,
    `- Inspect the source checkout at ${sourceRoot}.`,
    "- Check the matching Vibe Kanban board and current issues with the available PharoNexus and Vibe Kanban MCP tools.",
    "- Record durable local context in NOTES.md, including the Kanban board id and any source/workflow details future agents should know.",
    "- Edit AGENTS.md only when this project needs workflow guidance beyond the default PharoNexus contract.",
    `- Use installed support skills under ${path.join(projectRoot, ".dev-nexus", "skills")} when relevant; generic skills: ${genericSkills}; PharoNexus skills: ${specializationSkills}.`,
    "- When changes are complete and verified, commit them in the relevant source repository unless the user explicitly asks not to. Push only when requested or when project instructions say to publish.",
    "",
    "Known at prompt generation time:",
    "",
    `- PharoNexus project id: ${projectConfig.id}`,
    `- Kanban project id: ${formatPromptValue(kanbanProjectId)}`,
    `- Source remote: ${formatPromptValue(projectConfig.repo.remoteUrl)}`,
    `- Default branch: ${formatPromptValue(projectConfig.repo.defaultBranch)}`,
    "",
  ].join("\n");
}

function installSuggestedFirstPrompt(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): string {
  const suggestedFirstPromptPath = projectSuggestedFirstPromptPath(projectRoot);
  if (fs.existsSync(suggestedFirstPromptPath)) {
    return suggestedFirstPromptPath;
  }

  fs.writeFileSync(
    suggestedFirstPromptPath,
    buildSuggestedFirstPrompt(projectRoot, projectConfig),
    "utf8",
  );
  return suggestedFirstPromptPath;
}

export function buildPlexusProjectConfig(
  name: string,
  projectId: string,
  vibeKanbanProjectId: string | null = null,
  imageExecutionPolicy: PlexusImageExecutionPolicy =
    defaultPlexusImageExecutionPolicy,
): PlexusProjectConfig {
  return {
    name,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId ?? projectId,
    },
    images: [],
    imageExecution: clonePlexusImageExecutionPolicy(imageExecutionPolicy),
  };
}

export function updatePlexusProjectKanban(
  plexusConfigPath: string,
  projectName: string,
  projectId: string,
  vibeKanbanProjectId: string,
  imageExecutionPolicy: PlexusImageExecutionPolicy =
    defaultPlexusImageExecutionPolicy,
): PlexusProjectConfig {
  const existing = fs.existsSync(plexusConfigPath)
    ? readJsonFile<Record<string, unknown>>(plexusConfigPath)
    : buildPlexusProjectConfig(
        projectName,
        projectId,
        vibeKanbanProjectId,
        imageExecutionPolicy,
      );
  const existingKanban =
    existing.kanban && typeof existing.kanban === "object" && !Array.isArray(existing.kanban)
      ? (existing.kanban as Record<string, unknown>)
      : {};
  const updated = {
    ...existing,
    name: typeof existing.name === "string" ? existing.name : projectName,
    kanban: {
      ...existingKanban,
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId,
    },
    images: Array.isArray(existing.images) ? existing.images : [],
    imageExecution:
      existing.imageExecution === undefined
        ? clonePlexusImageExecutionPolicy(imageExecutionPolicy)
        : resolvePlexusImageExecutionPolicy(
            existing.imageExecution,
            "plexus.project.imageExecution",
          ),
  } as unknown as PlexusProjectConfig;

  saveJsonFile(plexusConfigPath, updated);
  return updated;
}

export function installPharoNexusProjectFiles(
  options: InstallPharoNexusProjectFilesOptions,
): PharoNexusProjectFiles {
  const plexusConfigPath = projectPlexusConfigPath(
    options.projectRoot,
    options.projectConfig,
  );
  const imageExecutionPolicy = projectPlexusImageExecutionPolicy(
    options.projectConfig,
  );
  const existingPlexusProjectConfig = fs.existsSync(plexusConfigPath)
    ? readJsonFile<Record<string, unknown>>(plexusConfigPath)
    : null;
  let plexusProjectConfig = existingPlexusProjectConfig
    ? ({
        ...existingPlexusProjectConfig,
        images: Array.isArray(existingPlexusProjectConfig.images)
          ? existingPlexusProjectConfig.images
          : [],
        imageExecution:
          existingPlexusProjectConfig.imageExecution === undefined
            ? clonePlexusImageExecutionPolicy(imageExecutionPolicy)
            : resolvePlexusImageExecutionPolicy(
                existingPlexusProjectConfig.imageExecution,
                "plexus.project.imageExecution",
              ),
      } as PlexusProjectConfig)
    : buildPlexusProjectConfig(
        options.projectConfig.name,
        options.projectConfig.id,
        options.vibeKanbanProjectId ?? options.projectConfig.kanban.projectId,
        imageExecutionPolicy,
      );

  if (!existingPlexusProjectConfig) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
  } else if (options.vibeKanbanProjectId) {
    plexusProjectConfig = updatePlexusProjectKanban(
      plexusConfigPath,
      options.projectConfig.name,
      options.projectConfig.id,
      options.vibeKanbanProjectId,
      imageExecutionPolicy,
    );
  } else if (existingPlexusProjectConfig.imageExecution === undefined) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
  }

  return {
    agentsPath: installDefaultAgentsFile(options.projectRoot),
    suggestedFirstPromptPath: installSuggestedFirstPrompt(
      options.projectRoot,
      options.projectConfig,
    ),
    plexusProjectConfigPath: plexusConfigPath,
    plexusProjectConfig,
  };
}

export const pharoNexusExtension: NexusExtension<
  NexusProjectConfig,
  PharoNexusProjectFiles,
  NexusProjectStatusExtensionContribution | undefined,
  NexusProjectTrackerLinkExtensionContribution | undefined
> = {
  id: "pharo-nexus",
  name: "PharoNexus",
  installProjectFiles: ({ projectRoot, projectConfig }) =>
    installPharoNexusProjectFiles({
      projectRoot,
      projectConfig,
      vibeKanbanProjectId: projectConfig.kanban.projectId,
    }),
  projectSkills: ({ projectConfig }) =>
    projectUsesPharoNexusExtension(projectConfig)
      ? [...pharoNexusSkillPack]
      : undefined,
  projectStatus: ({ projectRoot, projectConfig }) => {
    if (!projectUsesPharoNexusExtension(projectConfig)) {
      return undefined;
    }

    const plexusConfigPath = projectPlexusConfigPath(projectRoot, projectConfig);
    return {
      plexusProjectConfigPath: plexusConfigPath,
      plexusProjectConfigExists: fs.existsSync(plexusConfigPath),
    };
  },
  linkProjectTracker: ({ projectRoot, projectConfig, trackerProjectId }) => {
    if (!projectUsesPharoNexusExtension(projectConfig)) {
      return undefined;
    }

    const plexusConfigPath = projectPlexusConfigPath(projectRoot, projectConfig);
    return {
      plexusProjectConfigPath: plexusConfigPath,
      plexusProjectConfig: updatePlexusProjectKanban(
        plexusConfigPath,
        projectConfig.name,
        projectConfig.id,
        trackerProjectId,
        projectPlexusImageExecutionPolicy(projectConfig),
      ),
    };
  },
};

function clonePlexusImageExecutionPolicy(
  policy: PlexusImageExecutionPolicy,
): PlexusImageExecutionPolicy {
  return {
    mode: policy.mode,
    requireDisposableImage: policy.requireDisposableImage,
    requireCleanupPlan: policy.requireCleanupPlan,
    docker: { ...policy.docker },
  };
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function imageExecutionMode(
  value: unknown,
  pathName: string,
  fallback: PlexusImageExecutionMode,
): PlexusImageExecutionMode {
  if (value === undefined) {
    return fallback;
  }
  if (value === "disabled" || value === "docker") {
    return value;
  }

  throw new Error(`${pathName} must be disabled or docker`);
}

function dockerNetwork(
  value: unknown,
  pathName: string,
  fallback: PlexusImageExecutionDockerNetwork,
): PlexusImageExecutionDockerNetwork {
  if (value === undefined) {
    return fallback;
  }
  if (value === "none" || value === "bridge") {
    return value;
  }

  throw new Error(`${pathName} must be none or bridge`);
}

function optionalBoolean(value: unknown, pathName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`${pathName} must be a boolean`);
}

function nullableString(value: unknown, pathName: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`${pathName} must be a non-empty string or null`);
}

export function pharoNexusProjectFilesFromExtensionResult(
  value: unknown,
): PharoNexusProjectFiles {
  if (!value || typeof value !== "object") {
    throw new Error("PharoNexus extension did not produce project files");
  }

  return value as PharoNexusProjectFiles;
}
