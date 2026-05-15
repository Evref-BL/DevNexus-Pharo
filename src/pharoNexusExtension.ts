import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NexusExtension } from "./nexusExtension.js";
import {
  type NexusProjectConfig,
} from "./config.js";

export interface PlexusProjectConfig {
  name: string;
  kanban: {
    provider: "vibe-kanban";
    projectId: string;
  };
  images: unknown[];
}

export interface PharoNexusProjectFiles {
  agentsPath: string;
  suggestedFirstPromptPath: string;
  plexusProjectConfigPath: string;
  plexusProjectConfig: PlexusProjectConfig;
}

export const plexusProjectConfigFileName = "plexus.project.json";
export const pharoNexusProjectExtensionConfigKey = "pharo-nexus";

export interface PharoNexusProjectExtensionConfig {
  plexusProjectConfig?: string;
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

  return {
    ...(plexusProjectConfig ? { plexusProjectConfig } : {}),
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
): PlexusProjectConfig {
  return {
    name,
    kanban: {
      provider: "vibe-kanban",
      projectId: vibeKanbanProjectId ?? projectId,
    },
    images: [],
  };
}

export function updatePlexusProjectKanban(
  plexusConfigPath: string,
  projectName: string,
  projectId: string,
  vibeKanbanProjectId: string,
): PlexusProjectConfig {
  const existing = fs.existsSync(plexusConfigPath)
    ? readJsonFile<Record<string, unknown>>(plexusConfigPath)
    : buildPlexusProjectConfig(projectName, projectId, vibeKanbanProjectId);
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
  let plexusProjectConfig = fs.existsSync(plexusConfigPath)
    ? readJsonFile<PlexusProjectConfig>(plexusConfigPath)
    : buildPlexusProjectConfig(
        options.projectConfig.name,
        options.projectConfig.id,
        options.vibeKanbanProjectId ?? options.projectConfig.kanban.projectId,
      );

  if (!fs.existsSync(plexusConfigPath)) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
  } else if (options.vibeKanbanProjectId) {
    plexusProjectConfig = updatePlexusProjectKanban(
      plexusConfigPath,
      options.projectConfig.name,
      options.projectConfig.id,
      options.vibeKanbanProjectId,
    );
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
  PharoNexusProjectFiles
> = {
  id: "pharo-nexus",
  name: "PharoNexus",
  installProjectFiles: ({ projectRoot, projectConfig }) =>
    installPharoNexusProjectFiles({
      projectRoot,
      projectConfig,
      vibeKanbanProjectId: projectConfig.kanban.projectId,
    }),
};

export function pharoNexusProjectFilesFromExtensionResult(
  value: unknown,
): PharoNexusProjectFiles {
  if (!value || typeof value !== "object") {
    throw new Error("PharoNexus extension did not produce project files");
  }

  return value as PharoNexusProjectFiles;
}
