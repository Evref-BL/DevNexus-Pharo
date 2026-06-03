import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  type NexusProjectConfig,
} from "./config.js";
import {
  buildPlexusPharoImageProfile,
  defaultPlexusPharoImageCreateProfileId,
  defaultPlexusPharoImageLoadScript,
  defaultPlexusPharoImageProfileId,
  defaultPlexusPharoImageTemplateCategory,
  defaultPlexusPharoImageTemplateName,
  type PlexusProjectConfig,
  type PlexusRepositoryWorkspaceConfig,
} from "./plexusProjectConfig.js";

export interface InferPlexusRepositoryWorkspaceProjectionOptions {
  projectConfig: NexusProjectConfig;
  workspaceSourcePath: string;
  componentId: string;
  branchName?: string;
  originPath?: string;
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
  const branchName = options.branchName ?? gitCurrentBranch(sourcePath);

  return {
    repository: {
      id: options.componentId,
      componentId: options.componentId,
      ...(remoteUrl ? { remoteUrl } : {}),
      ...(options.originPath ? { originPath: options.originPath } : {}),
    },
    sourceDirectory: defaultPharoSourceDirectory,
    baseline,
    ...(branchName ? { branch: branchName } : {}),
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
  return applyPlexusRepositoryWorkspaceProjections(
    config,
    repositoryWorkspace ? [repositoryWorkspace] : [],
  );
}

export function applyPlexusRepositoryWorkspaceProjections(
  config: PlexusProjectConfig,
  repositoryWorkspaces: readonly PlexusRepositoryWorkspaceConfig[] | undefined,
): PlexusProjectConfig {
  const projectedRepositoryWorkspaces = repositoryWorkspaces ?? [];
  if (projectedRepositoryWorkspaces.length === 0) {
    return config;
  }

  if (config.images.length === 0) {
    return {
      ...config,
      images: [
        buildPlexusPharoImageProfile(config.id, {
          repositoryWorkspaces: projectedRepositoryWorkspaces,
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
    imageRepositoryWorkspaces(targetImage).length > 0 &&
    !canRefreshProjectedRepositoryWorkspaces(
      targetImage,
      projectedRepositoryWorkspaces,
    )
  ) {
    return config;
  }

  const {
    repositoryWorkspace: _existingRepositoryWorkspace,
    repositoryWorkspaces: _existingRepositoryWorkspaces,
    ...targetImageWithoutRepositoryWorkspaces
  } = targetImage;
  const images = [...config.images];
  images[targetIndex] = {
    ...targetImageWithoutRepositoryWorkspaces,
    ...defaultGeneratedImageProfileFields(targetImageWithoutRepositoryWorkspaces),
    ...repositoryWorkspaceImageFields(projectedRepositoryWorkspaces),
  };
  return {
    ...config,
    images,
  };
}

function defaultGeneratedImageProfileFields(
  image: Record<string, unknown>,
): Record<string, unknown> {
  if (image.id !== defaultPlexusPharoImageProfileId) {
    return {};
  }
  const fields: Record<string, unknown> = {};
  if (
    !isRecord(image.mcp) ||
    typeof image.mcp.loadScript !== "string" ||
    image.mcp.loadScript.trim().length === 0
  ) {
    fields.mcp = {
      ...(isRecord(image.mcp) ? image.mcp : {}),
      loadScript: defaultPlexusPharoImageLoadScript,
    };
  }

  if (!defaultGeneratedImageCreateIsCurrent(image.create)) {
    fields.create = defaultGeneratedImageCreate(image.create);
  }

  return fields;
}

function defaultGeneratedImageCreateIsCurrent(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.kind === "template" &&
    value.profileId === defaultPlexusPharoImageCreateProfileId &&
    value.templateName === defaultPlexusPharoImageTemplateName &&
    value.templateCategory === defaultPlexusPharoImageTemplateCategory
  );
}

function defaultGeneratedImageCreate(
  value: unknown,
): Record<string, unknown> {
  const record = isRecord(value) ? value : {};
  const {
    kind: _kind,
    profileId: _profileId,
    templateName: _templateName,
    templateCategory: _templateCategory,
    ...rest
  } = record;
  return {
    ...rest,
    kind: "template",
    profileId: defaultPlexusPharoImageCreateProfileId,
    templateName: defaultPlexusPharoImageTemplateName,
    ...(defaultPlexusPharoImageTemplateCategory
      ? { templateCategory: defaultPlexusPharoImageTemplateCategory }
      : {}),
  };
}

function repositoryWorkspaceImageFields(
  repositoryWorkspaces: readonly PlexusRepositoryWorkspaceConfig[],
): Record<string, unknown> {
  if (repositoryWorkspaces.length === 1) {
    return { repositoryWorkspace: repositoryWorkspaces[0] };
  }

  return { repositoryWorkspaces: [...repositoryWorkspaces] };
}

function canRefreshProjectedRepositoryWorkspaces(
  image: Record<string, unknown>,
  repositoryWorkspaces: readonly PlexusRepositoryWorkspaceConfig[],
): boolean {
  if (image.id !== defaultPlexusPharoImageProfileId) {
    return false;
  }
  const existingWorkspaces = imageRepositoryWorkspaces(image);
  if (existingWorkspaces.length === 0) {
    return false;
  }
  const projectedComponentIds = new Set(
    repositoryWorkspaces
      .map((workspace) => workspace.repository.componentId)
      .filter((componentId): componentId is string => componentId !== undefined),
  );

  return existingWorkspaces.every((existingWorkspace) => {
    if (!isRecord(existingWorkspace.repository)) {
      return false;
    }
    const originPath = existingWorkspace.repository.originPath;
    return (
      (originPath === undefined ||
        (typeof originPath === "string" && !isAbsolutePathLike(originPath))) &&
      typeof existingWorkspace.repository.componentId === "string" &&
      projectedComponentIds.has(existingWorkspace.repository.componentId)
    );
  });
}

function isAbsolutePathLike(value: string): boolean {
  return (
    path.isAbsolute(value) ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    value.startsWith("\\")
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

function imageRepositoryWorkspaces(
  image: Record<string, unknown>,
): Array<Record<string, unknown>> {
  if (Array.isArray(image.repositoryWorkspaces)) {
    return image.repositoryWorkspaces.filter(isRecord);
  }
  return isRecord(image.repositoryWorkspace) ? [image.repositoryWorkspace] : [];
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

function gitCurrentBranch(sourcePath: string): string | undefined {
  if (!fs.existsSync(path.join(sourcePath, ".git"))) {
    return undefined;
  }

  const branch = gitOutput(sourcePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return branch && branch !== "HEAD" ? branch : undefined;
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
