import fs from "node:fs";
import type {
  NexusExtension,
  NexusProjectScaffoldContext,
} from "./nexusExtension.js";

export interface ScaffoldNexusProjectOptions<ProjectConfig = unknown> {
  homePath: string;
  projectRoot: string;
  worktreesRoot: string;
  projectConfig: ProjectConfig;
  extensions?: NexusExtension<ProjectConfig>[];
}

export interface ScaffoldNexusProjectResult {
  projectRoot: string;
  worktreesRoot: string;
  extensionResults: Record<string, unknown>;
}

export function scaffoldNexusProject<ProjectConfig>(
  options: ScaffoldNexusProjectOptions<ProjectConfig>,
): ScaffoldNexusProjectResult {
  fs.mkdirSync(options.worktreesRoot, { recursive: true });

  const context: NexusProjectScaffoldContext<ProjectConfig> = {
    homePath: options.homePath,
    projectRoot: options.projectRoot,
    worktreesRoot: options.worktreesRoot,
    projectConfig: options.projectConfig,
  };
  const extensionResults: Record<string, unknown> = {};

  for (const extension of options.extensions ?? []) {
    if (!extension.installProjectFiles) {
      continue;
    }

    extensionResults[extension.id] = extension.installProjectFiles(context);
  }

  return {
    projectRoot: options.projectRoot,
    worktreesRoot: options.worktreesRoot,
    extensionResults,
  };
}
