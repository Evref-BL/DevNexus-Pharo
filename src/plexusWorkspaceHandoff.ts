export type PlexusWorkspaceHandoffCleanupRecommendation =
  | "close"
  | "archive"
  | "preserve"
  | "rescue";

export interface PlexusWorkspaceHandoffAction {
  kind: string;
  message: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
}

export interface PlexusWorkspaceHandoffImageSummary {
  imageId: string;
  imageName?: string;
  status?: string;
  pid?: number;
  port?: number;
  mcpEndpoint?: unknown;
  recoveryActions: PlexusWorkspaceHandoffAction[];
}

export interface PlexusWorkspaceHandoffRepositorySummary {
  imageId?: string;
  imageName?: string;
  repositoryId?: string;
  path?: string;
  branch?: string;
  dirtyState?: string;
  loadState?: string;
  loadError?: string;
  materializationState?: string;
  cleanupState?: unknown;
  recommendedCleanup: "none" | "archive" | "preserve" | "repair";
}

export interface PlexusWorkspaceHandoffSummary {
  projectId?: string;
  workspaceId?: string;
  targetId?: string;
  projectRoot?: string;
  sourcePath?: string;
  stateRoot?: string;
  statePath?: string;
  runtime?: {
    status?: string;
    health?: string;
    reason?: string;
  };
  images: PlexusWorkspaceHandoffImageSummary[];
  repositories: PlexusWorkspaceHandoffRepositorySummary[];
  multiImage: boolean;
  cleanup: {
    recommendation: PlexusWorkspaceHandoffCleanupRecommendation;
    reason: string;
  };
  risks: string[];
  guidance: string[];
  actions: PlexusWorkspaceHandoffAction[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function record(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function statusData(value: unknown): JsonRecord {
  const root = record(value) ?? {};
  return record(root.data) ?? root;
}

function nestedRecord(root: JsonRecord, ...keys: string[]): JsonRecord | undefined {
  let current: JsonRecord | undefined = root;
  for (const key of keys) {
    current = record(current?.[key]);
    if (!current) {
      return undefined;
    }
  }

  return current;
}

function scopeValue(data: JsonRecord, key: string): string | undefined {
  const diagnosticsScope = nestedRecord(data, "diagnostics", "scope");
  return stringValue(diagnosticsScope?.[key]) ?? stringValue(data[key]);
}

function sourcePathFromStatus(data: JsonRecord): string | undefined {
  return (
    scopeValue(data, "sourcePath") ??
    stringValue(nestedRecord(data, "context", "workspace", "source")?.path)
  );
}

function runtimeSummary(data: JsonRecord): PlexusWorkspaceHandoffSummary["runtime"] {
  const runtime = nestedRecord(data, "diagnostics", "runtime");
  if (!runtime) {
    return undefined;
  }

  return {
    status: stringValue(runtime.status),
    health: stringValue(runtime.health),
    reason: stringValue(runtime.reason),
  };
}

function recoveryActions(
  recovery: JsonRecord | undefined,
): PlexusWorkspaceHandoffAction[] {
  return arrayValue(recovery?.actions)
    .map((action) => record(action))
    .filter((action): action is JsonRecord => Boolean(action))
    .map((action) => ({
      kind: "rescue_image",
      message: "Plan or prepare a scoped replacement image before cleanup.",
      toolName: stringValue(action.toolName),
      arguments: record(action.arguments),
    }));
}

function collectImages(data: JsonRecord): PlexusWorkspaceHandoffImageSummary[] {
  const diagnostics = record(data.diagnostics);
  const images = new Map<string, PlexusWorkspaceHandoffImageSummary>();
  const recoveries = new Map(
    arrayValue(diagnostics?.imageRecovery)
      .map((item) => record(item))
      .filter((item): item is JsonRecord => Boolean(item))
      .map((item) => [stringValue(item.imageId) ?? "", item] as const)
      .filter(([imageId]) => imageId.length > 0),
  );

  for (const image of arrayValue(record(data.state)?.images)) {
    const imageRecord = record(image);
    const imageId = stringValue(imageRecord?.id);
    if (!imageId) {
      continue;
    }
    const recovery = recoveries.get(imageId);
    images.set(imageId, {
      imageId,
      imageName: stringValue(imageRecord?.imageName),
      status: stringValue(imageRecord?.status),
      pid: numberValue(imageRecord?.pid),
      mcpEndpoint: imageRecord?.mcpEndpoint,
      recoveryActions: recoveryActions(recovery),
    });
  }

  for (const port of arrayValue(diagnostics?.imageMcpPorts)) {
    const portRecord = record(port);
    const imageId = stringValue(portRecord?.imageId);
    if (!imageId) {
      continue;
    }
    const existing = images.get(imageId);
    const recovery = recoveries.get(imageId);
    images.set(imageId, {
      imageId,
      imageName: existing?.imageName ?? stringValue(portRecord?.imageName),
      status: existing?.status ?? stringValue(portRecord?.status),
      pid: existing?.pid,
      port: numberValue(portRecord?.port),
      mcpEndpoint: existing?.mcpEndpoint ?? portRecord?.mcpEndpoint,
      recoveryActions: existing?.recoveryActions ?? recoveryActions(recovery),
    });
  }

  for (const [imageId, recovery] of recoveries) {
    if (images.has(imageId)) {
      continue;
    }
    images.set(imageId, {
      imageId,
      imageName: stringValue(recovery.imageName),
      status: stringValue(recovery.status),
      recoveryActions: recoveryActions(recovery),
    });
  }

  return [...images.values()];
}

function recommendedRepositoryCleanup(workspace: JsonRecord): PlexusWorkspaceHandoffRepositorySummary["recommendedCleanup"] {
  const dirtyState = stringValue(workspace.dirtyState);
  const loadState = stringValue(workspace.loadState);
  const materializationState = stringValue(workspace.materializationState);
  if (materializationState === "failed" || loadState === "failed") {
    return "repair";
  }
  if (dirtyState === "dirty") {
    return "archive";
  }
  if (dirtyState === "unknown") {
    return "preserve";
  }

  return "none";
}

function collectRepositories(data: JsonRecord): PlexusWorkspaceHandoffRepositorySummary[] {
  const diagnostics = record(data.diagnostics);
  return arrayValue(diagnostics?.repositoryWorkspaces)
    .map((item) => record(item))
    .filter((item): item is JsonRecord => Boolean(item))
    .map((item) => {
      const workspace = record(item.workspace) ?? {};
      const repository = record(workspace.repository) ?? {};
      return {
        imageId: stringValue(item.imageId),
        imageName: stringValue(item.imageName),
        repositoryId: stringValue(repository.id),
        path: stringValue(workspace.path),
        branch: stringValue(workspace.branch),
        dirtyState: stringValue(workspace.dirtyState),
        loadState: stringValue(workspace.loadState),
        loadError: stringValue(workspace.loadError),
        materializationState: stringValue(workspace.materializationState),
        cleanupState: workspace.cleanupState,
        recommendedCleanup: recommendedRepositoryCleanup(workspace),
      };
    });
}

function closeAction(
  data: JsonRecord,
  policy?: "archive" | "preserve",
): PlexusWorkspaceHandoffAction {
  const args: JsonRecord = {};
  const projectRoot = scopeValue(data, "projectRoot");
  const stateRoot = scopeValue(data, "stateRoot");
  const workspaceId = scopeValue(data, "workspaceId");
  if (projectRoot) {
    args.projectPath = projectRoot;
  }
  if (stateRoot) {
    args.stateRoot = stateRoot;
  }
  if (workspaceId) {
    args.workspaceId = workspaceId;
  }
  if (policy) {
    args.repositoryWorkspaceCleanupPolicy = policy;
  }

  return {
    kind: "close_workspace",
    message: policy
      ? `Close the PLexus workspace with ${policy} repository-workspace cleanup.`
      : "Close the PLexus workspace after handoff.",
    toolName: "plexus_project_close",
    arguments: args,
  };
}

export function summarizePlexusWorkspaceHandoff(
  plexusStatus: unknown,
): PlexusWorkspaceHandoffSummary {
  const data = statusData(plexusStatus);
  const images = collectImages(data);
  const repositories = collectRepositories(data);
  const failedImages = images.filter((image) => image.status === "failed");
  const dirtyRepositories = repositories.filter(
    (repository) => repository.recommendedCleanup === "archive",
  );
  const repairRepositories = repositories.filter(
    (repository) => repository.recommendedCleanup === "repair",
  );
  const unknownRepositories = repositories.filter(
    (repository) => repository.recommendedCleanup === "preserve",
  );
  const risks: string[] = [];
  const guidance: string[] = [];
  const actions: PlexusWorkspaceHandoffAction[] = [];

  if (images.length > 1) {
    guidance.push(
      `Record every scoped imageId before handoff: ${
        images.map((image) => image.imageId).join(", ")
      }.`,
    );
  }
  if (dirtyRepositories.length > 0) {
    risks.push(
      `Dirty image-local repository workspace(s): ${
        dirtyRepositories
          .map((repository) => repository.repositoryId ?? repository.path ?? "unknown")
          .join(", ")
      }.`,
    );
  }
  if (repairRepositories.length > 0) {
    risks.push(
      `Repository workspace(s) need repair before cleanup: ${
        repairRepositories
          .map((repository) => repository.repositoryId ?? repository.path ?? "unknown")
          .join(", ")
      }.`,
    );
  }
  if (unknownRepositories.length > 0) {
    risks.push("At least one repository workspace has unknown dirty state.");
  }
  if (failedImages.length > 0) {
    risks.push(
      `Failed image(s) need recovery before cleanup: ${
        failedImages.map((image) => image.imageId).join(", ")
      }.`,
    );
    for (const image of failedImages) {
      actions.push(...image.recoveryActions);
    }
  }

  let cleanup: PlexusWorkspaceHandoffSummary["cleanup"];
  if (failedImages.length > 0) {
    cleanup = {
      recommendation: "rescue",
      reason: "One or more images failed; preserve runtime state and use scoped rescue before cleanup.",
    };
    guidance.push("Do not close failed image state before recording rescue or recovery evidence.");
  } else if (repairRepositories.length > 0 || unknownRepositories.length > 0) {
    cleanup = {
      recommendation: "preserve",
      reason: "Repository workspace state is unknown or failed; preserve runtime state for review.",
    };
    actions.push(closeAction(data, "preserve"));
    guidance.push("Preserve runtime state until repository workspace state is reviewed.");
  } else if (dirtyRepositories.length > 0) {
    cleanup = {
      recommendation: "archive",
      reason: "Dirty image-local repository workspace changes should be archived or exported before close.",
    };
    actions.push(closeAction(data, "archive"));
    guidance.push("Archive dirty image-local repository workspaces or export them before closing.");
  } else {
    cleanup = {
      recommendation: "close",
      reason: "No dirty repository workspace or failed image was reported.",
    };
    actions.push(closeAction(data));
    guidance.push("Close the PLexus workspace after recording the clean handoff.");
  }

  return {
    projectId: scopeValue(data, "projectId"),
    workspaceId: scopeValue(data, "workspaceId"),
    targetId: scopeValue(data, "targetId"),
    projectRoot: scopeValue(data, "projectRoot"),
    sourcePath: sourcePathFromStatus(data),
    stateRoot: scopeValue(data, "stateRoot"),
    statePath: scopeValue(data, "statePath"),
    runtime: runtimeSummary(data),
    images,
    repositories,
    multiImage: images.length > 1,
    cleanup,
    risks,
    guidance,
    actions,
  };
}
