import {
  inspectNexusProjectSkills,
  refreshNexusProjectSkills,
  type InspectNexusProjectSkillsResult as DevNexusInspectProjectSkillsResult,
  type NexusSkillDefinition,
  type RefreshNexusProjectSkillsResult as DevNexusRefreshProjectSkillsResult,
} from "dev-nexus";
import {
  loadProjectConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  getNexusProjectStatus,
  registeredNexusProjectExtensions,
  type GetNexusProjectStatusOptions,
  type NexusProjectStatus,
} from "./nexusProjectService.js";

export interface ProjectSkillStatusOptions extends GetNexusProjectStatusOptions {}

export interface ProjectSkillRefreshOptions extends GetNexusProjectStatusOptions {}

export interface ProjectSkillStatusResult {
  homePath: string;
  project: NexusProjectStatus;
  skillStatus: DevNexusInspectProjectSkillsResult;
}

export interface ProjectSkillRefreshResult {
  homePath: string;
  project: NexusProjectStatus;
  refresh: DevNexusRefreshProjectSkillsResult;
}

function extensionSkillDefinitions(
  homePath: string,
  projectRoot: string,
  worktreesRoot: string,
  projectConfig: NexusProjectConfig,
): NexusSkillDefinition[] {
  const skillDefinitions: NexusSkillDefinition[] = [];
  for (const extension of registeredNexusProjectExtensions()) {
    const skills = extension.projectSkills?.({
      homePath,
      projectRoot,
      worktreesRoot,
      projectConfig,
    });
    if (skills) {
      skillDefinitions.push(...skills);
    }
  }

  return skillDefinitions;
}

function resolveProjectSkillsContext(options: GetNexusProjectStatusOptions): {
  homePath: string;
  project: NexusProjectStatus;
  projectConfig: NexusProjectConfig;
  skillDefinitions: NexusSkillDefinition[];
} {
  const status = getNexusProjectStatus(options);
  const projectConfig = loadProjectConfig(status.project.projectRoot);

  return {
    homePath: status.homePath,
    project: status.project,
    projectConfig,
    skillDefinitions: extensionSkillDefinitions(
      status.homePath,
      status.project.projectRoot,
      status.project.worktreesRoot,
      projectConfig,
    ),
  };
}

export function getProjectSkillStatus(
  options: ProjectSkillStatusOptions,
): ProjectSkillStatusResult {
  const context = resolveProjectSkillsContext(options);
  return {
    homePath: context.homePath,
    project: context.project,
    skillStatus: inspectNexusProjectSkills({
      projectRoot: context.project.projectRoot,
      skillsConfig: context.projectConfig.skills,
      skillDefinitions: context.skillDefinitions,
    }),
  };
}

export function refreshProjectSkills(
  options: ProjectSkillRefreshOptions,
): ProjectSkillRefreshResult {
  const context = resolveProjectSkillsContext(options);
  return {
    homePath: context.homePath,
    project: context.project,
    refresh: refreshNexusProjectSkills({
      projectRoot: context.project.projectRoot,
      skillsConfig: context.projectConfig.skills,
      skillDefinitions: context.skillDefinitions,
    }),
  };
}
