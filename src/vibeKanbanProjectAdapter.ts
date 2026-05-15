import { vibeKanbanApiBaseUrl, type VibeKanbanApiOptions } from "./vibeKanbanMcpConfig.js";

export interface VibeKanbanProject {
  id: string;
  path?: string;
  name?: string;
  display_name?: string;
  setup_script?: string | null;
  cleanup_script?: string | null;
  dev_server_script?: string | null;
  [key: string]: unknown;
}

export interface RegisterVibeKanbanProjectOptions extends VibeKanbanApiOptions {
  projectRoot: string;
  name: string;
}

export interface RegisterVibeKanbanProjectResult {
  projectId: string;
  project: VibeKanbanProject;
  raw: unknown;
}

export interface UpdateVibeKanbanProjectOptions extends VibeKanbanApiOptions {
  projectId: string;
  setupScript?: string | null;
}

export interface UpdateVibeKanbanProjectResult {
  projectId: string;
  project: VibeKanbanProject;
  raw: unknown;
}

export interface ListVibeKanbanProjectsResult {
  projects: VibeKanbanProject[];
  raw: unknown;
}

export class VibeKanbanProjectAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeKanbanProjectAdapterError";
  }
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VibeKanbanProjectAdapterError(`${pathName} must be an object`);
  }

  return value as Record<string, unknown>;
}

function parseApiSuccess(value: unknown): unknown {
  const response = assertRecord(value, "response");
  if (response.success !== true) {
    const message =
      typeof response.message === "string"
        ? response.message
        : typeof response.error === "string"
          ? response.error
          : "Vibe Kanban project request failed";
    throw new VibeKanbanProjectAdapterError(message);
  }

  return response.data;
}

function parseProject(value: unknown): VibeKanbanProject {
  const record = assertRecord(value, "project");
  if (typeof record.id !== "string" || record.id.trim().length === 0) {
    throw new VibeKanbanProjectAdapterError("project.id must be a non-empty string");
  }

  return record as unknown as VibeKanbanProject;
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }

  return JSON.parse(text.replace(/^\uFEFF/, ""));
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetchImpl(url, init);
  const body = await readJsonResponse(response);

  if (!response.ok) {
    const detail =
      body && typeof body === "object"
        ? `: ${JSON.stringify(body)}`
        : "";
    throw new VibeKanbanProjectAdapterError(
      `Vibe Kanban project request failed with HTTP ${response.status}${detail}`,
    );
  }

  return body;
}

export async function listVibeKanbanProjects(
  options: VibeKanbanApiOptions,
): Promise<ListVibeKanbanProjectsResult> {
  const url = new URL("/api/repos", vibeKanbanApiBaseUrl(options));
  const raw = await requestJson(options.fetch ?? fetch, url.toString());
  const data = parseApiSuccess(raw);
  if (!Array.isArray(data)) {
    throw new VibeKanbanProjectAdapterError("response.data must be an array");
  }

  return {
    projects: data.map(parseProject),
    raw,
  };
}

export async function registerVibeKanbanProject(
  options: RegisterVibeKanbanProjectOptions,
): Promise<RegisterVibeKanbanProjectResult> {
  if (options.projectRoot.trim().length === 0) {
    throw new VibeKanbanProjectAdapterError("projectRoot must be non-empty");
  }

  if (options.name.trim().length === 0) {
    throw new VibeKanbanProjectAdapterError("name must be non-empty");
  }

  const url = new URL("/api/repos", vibeKanbanApiBaseUrl(options));
  const raw = await requestJson(options.fetch ?? fetch, url.toString(), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      path: options.projectRoot,
      display_name: options.name,
    }),
  });
  const project = parseProject(parseApiSuccess(raw));

  return {
    projectId: project.id,
    project,
    raw,
  };
}

export async function updateVibeKanbanProject(
  options: UpdateVibeKanbanProjectOptions,
): Promise<UpdateVibeKanbanProjectResult> {
  if (options.projectId.trim().length === 0) {
    throw new VibeKanbanProjectAdapterError("projectId must be non-empty");
  }

  const payload: Record<string, unknown> = {};
  if (options.setupScript !== undefined) {
    payload.setup_script =
      options.setupScript && options.setupScript.trim().length > 0
        ? options.setupScript
        : null;
  }

  const url = new URL(
    `/api/repos/${encodeURIComponent(options.projectId)}`,
    vibeKanbanApiBaseUrl(options),
  );
  const raw = await requestJson(options.fetch ?? fetch, url.toString(), {
    method: "PUT",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const project = parseProject(parseApiSuccess(raw));

  return {
    projectId: project.id,
    project,
    raw,
  };
}
