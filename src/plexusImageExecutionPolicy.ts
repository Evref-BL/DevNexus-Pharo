export type PlexusImageExecutionMode = "disabled" | "docker";
export type PlexusImageExecutionDockerNetwork = "none" | "bridge";

export interface PlexusImageExecutionDockerPolicy {
  image: string | null;
  network: PlexusImageExecutionDockerNetwork;
  autoRemove: boolean;
  mountProjectReadOnly: boolean;
}

export interface PlexusImageExecutionPolicy {
  mode: PlexusImageExecutionMode;
  requireDisposableImage: boolean;
  requireCleanupPlan: boolean;
  docker: PlexusImageExecutionDockerPolicy;
}

export const defaultPlexusImageExecutionPolicy: PlexusImageExecutionPolicy = {
  mode: "disabled",
  requireDisposableImage: true,
  requireCleanupPlan: true,
  docker: {
    image: null,
    network: "none",
    autoRemove: true,
    mountProjectReadOnly: true,
  },
};

export function clonePlexusImageExecutionPolicy(
  policy: PlexusImageExecutionPolicy,
): PlexusImageExecutionPolicy {
  return {
    mode: policy.mode,
    requireDisposableImage: policy.requireDisposableImage,
    requireCleanupPlan: policy.requireCleanupPlan,
    docker: { ...policy.docker },
  };
}

export function resolvePlexusImageExecutionPolicy(
  value: unknown,
  pathName = "imageExecution",
): PlexusImageExecutionPolicy {
  const record = value === undefined ? {} : assertRecord(value, pathName);
  const dockerRecord =
    record.docker === undefined
      ? {}
      : assertRecord(record.docker, `${pathName}.docker`);
  const mode = imageExecutionMode(
    record.mode,
    `${pathName}.mode`,
    defaultPlexusImageExecutionPolicy.mode,
  );
  const docker = {
    image:
      nullableString(dockerRecord.image, `${pathName}.docker.image`) ??
      defaultPlexusImageExecutionPolicy.docker.image,
    network: dockerNetwork(
      dockerRecord.network,
      `${pathName}.docker.network`,
      defaultPlexusImageExecutionPolicy.docker.network,
    ),
    autoRemove:
      optionalBoolean(dockerRecord.autoRemove, `${pathName}.docker.autoRemove`) ??
      defaultPlexusImageExecutionPolicy.docker.autoRemove,
    mountProjectReadOnly:
      optionalBoolean(
        dockerRecord.mountProjectReadOnly,
        `${pathName}.docker.mountProjectReadOnly`,
      ) ?? defaultPlexusImageExecutionPolicy.docker.mountProjectReadOnly,
  };

  if (mode === "docker" && !docker.image) {
    throw new Error(`${pathName}.docker.image is required when mode is docker`);
  }

  return {
    mode,
    requireDisposableImage:
      optionalBoolean(
        record.requireDisposableImage,
        `${pathName}.requireDisposableImage`,
      ) ?? defaultPlexusImageExecutionPolicy.requireDisposableImage,
    requireCleanupPlan:
      optionalBoolean(
        record.requireCleanupPlan,
        `${pathName}.requireCleanupPlan`,
      ) ?? defaultPlexusImageExecutionPolicy.requireCleanupPlan,
    docker,
  };
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function imageExecutionMode(
  value: unknown,
  pathName: string,
  fallback: PlexusImageExecutionMode,
): PlexusImageExecutionMode {
  if (value === undefined) {
    return fallback;
  }
  if (value === "disabled" || value === "docker") {
    return value;
  }

  throw new Error(`${pathName} must be disabled or docker`);
}

function dockerNetwork(
  value: unknown,
  pathName: string,
  fallback: PlexusImageExecutionDockerNetwork,
): PlexusImageExecutionDockerNetwork {
  if (value === undefined) {
    return fallback;
  }
  if (value === "none" || value === "bridge") {
    return value;
  }

  throw new Error(`${pathName} must be none or bridge`);
}

function optionalBoolean(value: unknown, pathName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }

  throw new Error(`${pathName} must be a boolean`);
}

function nullableString(
  value: unknown,
  pathName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  throw new Error(`${pathName} must be a non-empty string or null`);
}
