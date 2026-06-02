import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type NexusProjectConfig,
} from "./config.js";
import {
  buildPlexusPharoImageProfile,
  defaultPlexusPharoImageProfileId,
  type PlexusProjectConfig,
  type PlexusRepositoryWorkspaceConfig,
} from "./plexusProjectConfig.js";

export interface InferPlexusRepositoryWorkspaceProjectionOptions {
  projectConfig: NexusProjectConfig;
  workspaceSourcePath: string;
  componentId: string;
  branchName?: string;
}

const defaultPharoSourceDirectory = "src";

export function inferPlexusRepositoryWorkspaceProjection(
  options: InferPlexusRepositoryWorkspaceProjectionOptions,
): PlexusRepositoryWorkspaceConfig | undefined {
  const sourcePath = path.resolve(options.workspaceSourcePath);
  const baseline = inferBaselineName(sourcePath, defaultPharoSourceDirectory);
  if (!baseline) {
    return undefined;
  }

  const component = projectComponent(options.projectConfig, options.componentId);
  const baseBranch =
    recordString(component, "defaultBranch") ??
    options.projectConfig.repo?.defaultBranch;
  const baseCommit = baseBranch
    ? gitMergeBase(sourcePath, baseBranch)
    : undefined;
  const remoteUrl =
    recordString(component, "remoteUrl") ??
    (options.componentId === options.projectConfig.id
      ? options.projectConfig.repo?.remoteUrl ?? undefined
      : undefined);

  return {
    repository: {
      id: options.componentId,
      componentId: options.componentId,
      ...(remoteUrl ? { remoteUrl } : {}),
    },
    sourceDirectory: defaultPharoSourceDirectory,
    baseline,
    ...(options.branchName ? { branch: options.branchName } : {}),
    ...(baseBranch ? { baseBranch } : {}),
    ...(baseCommit ? { baseCommit } : {}),
    materialization: {
      strategy: "copy",
    },
  };
}

export function applyPlexusRepositoryWorkspaceProjection(
  config: PlexusProjectConfig,
  repositoryWorkspace: PlexusRepositoryWorkspaceConfig | undefined,
): PlexusProjectConfig {
  if (!repositoryWorkspace) {
    return config;
  }

  if (config.images.length === 0) {
    return {
      ...config,
      images: [
        buildPlexusPharoImageProfile(config.id, {
          repositoryWorkspace,
        }),
      ],
    };
  }

  const targetIndex = projectionTargetImageIndex(config.images);
  if (targetIndex === -1) {
    return config;
  }

  const targetImage = config.images[targetIndex];
  if (!isRecord(targetImage)) {
    return config;
  }
  if (
    targetImage.repositoryWorkspace !== undefined &&
    !canRefreshProjectedRepositoryWorkspace(targetImage, repositoryWorkspace)
  ) {
    return config;
  }

  const images = [...config.images];
  images[targetIndex] = {
    ...targetImage,
    repositoryWorkspace,
  };
  return {
    ...config,
    images,
  };
}

function canRefreshProjectedRepositoryWorkspace(
  image: Record<string, unknown>,
  repositoryWorkspace: PlexusRepositoryWorkspaceConfig,
): boolean {
  if (image.id !== defaultPlexusPharoImageProfileId) {
    return false;
  }
  const existingWorkspace = image.repositoryWorkspace;
  if (!isRecord(existingWorkspace) || !isRecord(existingWorkspace.repository)) {
    return false;
  }

  return (
    existingWorkspace.repository.originPath === undefined &&
    existingWorkspace.repository.componentId ===
      repositoryWorkspace.repository.componentId
  );
}

function projectionTargetImageIndex(images: unknown[]): number {
  const defaultImageIndex = images.findIndex(
    (image) =>
      isRecord(image) &&
      image.id === defaultPlexusPharoImageProfileId,
  );
  if (defaultImageIndex !== -1) {
    return defaultImageIndex;
  }
  return images.length === 1 ? 0 : -1;
}

function inferBaselineName(
  sourcePath: string,
  sourceDirectory: string,
): string | undefined {
  const sourceDirectoryPath = path.join(sourcePath, sourceDirectory);
  if (!fs.existsSync(sourceDirectoryPath)) {
    return undefined;
  }

  const baselines = new Set<string>();
  for (const entry of fs.readdirSync(sourceDirectoryPath, { withFileTypes: true })) {
    if (entry.isFile()) {
      addBaselineFromFileName(baselines, entry.name);
      continue;
    }

    if (!entry.isDirectory()) {
      continue;
    }

    const packagePath = path.join(sourceDirectoryPath, entry.name);
    const baselineFileName = `${entry.name}.class.st`;
    if (fs.existsSync(path.join(packagePath, baselineFileName))) {
      addBaselineFromFileName(baselines, baselineFileName);
    }
  }

  return baselines.size === 1 ? [...baselines][0] : undefined;
}

function addBaselineFromFileName(baselines: Set<string>, fileName: string): void {
  const match = /^BaselineOf(.+)\.class\.st$/u.exec(fileName);
  if (match?.[1]) {
    baselines.add(match[1]);
  }
}

function gitMergeBase(sourcePath: string, baseBranch: string): string | undefined {
  if (!fs.existsSync(path.join(sourcePath, ".git"))) {
    return undefined;
  }

  for (const candidate of [`origin/${baseBranch}`, baseBranch]) {
    const commit = gitOutput(sourcePath, ["merge-base", "HEAD", candidate]);
    if (commit) {
      return commit;
    }
  }

  return undefined;
}

function gitOutput(sourcePath: string, args: string[]): string | undefined {
  try {
    const output = childProcess.execFileSync("git", ["-C", sourcePath, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function projectComponent(
  projectConfig: NexusProjectConfig,
  componentId: string,
): Record<string, unknown> | undefined {
  const components = (projectConfig as { components?: unknown }).components;
  if (!Array.isArray(components)) {
    return undefined;
  }

  return components.find(
    (component): component is Record<string, unknown> =>
      isRecord(component) && component.id === componentId,
  );
}

function recordString(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
