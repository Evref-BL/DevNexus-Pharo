import fs from "node:fs";
import path from "node:path";
import {
  nexusProjectWorktreesDirectoryName,
  NexusConfigError,
  projectConfigPath,
  resolveNexusHome,
  samePath,
  type NexusProjectConfig,
  type NexusProjectReference,
} from "dev-nexus";
import {
  loadProjectConfig,
  saveProjectConfig,
} from "./projectConfigFiles.js";

export const devNexusPharoControlProjectDirectoryName = "DevNexus-Pharo";
export const devNexusPharoControlProjectId = "dev-nexus-pharo-control";
export const devNexusPharoControlProjectName = "DevNexus-Pharo";

const obsoleteControlProjectDirectoryName = "control";

export interface NexusControlProjectReference {
  id: string;
  name: string;
  root: string;
}

export function controlProjectRootPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    devNexusPharoControlProjectDirectoryName,
  );
}

function obsoleteControlProjectRootPath(homePath: string): string {
  return path.join(
    resolveNexusHome(homePath),
    obsoleteControlProjectDirectoryName,
  );
}

export function controlProjectConfigPath(homePath: string): string {
  return projectConfigPath(controlProjectRootPath(homePath));
}

export function controlProjectWorktreesRootPath(
  homePath: string,
  controlProject?: NexusControlProjectReference,
): string {
  return path.join(
    controlProject?.root ?? controlProjectRootPath(homePath),
    nexusProjectWorktreesDirectoryName,
  );
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexusConfigError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function requiredString(
  record: Record<string, unknown>,
  key: string,
  pathName: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new NexusConfigError(
      `${pathName}.${key} must be a non-empty string`,
    );
  }

  return value;
}

function defaultControlProjectReference(
  homePathForDefaults: string | undefined,
): NexusControlProjectReference {
  return {
    id: devNexusPharoControlProjectId,
    name: devNexusPharoControlProjectName,
    root: controlProjectRootPath(homePathForDefaults ?? "."),
  };
}

export function validateControlProjectReference(
  value: unknown,
  homePathForDefaults: string | undefined,
): NexusControlProjectReference {
  if (value === undefined) {
    return defaultControlProjectReference(homePathForDefaults);
  }

  const record = assertRecord(value, "controlProject");

  return {
    id: requiredString(record, "id", "controlProject"),
    name: requiredString(record, "name", "controlProject"),
    root: path.resolve(
      homePathForDefaults ?? ".",
      requiredString(record, "root", "controlProject"),
    ),
  };
}

export function createControlProjectConfig(
  controlProject?: NexusControlProjectReference,
): NexusProjectConfig {
  return {
    version: 1,
    id: controlProject?.id ?? devNexusPharoControlProjectId,
    name: controlProject?.name ?? devNexusPharoControlProjectName,
    home: null,
    repo: {
      kind: "local",
      remoteUrl: null,
      defaultBranch: null,
    },
    components: [
      {
        id: "primary",
        name: controlProject?.name ?? devNexusPharoControlProjectName,
        kind: "local",
        role: "primary",
        remoteUrl: null,
        defaultBranch: null,
        sourceRoot: ".",
        relationships: [],
      },
    ],
    worktreesRoot: nexusProjectWorktreesDirectoryName,
  };
}

export function initControlProject(
  homePath: string,
  controlProject?: NexusControlProjectReference,
): {
  projectPath: string;
  configPath: string;
  config: NexusProjectConfig;
} {
  const projectPath = path.resolve(
    controlProject?.root ?? controlProjectRootPath(homePath),
  );
  const config = createControlProjectConfig(controlProject);
  fs.mkdirSync(path.join(projectPath, nexusProjectWorktreesDirectoryName), {
    recursive: true,
  });
  const configPath = saveProjectConfig(projectPath, config);

  return {
    projectPath,
    configPath,
    config,
  };
}

export function ensureControlProject(
  homePath: string,
  controlProject?: NexusControlProjectReference,
): {
  projectPath: string;
  configPath: string;
  config: NexusProjectConfig;
} {
  const projectPath = path.resolve(
    controlProject?.root ?? controlProjectRootPath(homePath),
  );
  const configPath = projectConfigPath(projectPath);
  fs.mkdirSync(path.join(projectPath, nexusProjectWorktreesDirectoryName), {
    recursive: true,
  });

  if (fs.existsSync(configPath)) {
    return {
      projectPath,
      configPath,
      config: loadProjectConfig(projectPath),
    };
  }

  const config = createControlProjectConfig(controlProject);
  saveProjectConfig(projectPath, config);

  return {
    projectPath,
    configPath,
    config,
  };
}

function assertProjectsDoNotCollideWithControlProject(
  projects: NexusProjectReference[],
  controlProject: NexusControlProjectReference,
): void {
  for (const project of projects) {
    if (project.id === controlProject.id) {
      throw new NexusConfigError(
        `Project id is reserved for the control project: ${controlProject.id}`,
      );
    }
    if (samePath(project.projectRoot, controlProject.root)) {
      throw new NexusConfigError(
        `Project root is reserved for the control project: ${controlProject.root}`,
      );
    }
  }
}

function assertControlProjectDoesNotUseObsoleteRoot(
  controlProject: NexusControlProjectReference,
  homePathForDefaults: string | undefined,
): void {
  if (!homePathForDefaults || controlProject.id !== devNexusPharoControlProjectId) {
    return;
  }

  const obsoleteRoot = obsoleteControlProjectRootPath(homePathForDefaults);
  if (!samePath(controlProject.root, obsoleteRoot)) {
    return;
  }

  throw new NexusConfigError(
    `DevNexus-Pharo home config uses obsolete controlProject.root "${obsoleteRoot}". Regenerate the home through current DevNexus/DevNexus-Pharo setup; this version will not move or rewrite that root.`,
  );
}

export function assertControlProjectHomeReferences(
  projects: NexusProjectReference[],
  controlProject: NexusControlProjectReference,
  homePathForDefaults: string | undefined,
): void {
  assertControlProjectDoesNotUseObsoleteRoot(
    controlProject,
    homePathForDefaults,
  );
  assertProjectsDoNotCollideWithControlProject(projects, controlProject);
}
