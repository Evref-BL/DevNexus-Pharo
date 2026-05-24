import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defaultCoreSkillPack,
  type NexusProjectConfig,
} from "dev-nexus";
import { devNexusPharoSkillPack } from "./devNexusPharoSkillPack.js";
import {
  buildPlexusProjectConfig,
  normalizePlexusProjectConfig,
  projectPlexusConfigPath,
  projectPlexusImageExecutionPolicy,
  type PlexusProjectConfig,
} from "./plexusProjectConfig.js";

export interface DevNexusPharoProjectFiles {
  agentsPath: string;
  suggestedFirstPromptPath: string;
  plexusProjectConfigPath: string;
  plexusProjectConfig: PlexusProjectConfig;
}

export interface InstallDevNexusPharoProjectFilesOptions {
  projectRoot: string;
  projectConfig: NexusProjectConfig;
  reservedGatewayPorts?: readonly number[];
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
  const genericSkills = defaultCoreSkillPack
    .map((skill) => skill.manifest.id)
    .join(", ");
  const specializationSkills = devNexusPharoSkillPack
    .map((skill) => skill.manifest.id)
    .join(", ");

  return [
    `This is a Codex and DevNexus-Pharo project for ${projectConfig.name}.`,
    "",
    "Use the local AGENTS.md as the workflow contract. Then make this local project yours:",
    "",
    `- Inspect the DevNexus-Pharo project root at ${projectRoot}.`,
    `- Inspect the source checkout at ${sourceRoot}.`,
    "- Check the configured work tracker and current issues with the available DevNexus-Pharo tools.",
    "- Record durable local context in NOTES.md, including tracker ids and any source/workflow details future agents should know.",
    "- Edit AGENTS.md only when this project needs workflow guidance beyond the default DevNexus-Pharo contract.",
    `- Use installed support skills under ${path.join(projectRoot, ".dev-nexus", "skills")} when relevant; generic skills: ${genericSkills}; DevNexus-Pharo skills: ${specializationSkills}.`,
    "- When changes are complete and verified, commit them in the relevant source repository unless the user explicitly asks not to. Push only when requested or when project instructions say to publish.",
    "",
    "Known at prompt generation time:",
    "",
    `- DevNexus-Pharo project id: ${projectConfig.id}`,
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

export function installDevNexusPharoProjectFiles(
  options: InstallDevNexusPharoProjectFilesOptions,
): DevNexusPharoProjectFiles {
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
      ? normalizePlexusProjectConfig(
          existingPlexusProjectConfig,
          options.projectConfig.name,
          options.projectConfig.id,
          imageExecutionPolicy,
          options.reservedGatewayPorts ?? [],
        )
    : buildPlexusProjectConfig(
        options.projectConfig.name,
        options.projectConfig.id,
        imageExecutionPolicy,
        options.reservedGatewayPorts ?? [],
      );

  if (!existingPlexusProjectConfig) {
    saveJsonFile(plexusConfigPath, plexusProjectConfig);
  } else if (
    existingPlexusProjectConfig.imageExecution === undefined ||
    existingPlexusProjectConfig.runtime === undefined
  ) {
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

export function devNexusPharoProjectFilesFromExtensionResult(
  value: unknown,
): DevNexusPharoProjectFiles {
  if (!value || typeof value !== "object") {
    throw new Error("DevNexus-Pharo extension did not produce project files");
  }

  return value as DevNexusPharoProjectFiles;
}
