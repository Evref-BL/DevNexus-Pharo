import fs from "node:fs";
import {
  type NexusExtension,
} from "dev-nexus";
import {
  type NexusProjectConfig,
} from "./config.js";
import type {
  NexusProjectStatusExtensionContribution,
} from "./nexusProjectService.js";
import { devNexusPharoSkillPack } from "./devNexusPharoSkillPack.js";
import {
  installDevNexusPharoProjectFiles,
  type DevNexusPharoProjectFiles,
} from "./devNexusPharoProjectFiles.js";
import {
  projectPlexusConfigPath,
  projectUsesDevNexusPharoExtension,
} from "./plexusProjectConfig.js";

export { devNexusPharoSkillPack } from "./devNexusPharoSkillPack.js";
export {
  defaultPlexusImageExecutionPolicy,
  resolvePlexusImageExecutionPolicy,
  type PlexusImageExecutionDockerNetwork,
  type PlexusImageExecutionDockerPolicy,
  type PlexusImageExecutionMode,
  type PlexusImageExecutionPolicy,
} from "./plexusImageExecutionPolicy.js";
export * from "./devNexusPharoProjectFiles.js";
export * from "./plexusProjectConfig.js";

export const devNexusPharoExtension: NexusExtension<
  NexusProjectConfig,
  DevNexusPharoProjectFiles,
  NexusProjectStatusExtensionContribution | undefined
> = {
  id: "dev-nexus-pharo",
  name: "DevNexus-Pharo",
  installProjectFiles: ({ projectRoot, projectConfig }) => {
    return installDevNexusPharoProjectFiles({
      projectRoot,
      projectConfig,
    });
  },
  projectSkills: ({ projectConfig }) =>
    projectUsesDevNexusPharoExtension(projectConfig)
      ? [...devNexusPharoSkillPack]
      : undefined,
  projectStatus: ({ projectRoot, projectConfig }) => {
    if (!projectUsesDevNexusPharoExtension(projectConfig)) {
      return undefined;
    }

    const plexusConfigPath = projectPlexusConfigPath(projectRoot, projectConfig);
    return {
      plexusProjectConfigPath: plexusConfigPath,
      plexusProjectConfigExists: fs.existsSync(plexusConfigPath),
    };
  },
};
