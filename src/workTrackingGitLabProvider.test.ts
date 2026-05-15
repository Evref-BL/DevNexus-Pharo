import { describe, expect, it } from "vitest";
import {
  createGitLabWorkTrackerProvider,
  defaultGitLabApiBaseUrl,
  gitLabCredentialRequest,
  normalizeGitLabApiBaseUrl,
} from "./workTrackingGitLabProvider.js";
import type { GitLabWorkTrackingConfig } from "./workTrackingTypes.js";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface QueuedResponse {
  status?: number;
  body: unknown;
}

function gitLabConfig(
  overrides: Partial<GitLabWorkTrackingConfig> = {},
): GitLabWorkTrackingConfig {
  return {
    provider: "gitlab",
    repository: {
      id: "example/project",
    },
    ...overrides,
  };
}

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1001,
    iid: 7,
    project_id: 42,
    title: "Tracked task",
    description: "Issue body",
    state: "opened",
    labels: ["bug"],
    assignees: [{ id: 42, username: "alice" }],
    milestone: { id: 3, title: "M1" },
    created_at: "2026-05-15T10:00:00Z",
    updated_at: "2026-05-15T10:01:00Z",
    closed_at: null,
    web_url: "https://gitlab.com/example/project/-/issues/7",
    references: {
      full: "example/project#7",
    },
    ...overrides,
  };
}

function queuedFetch(responses: QueuedResponse[]): {
  calls: FetchCall[];
  fetch: typeof fetch;
} {
  const calls: FetchCall[] = [];
  const fetchFn: typeof fetch = async (input, init = {}) => {
    const response = responses.shift();
    if (!response) {
      throw new Error(`Unexpected GitLab request: ${String(input)}`);
    }

    const headers = init.headers as Record<string, string>;
    calls.push({
      url: String(input),
      method: init.method ?? "GET",
      headers,
      body:
        typeof init.body === "string" && init.body.length > 0
          ? JSON.parse(init.body)
          : undefined,
    });

    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  return { calls, fetch: fetchFn };
}

describe("GitLab work tracker provider", () => {
  it("creates GitLab issues and maps status labels, refs, and headers", async () => {
    const fake = queuedFetch([
      {
        status: 201,
        body: issue({
          labels: ["bug", "status:blocked"],
        }),
      },
    ]);
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig({ host: "https://gitlab.com" }),
      token: "gitlab-token",
      fetch: fake.fetch,
      env: {},
    });

    const item = await provider.createWorkItem({
      title: "  Tracked task  ",
      description: "Issue body",
      status: "blocked",
      labels: ["bug"],
      assignees: ["42"],
      milestone: "3",
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      url: "https://gitlab.com/api/v4/projects/example%2Fproject/issues",
      method: "POST",
      headers: {
        Accept: "application/json",
        "PRIVATE-TOKEN": "gitlab-token",
      },
      body: {
        title: "Tracked task",
        description: "Issue body",
        labels: "bug,status:blocked",
        assignee_ids: [42],
        milestone_id: 3,
      },
    });
    expect(item).toMatchObject({
      id: "gitlab-7",
      status: "blocked",
      provider: "gitlab",
      labels: ["bug"],
      assignees: ["alice"],
      milestone: "M1",
      externalRef: {
        provider: "gitlab",
        repositoryId: "example/project",
        itemId: "7",
        itemNumber: 7,
        itemKey: "example/project#7",
        nodeId: "1001",
      },
    });
  });

  it("lists issues with conservative GitLab query filters and local post-filtering", async () => {
    const fake = queuedFetch([
      {
        body: [
          issue({
            iid: 1,
            title: "Ready task",
            labels: ["bug", "status:ready"],
          }),
          issue({
            iid: 2,
            title: "Todo task",
            labels: ["bug"],
          }),
          issue({
            iid: 3,
            title: "Wont do task",
            state: "closed",
            labels: ["bug", "status:wont_do"],
            closed_at: "2026-05-15T10:10:00Z",
          }),
        ],
      },
    ]);
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    const items = await provider.listWorkItems({
      status: ["ready", "wont_do"],
      labels: ["bug"],
      assignees: ["alice"],
      search: "task",
      limit: 10,
    });

    expect(fake.calls[0]?.url).toBe(
      "https://gitlab.com/api/v4/projects/example%2Fproject/issues?state=all&per_page=10&page=1&labels=bug",
    );
    expect(items).toMatchObject([
      {
        id: "gitlab-1",
        status: "ready",
      },
      {
        id: "gitlab-3",
        status: "wont_do",
      },
    ]);
  });

  it("updates status without dropping existing non-status labels", async () => {
    const fake = queuedFetch([
      {
        body: issue({
          labels: ["bug", "status:ready"],
        }),
      },
      {
        body: issue({
          labels: ["bug", "status:blocked"],
        }),
      },
      {
        body: issue({
          iid: 8,
          labels: ["triage", "status:blocked"],
        }),
      },
      {
        body: issue({
          iid: 8,
          state: "closed",
          labels: ["triage", "status:wont_do"],
          closed_at: "2026-05-15T10:10:00Z",
        }),
      },
    ]);
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(provider.setStatus({ id: "gitlab-7" }, "blocked")).resolves.toMatchObject({
      id: "gitlab-7",
      status: "blocked",
      labels: ["bug"],
    });
    expect(fake.calls[1]).toMatchObject({
      method: "PUT",
      body: {
        state_event: "reopen",
        labels: "bug,status:blocked",
      },
    });

    await expect(
      provider.setStatus(
        {
          externalRef: {
            provider: "gitlab",
            itemId: "8",
            itemNumber: 8,
          },
        },
        "wont_do",
      ),
    ).resolves.toMatchObject({
      id: "gitlab-8",
      status: "wont_do",
      labels: ["triage"],
    });
    expect(fake.calls[3]).toMatchObject({
      method: "PUT",
      body: {
        state_event: "close",
        labels: "triage,status:wont_do",
      },
    });
  });

  it("adds comments and reports GitLab API errors with context", async () => {
    const fake = queuedFetch([
      {
        status: 201,
        body: {
          id: 9001,
          body: "Recorded from DevNexus",
          author: { username: "root" },
          created_at: "2026-05-15T11:00:00Z",
          updated_at: "2026-05-15T11:00:00Z",
          noteable_iid: 7,
        },
      },
      {
        status: 404,
        body: { message: "404 Project Not Found" },
      },
    ]);
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(
      provider.addComment({ externalRef: { provider: "gitlab", itemId: "7" } }, "  Recorded from DevNexus  "),
    ).resolves.toMatchObject({
      id: "gitlab-note-9001",
      body: "Recorded from DevNexus",
      author: "root",
      externalRef: {
        itemId: "9001",
        itemNumber: 7,
      },
    });
    expect(fake.calls[0]).toMatchObject({
      url: "https://gitlab.com/api/v4/projects/example%2Fproject/issues/7/notes",
      method: "POST",
      body: {
        body: "Recorded from DevNexus",
      },
    });

    await expect(provider.getWorkItem({ id: "gitlab-404" })).rejects.toThrow(
      /GET \/api\/v4\/projects\/example%2Fproject\/issues\/404 returned 404: 404 Project Not Found/,
    );
  });

  it("normalizes GitLab and self-managed host values to API base URLs", () => {
    expect(normalizeGitLabApiBaseUrl(undefined)).toBe(defaultGitLabApiBaseUrl);
    expect(normalizeGitLabApiBaseUrl("https://gitlab.com")).toBe(
      defaultGitLabApiBaseUrl,
    );
    expect(normalizeGitLabApiBaseUrl("gitlab.enterprise.test")).toBe(
      "https://gitlab.enterprise.test/api/v4",
    );
    expect(normalizeGitLabApiBaseUrl("https://gitlab.enterprise.test/api/v4/")).toBe(
      "https://gitlab.enterprise.test/api/v4",
    );
  });

  it("preserves self-managed GitLab API base paths when building requests", async () => {
    const fake = queuedFetch([{ body: issue() }]);
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig({ host: "gitlab.enterprise.test" }),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await provider.getWorkItem({ id: "gitlab-7" });

    expect(fake.calls[0]?.url).toBe(
      "https://gitlab.enterprise.test/api/v4/projects/example%2Fproject/issues/7",
    );
  });

  it("falls back to Git credential helpers without prompting when no token is configured", async () => {
    const fake = queuedFetch([{ body: issue() }, { body: issue() }]);
    const credentialCalls: Array<{
      request: ReturnType<typeof gitLabCredentialRequest>;
      interactive: boolean;
    }> = [];
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: (request, options) => {
        credentialCalls.push({
          request,
          interactive: options.interactive,
        });
        return {
          status: 0,
          stdout: [
            "protocol=https",
            "host=gitlab.com",
            "username=oauth2",
            "password=gcm-token",
            "",
          ].join("\n"),
          stderr: "",
        };
      },
    });

    await provider.getWorkItem({ id: "gitlab-7" });
    await provider.getWorkItem({ id: "gitlab-7" });

    expect(credentialCalls).toEqual([
      {
        request: {
          protocol: "https",
          host: "gitlab.com",
          path: "example/project.git",
        },
        interactive: false,
      },
    ]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.headers["PRIVATE-TOKEN"]).toBe("gcm-token");
    expect(fake.calls[1]?.headers["PRIVATE-TOKEN"]).toBe("gcm-token");
  });

  it("uses Git credential authtype credentials when a helper returns them", async () => {
    const fake = queuedFetch([{ body: issue() }]);
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig({ host: "https://gitlab.enterprise.test/api/v4" }),
      fetch: fake.fetch,
      env: {},
      credentialRunner: (request, options) => {
        expect(request).toEqual({
          protocol: "https",
          host: "gitlab.enterprise.test",
          path: "example/project.git",
        });
        expect(options.interactive).toBe(false);
        return {
          status: 0,
          stdout: ["authtype=bearer", "credential=encoded-token", ""].join("\n"),
          stderr: "",
        };
      },
    });

    await provider.getWorkItem({ id: "gitlab-7" });

    expect(fake.calls[0]?.headers.Authorization).toBe("bearer encoded-token");
  });

  it("requires numeric assignee and milestone ids for write requests", async () => {
    const fake = queuedFetch([]);
    const provider = createGitLabWorkTrackerProvider({
      config: gitLabConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(
      provider.createWorkItem({ title: "Invalid", assignees: ["alice"] }),
    ).rejects.toThrow(/assignees\[0\] must be a positive integer/);
    await expect(
      provider.createWorkItem({ title: "Invalid", milestone: "M1" }),
    ).rejects.toThrow(/milestone must be a positive integer/);
  });
});
