export {
  devNexusHomeConfigFileName,
  devNexusProjectConfigFileName,
  nexusGeneratedDirectoryName,
  nexusLogsDirectoryName,
  nexusProjectWorktreesDirectoryName,
  NexusConfigError,
  projectConfigPath,
  projectWorktreesRootPath,
  resolveNexusAgentConfig,
  resolveNexusHome,
  validateNexusAgentConfig,
  validateProjectConfig,
} from "dev-nexus";

export type {
  NexusAgentConfig,
  NexusHomeConfigBase,
  NexusProjectConfig,
  NexusProjectExtensionsConfig,
  NexusProjectRepoConfig,
  NexusProjectRepoKind,
  NexusProjectReference,
  ResolveNexusAgentConfigOptions,
} from "dev-nexus";

export {
  controlProjectConfigPath,
  controlProjectRootPath,
  controlProjectWorktreesRootPath,
  createControlProjectConfig,
  devNexusPharoControlProjectDirectoryName,
  devNexusPharoControlProjectId,
  devNexusPharoControlProjectName,
  ensureControlProject,
  initControlProject,
} from "./controlProjectConfig.js";

export type {
  NexusControlProjectReference,
} from "./controlProjectConfig.js";

export {
  defaultNexusToolCommand,
  devNexusPharoCliEntrypointPath,
} from "./devNexusPharoCliEntrypoint.js";

export type {
  NexusToolCommand,
} from "./devNexusPharoCliEntrypoint.js";

export {
  createDefaultHomeConfig,
  defaultNexusHomePath,
  devNexusHomeConfigPath,
  initNexusHome,
  loadHomeConfig,
  saveHomeConfig,
  validateHomeConfig,
} from "./homeConfig.js";

export type {
  CreateDefaultHomeConfigOptions,
  InitNexusHomeOptions,
  InitNexusHomeResult,
  NexusHomeConfig,
} from "./homeConfig.js";

export {
  loadProjectConfig,
  loadProjectConfigIfExists,
  saveProjectConfig,
} from "./projectConfigFiles.js";
