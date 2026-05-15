import { describe, expect, it } from "vitest";
import {
  createGitHubWorkTrackerProvider,
  defaultGitHubApiBaseUrl,
  defaultGitHubApiVersion,
  githubCredentialRequest,
  normalizeGitHubApiBaseUrl,
} from "./workTrackingGitHubProvider.js";
import type { GitHubWorkTrackingConfig } from "./workTrackingTypes.js";

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

function githubConfig(
  overrides: Partial<GitHubWorkTrackingConfig> = {},
): GitHubWorkTrackingConfig {
  return {
    provider: "github",
    repository: {
      owner: "example",
      name: "project",
    },
    ...overrides,
  };
}

function issue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 1001,
    node_id: "I_node",
    number: 7,
    title: "Tracked task",
    body: "Issue body",
    state: "open",
    state_reason: null,
    labels: [{ name: "bug" }],
    assignees: [{ login: "alice" }],
    milestone: { title: "M1", number: 1 },
    created_at: "2026-05-15T10:00:00Z",
    updated_at: "2026-05-15T10:01:00Z",
    closed_at: null,
    html_url: "https://github.com/example/project/issues/7",
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
      throw new Error(`Unexpected GitHub request: ${String(input)}`);
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

describe("GitHub work tracker provider", () => {
  it("creates GitHub issues and maps status labels, refs, and headers", async () => {
    const fake = queuedFetch([
      {
        status: 201,
        body: issue({
          labels: [{ name: "bug" }, { name: "status:blocked" }],
        }),
      },
    ]);
    const provider = createGitHubWorkTrackerProvider({
      config: githubConfig({ host: "https://github.com" }),
      token: "github-token",
      fetch: fake.fetch,
      env: {},
    });

    const item = await provider.createWorkItem({
      title: "  Tracked task  ",
      description: "Issue body",
      status: "blocked",
      labels: ["bug"],
      assignees: ["alice"],
      milestone: "1",
    });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      url: "https://api.github.com/repos/example/project/issues",
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer github-token",
        "X-GitHub-Api-Version": defaultGitHubApiVersion,
      },
      body: {
        title: "Tracked task",
        body: "Issue body",
        labels: ["bug", "status:blocked"],
        assignees: ["alice"],
        milestone: 1,
      },
    });
    expect(item).toMatchObject({
      id: "github-7",
      status: "blocked",
      provider: "github",
      labels: ["bug"],
      assignees: ["alice"],
      milestone: "M1",
      externalRef: {
        provider: "github",
        repositoryOwner: "example",
        repositoryName: "project",
        itemId: "7",
        itemNumber: 7,
        nodeId: "I_node",
      },
    });
  });

  it("lists issues with conservative GitHub query filters and local post-filtering", async () => {
    const fake = queuedFetch([
      {
        body: [
          issue({
            number: 1,
            title: "Ready task",
            labels: [{ name: "bug" }, { name: "status:ready" }],
          }),
          issue({
            number: 2,
            title: "Pull request task",
            pull_request: { url: "https://api.github.com/pulls/2" },
          }),
          issue({
            number: 3,
            title: "Wont do task",
            state: "closed",
            state_reason: "not_planned",
            labels: [{ name: "bug" }],
            closed_at: "2026-05-15T10:10:00Z",
          }),
        ],
      },
    ]);
    const provider = createGitHubWorkTrackerProvider({
      config: githubConfig(),
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
      "https://api.github.com/repos/example/project/issues?state=all&per_page=10&page=1&labels=bug&assignee=alice",
    );
    expect(items).toMatchObject([
      {
        id: "github-1",
        status: "ready",
      },
      {
        id: "github-3",
        status: "wont_do",
      },
    ]);
  });

  it("updates status without dropping existing non-status labels", async () => {
    const fake = queuedFetch([
      {
        body: issue({
          labels: [{ name: "bug" }, { name: "status:ready" }],
        }),
      },
      {
        body: issue({
          labels: [{ name: "bug" }, { name: "status:blocked" }],
        }),
      },
      {
        body: issue({
          number: 8,
          labels: [{ name: "triage" }, { name: "status:blocked" }],
        }),
      },
      {
        body: issue({
          number: 8,
          state: "closed",
          state_reason: "not_planned",
          labels: [{ name: "triage" }],
          closed_at: "2026-05-15T10:10:00Z",
        }),
      },
    ]);
    const provider = createGitHubWorkTrackerProvider({
      config: githubConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(provider.setStatus({ id: "github-7" }, "blocked")).resolves.toMatchObject({
      id: "github-7",
      status: "blocked",
      labels: ["bug"],
    });
    expect(fake.calls[1]).toMatchObject({
      method: "PATCH",
      body: {
        state: "open",
        labels: ["bug", "status:blocked"],
      },
    });

    await expect(
      provider.setStatus(
        {
          externalRef: {
            provider: "github",
            itemId: "8",
            itemNumber: 8,
          },
        },
        "wont_do",
      ),
    ).resolves.toMatchObject({
      id: "github-8",
      status: "wont_do",
      labels: ["triage"],
    });
    expect(fake.calls[3]).toMatchObject({
      method: "PATCH",
      body: {
        state: "closed",
        state_reason: "not_planned",
        labels: ["triage"],
      },
    });
  });

  it("adds comments and reports GitHub API errors with context", async () => {
    const fake = queuedFetch([
      {
        status: 201,
        body: {
          id: 9001,
          node_id: "IC_node",
          body: "Recorded from PharoNexus",
          user: { login: "octocat" },
          created_at: "2026-05-15T11:00:00Z",
          updated_at: "2026-05-15T11:00:00Z",
          html_url: "https://github.com/example/project/issues/7#issuecomment-9001",
        },
      },
      {
        status: 404,
        body: { message: "Not Found" },
      },
    ]);
    const provider = createGitHubWorkTrackerProvider({
      config: githubConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(
      provider.addComment({ externalRef: { provider: "github", itemId: "7" } }, "  Recorded from PharoNexus  "),
    ).resolves.toMatchObject({
      id: "github-comment-9001",
      body: "Recorded from PharoNexus",
      author: "octocat",
      externalRef: {
        itemId: "9001",
        itemNumber: 7,
        nodeId: "IC_node",
      },
    });
    expect(fake.calls[0]).toMatchObject({
      url: "https://api.github.com/repos/example/project/issues/7/comments",
      method: "POST",
      body: {
        body: "Recorded from PharoNexus",
      },
    });

    await expect(provider.getWorkItem({ id: "github-404" })).rejects.toThrow(
      /GET \/repos\/example\/project\/issues\/404 returned 404: Not Found/,
    );
  });

  it("normalizes public GitHub and Enterprise host values to API base URLs", () => {
    expect(normalizeGitHubApiBaseUrl(undefined)).toBe(defaultGitHubApiBaseUrl);
    expect(normalizeGitHubApiBaseUrl("https://github.com")).toBe(
      defaultGitHubApiBaseUrl,
    );
    expect(normalizeGitHubApiBaseUrl("github.enterprise.test")).toBe(
      "https://github.enterprise.test/api/v3",
    );
    expect(normalizeGitHubApiBaseUrl("https://github.enterprise.test/api/v3/")).toBe(
      "https://github.enterprise.test/api/v3",
    );
  });

  it("preserves GitHub Enterprise API base paths when building requests", async () => {
    const fake = queuedFetch([{ body: issue() }]);
    const provider = createGitHubWorkTrackerProvider({
      config: githubConfig({ host: "github.enterprise.test" }),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await provider.getWorkItem({ id: "github-7" });

    expect(fake.calls[0]?.url).toBe(
      "https://github.enterprise.test/api/v3/repos/example/project/issues/7",
    );
  });

  it("falls back to Git credential helpers without prompting when no token is configured", async () => {
    const fake = queuedFetch([{ body: issue() }, { body: issue() }]);
    const credentialCalls: Array<{
      request: ReturnType<typeof githubCredentialRequest>;
      interactive: boolean;
    }> = [];
    const provider = createGitHubWorkTrackerProvider({
      config: githubConfig(),
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
            "host=github.com",
            "username=octocat",
            "password=gcm-token",
            "",
          ].join("\n"),
          stderr: "",
        };
      },
    });

    await provider.getWorkItem({ id: "github-7" });
    await provider.getWorkItem({ id: "github-7" });

    expect(credentialCalls).toEqual([
      {
        request: {
          protocol: "https",
          host: "github.com",
          path: "example/project.git",
        },
        interactive: false,
      },
    ]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.headers.Authorization).toBe("Bearer gcm-token");
    expect(fake.calls[1]?.headers.Authorization).toBe("Bearer gcm-token");
  });

  it("uses Git credential authtype credentials when a helper returns them", async () => {
    const fake = queuedFetch([{ body: issue() }]);
    const provider = createGitHubWorkTrackerProvider({
      config: githubConfig({ host: "https://github.enterprise.test/api/v3" }),
      fetch: fake.fetch,
      env: {},
      credentialRunner: (request, options) => {
        expect(request).toEqual({
          protocol: "https",
          host: "github.enterprise.test",
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

    await provider.getWorkItem({ id: "github-7" });

    expect(fake.calls[0]?.headers.Authorization).toBe("bearer encoded-token");
  });
});
