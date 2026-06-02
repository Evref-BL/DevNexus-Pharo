import fs from "node:fs";
import path from "node:path";
import {
  loadProjectConfigIfExists,
  type NexusHomeConfig,
  type NexusProjectConfig,
} from "./config.js";
import {
  buildPlexusProjectConfig,
  normalizePlexusProjectConfig,
  projectPlexusConfigPath,
  plexusProjectConfigFileName,
  type PlexusProjectConfig,
  type PlexusRepositoryWorkspaceConfig,
} from "./devNexusPharoExtension.js";
import {
  applyPlexusRepositoryWorkspaceProjection,
} from "./plexusRepositoryWorkspaceProjection.js";

export interface SharedPlexusProjectConfigCheck {
  name: string;
  status: "ok" | "failed" | "skipped";
  message: string;
}

export function sharedPlexusProjectConfigPath(
  workspacePath: string,
  projectConfig?: NexusProjectConfig,
): string {
  return projectConfig
    ? projectPlexusConfigPath(path.resolve(workspacePath), projectConfig)
    : path.join(path.resolve(workspacePath), plexusProjectConfigFileName);
}

export function ensureSharedPlexusProjectConfig(
  workspacePath: string,
  projectConfig: NexusProjectConfig,
  homeConfig: NexusHomeConfig,
  dryRun: boolean | undefined,
  repositoryWorkspaceProjection?: PlexusRepositoryWorkspaceConfig | undefined,
): { configPath: string; created: boolean; config: PlexusProjectConfig } {
  const configPath = sharedPlexusProjectConfigPath(workspacePath, projectConfig);
  const created = !fs.existsSync(configPath);
  const reservedGatewayPorts = reservedPlexusGatewayPorts(
    homeConfig,
    workspacePath,
  );
  const existing = created
    ? (buildPlexusProjectConfig(
        projectConfig.name,
        projectConfig.id,
        undefined,
        reservedGatewayPorts,
      ) as unknown as Record<string, unknown>)
    : (JSON.parse(
        fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, ""),
      ) as Record<string, unknown>);
  const normalized = applyPlexusRepositoryWorkspaceProjection(
    normalizePlexusProjectConfig(
      existing,
      projectConfig.name,
      projectConfig.id,
      undefined,
      reservedGatewayPorts,
    ),
    repositoryWorkspaceProjection,
  );
  const nextContent = `${JSON.stringify(normalized, null, 2)}\n`;
  const existingContent = created
    ? ""
    : fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, "");
  if (!dryRun) {
    if (created || existingContent !== nextContent) {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, nextContent, "utf8");
    }
  }

  return { configPath, created, config: normalized };
}

export function inspectSharedPlexusProjectConfig(
  workspacePath: string,
  projectConfig?: NexusProjectConfig,
): SharedPlexusProjectConfigCheck {
  const configPath = sharedPlexusProjectConfigPath(workspacePath, projectConfig);
  if (!fs.existsSync(configPath)) {
    return {
      name: "plexus_project:config",
      status: "failed",
      message: `Missing ${plexusProjectConfigFileName}. Run "dev-nexus-pharo codex init ${workspacePath}" to materialize scoped PLexus project config.`,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    const valid =
      isRecord(parsed) &&
      typeof parsed.name === "string" &&
      typeof parsed.id === "string" &&
      Array.isArray(parsed.images);
    return {
      name: "plexus_project:config",
      status: valid ? "ok" : "failed",
      message: valid
        ? `Found ${plexusProjectConfigFileName}`
        : `${plexusProjectConfigFileName} is missing required id, name, or images fields.`,
    };
  } catch (error) {
    return {
      name: "plexus_project:config",
      status: "failed",
      message: `Could not read ${plexusProjectConfigFileName}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function inspectSharedPlexusImageProfiles(
  workspacePath: string,
  projectConfig?: NexusProjectConfig,
): SharedPlexusProjectConfigCheck {
  const configPath = sharedPlexusProjectConfigPath(workspacePath, projectConfig);
  if (!fs.existsSync(configPath)) {
    return {
      name: "plexus_project:images",
      status: "failed",
      message: `Missing ${plexusProjectConfigFileName}. Run "dev-nexus-pharo codex init ${workspacePath}" before image setup.`,
    };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    const images = isRecord(parsed) && Array.isArray(parsed.images)
      ? parsed.images
      : null;
    if (!images) {
      return {
        name: "plexus_project:images",
        status: "failed",
        message: `${plexusProjectConfigFileName} images must be an array.`,
      };
    }
    if (images.length === 0) {
      return {
        name: "plexus_project:images",
        status: "skipped",
        message:
          "No scoped Pharo image profile is declared. Blank projects may keep images: [], but image lifecycle work should first add a setup-owned image profile.",
      };
    }

    return {
      name: "plexus_project:images",
      status: "ok",
      message: `Found ${images.length} scoped Pharo image profile(s).`,
    };
  } catch (error) {
    return {
      name: "plexus_project:images",
      status: "failed",
      message: `Could not inspect ${plexusProjectConfigFileName} images: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export function loadPlexusProjectConfigIfExists(
  projectRoot: string,
  projectConfig: NexusProjectConfig,
): PlexusProjectConfig | undefined {
  const configPath = sharedPlexusProjectConfigPath(projectRoot, projectConfig);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }
  const parsed = JSON.parse(
    fs.readFileSync(configPath, "utf8").replace(/^\uFEFF/u, ""),
  ) as Record<string, unknown>;
  return normalizePlexusProjectConfig(
    parsed,
    projectConfig.name,
    projectConfig.id,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sameResolvedPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function gatewayPortFromPlexusProjectConfig(
  filePath: string,
): number | undefined {
  if (!fs.existsSync(filePath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(
      fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/u, ""),
    ) as unknown;
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.runtime) ||
      !isRecord(parsed.runtime.gateway)
    ) {
      return undefined;
    }
    const port = parsed.runtime.gateway.port;
    return typeof port === "number" && Number.isInteger(port)
      ? port
      : undefined;
  } catch {
    return undefined;
  }
}

function reservedPlexusGatewayPorts(
  homeConfig: NexusHomeConfig,
  currentProjectRoot: string,
): number[] {
  const ports = new Set([
    homeConfig.ports.devNexusPharoMcp,
    homeConfig.ports.plexusMcp,
  ]);
  for (const project of homeConfig.projects) {
    if (sameResolvedPath(project.projectRoot, currentProjectRoot)) {
      continue;
    }
    const projectConfig = loadProjectConfigIfExists(project.projectRoot);
    const configPath = sharedPlexusProjectConfigPath(
      project.projectRoot,
      projectConfig,
    );
    const port = gatewayPortFromPlexusProjectConfig(configPath);
    if (port !== undefined) {
      ports.add(port);
    }
  }

  return [...ports];
}
