import { randomUUID } from "node:crypto";
import { vibeKanbanPinnedVersion } from "./config.js";
import { vibeKanbanApiBaseUrl, type VibeKanbanApiOptions } from "./vibeKanbanMcpConfig.js";

export interface VibeKanbanOrganization {
  id: string;
  name?: string;
  is_personal?: boolean;
  [key: string]: unknown;
}

export interface VibeKanbanBoard {
  id: string;
  organization_id?: string;
  name: string;
  color?: string;
  [key: string]: unknown;
}

export interface EnsureVibeKanbanBoardOptions extends VibeKanbanApiOptions {
  name: string;
  organizationId?: string;
  color?: string;
  uuid?: () => string;
}

export interface EnsureVibeKanbanBoardResult {
  boardId: string;
  board: VibeKanbanBoard;
  organization: VibeKanbanOrganization;
  created: boolean;
  raw: {
    info?: unknown;
    organizations?: unknown;
    projects?: unknown;
    create?: unknown;
  };
}

export class VibeKanbanBoardAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VibeKanbanBoardAdapterError";
  }
}

function assertRecord(value: unknown, pathName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new VibeKanbanBoardAdapterError(`${pathName} must be an object`);
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
    throw new VibeKanbanBoardAdapterError(`${pathName}.${key} must be a non-empty string`);
  }

  return value;
}

function parseApiSuccess(value: unknown): unknown {
  const response = assertRecord(value, "response");
  if (response.success !== true) {
    const message =
      typeof response.message === "string"
        ? response.message
        : typeof response.error === "string"
          ? response.error
          : "Vibe Kanban request failed";
    throw new VibeKanbanBoardAdapterError(message);
  }

  return response.data;
}

function parseOrganization(value: unknown): VibeKanbanOrganization {
  const record = assertRecord(value, "organization");
  return {
    ...record,
    id: requiredString(record, "id", "organization"),
  } as VibeKanbanOrganization;
}

function parseBoard(value: unknown): VibeKanbanBoard {
  const record = assertRecord(value, "project");
  return {
    ...record,
    id: requiredString(record, "id", "project"),
    name: requiredString(record, "name", "project"),
  } as VibeKanbanBoard;
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
    throw new VibeKanbanBoardAdapterError(
      `Vibe Kanban request failed with HTTP ${response.status}${detail}`,
    );
  }

  return body;
}

function remoteRequestHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    "content-type": "application/json",
    "x-client-version": vibeKanbanPinnedVersion,
    "x-client-type": "frontend",
  };
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

async function getVibeKanbanInfo(
  options: VibeKanbanApiOptions,
  fetchImpl: typeof fetch,
): Promise<{ sharedApiBase: string; raw: unknown }> {
  const url = new URL("/api/info", vibeKanbanApiBaseUrl(options));
  const raw = await requestJson(fetchImpl, url.toString());
  const data = assertRecord(parseApiSuccess(raw), "info");
  return {
    sharedApiBase:
      typeof data.shared_api_base === "string" && data.shared_api_base.trim()
        ? normalizeBaseUrl(data.shared_api_base)
        : "https://api.vibekanban.com",
    raw,
  };
}

async function getVibeKanbanAccessToken(
  options: VibeKanbanApiOptions,
  fetchImpl: typeof fetch,
): Promise<string> {
  const url = new URL("/api/auth/token", vibeKanbanApiBaseUrl(options));
  const raw = await requestJson(fetchImpl, url.toString());
  const data = assertRecord(parseApiSuccess(raw), "auth token");
  return requiredString(data, "access_token", "auth token");
}

async function listOrganizations(
  sharedApiBase: string,
  accessToken: string,
  fetchImpl: typeof fetch,
): Promise<{ organizations: VibeKanbanOrganization[]; raw: unknown }> {
  const raw = await requestJson(fetchImpl, `${sharedApiBase}/v1/organizations`, {
    method: "GET",
    headers: remoteRequestHeaders(accessToken),
  });
  const data = assertRecord(raw, "organizations response");
  const organizations = data.organizations;
  if (!Array.isArray(organizations)) {
    throw new VibeKanbanBoardAdapterError("organizations response.organizations must be an array");
  }

  return {
    organizations: organizations.map(parseOrganization),
    raw,
  };
}

async function listBoards(
  sharedApiBase: string,
  accessToken: string,
  organizationId: string,
  fetchImpl: typeof fetch,
): Promise<{ boards: VibeKanbanBoard[]; raw: unknown }> {
  const url = new URL(`${sharedApiBase}/v1/fallback/projects`);
  url.searchParams.set("organization_id", organizationId);
  const raw = await requestJson(fetchImpl, url.toString(), {
    method: "GET",
    headers: remoteRequestHeaders(accessToken),
  });
  const data = assertRecord(raw, "projects response");
  const projects = data.projects;
  if (!Array.isArray(projects)) {
    throw new VibeKanbanBoardAdapterError("projects response.projects must be an array");
  }

  return {
    boards: projects.map(parseBoard),
    raw,
  };
}

async function createBoard(
  sharedApiBase: string,
  accessToken: string,
  organizationId: string,
  name: string,
  color: string,
  uuid: () => string,
  fetchImpl: typeof fetch,
): Promise<{ board: VibeKanbanBoard; raw: unknown }> {
  const board: VibeKanbanBoard = {
    id: uuid(),
    organization_id: organizationId,
    name,
    color,
  };
  const raw = await requestJson(fetchImpl, `${sharedApiBase}/v1/projects`, {
    method: "POST",
    headers: remoteRequestHeaders(accessToken),
    body: JSON.stringify(board),
  });

  return {
    board,
    raw,
  };
}

function selectOrganization(
  organizations: VibeKanbanOrganization[],
  organizationId: string | undefined,
): VibeKanbanOrganization {
  if (organizationId) {
    const matched = organizations.find((organization) => organization.id === organizationId);
    if (!matched) {
      throw new VibeKanbanBoardAdapterError(
        `Vibe Kanban organization was not found: ${organizationId}`,
      );
    }

    return matched;
  }

  const personal = organizations.find((organization) => organization.is_personal === true);
  const selected = personal ?? organizations[0];
  if (!selected) {
    throw new VibeKanbanBoardAdapterError("No Vibe Kanban organizations are available");
  }

  return selected;
}

export async function ensureVibeKanbanBoard(
  options: EnsureVibeKanbanBoardOptions,
): Promise<EnsureVibeKanbanBoardResult> {
  if (options.name.trim().length === 0) {
    throw new VibeKanbanBoardAdapterError("name must be non-empty");
  }

  const fetchImpl = options.fetch ?? fetch;
  const info = await getVibeKanbanInfo(options, fetchImpl);
  const accessToken = await getVibeKanbanAccessToken(options, fetchImpl);
  const organizations = await listOrganizations(
    info.sharedApiBase,
    accessToken,
    fetchImpl,
  );
  const organization = selectOrganization(
    organizations.organizations,
    options.organizationId,
  );
  const projects = await listBoards(
    info.sharedApiBase,
    accessToken,
    organization.id,
    fetchImpl,
  );
  const existing = projects.boards.find((board) => board.name === options.name);
  if (existing) {
    return {
      boardId: existing.id,
      board: existing,
      organization,
      created: false,
      raw: {
        info: info.raw,
        organizations: organizations.raw,
        projects: projects.raw,
      },
    };
  }

  const created = await createBoard(
    info.sharedApiBase,
    accessToken,
    organization.id,
    options.name,
    options.color ?? "210 90% 54%",
    options.uuid ?? randomUUID,
    fetchImpl,
  );

  return {
    boardId: created.board.id,
    board: created.board,
    organization,
    created: true,
    raw: {
      info: info.raw,
      organizations: organizations.raw,
      projects: projects.raw,
      create: created.raw,
    },
  };
}
