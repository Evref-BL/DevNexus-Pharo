import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  createJiraWorkTrackerProvider,
  jiraCredentialRequest,
  jiraRestApiPath,
  normalizeJiraApiBaseUrl,
  normalizeJiraWebBaseUrl,
} from "./workTrackingJiraProvider.js";
import type { JiraWorkTrackingConfig } from "./workTrackingTypes.js";

interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface QueuedResponse {
  status?: number;
  body?: unknown;
}

function jiraConfig(
  overrides: Partial<JiraWorkTrackingConfig> = {},
): JiraWorkTrackingConfig {
  return {
    provider: "jira",
    host: "example.atlassian.net",
    projectKey: "FCD",
    ...overrides,
  } as TestJiraIssue;
}

function adf(text: string): Record<string, unknown> {
  return {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text,
          },
        ],
      },
    ],
  };
}

type TestJiraIssue = {
  id: string;
  key: string;
  fields: Record<string, unknown>;
} & Record<string, unknown>;

function issue(overrides: Record<string, unknown> = {}): TestJiraIssue {
  return {
    id: "10001",
    key: "FCD-1",
    fields: {
      summary: "Tracked task",
      description: adf("Issue body"),
      status: {
        name: "Blocked",
        statusCategory: {
          key: "indeterminate",
          name: "In Progress",
        },
      },
      labels: ["bug", "status:blocked"],
      assignee: {
        accountId: "abc-123",
        displayName: "Alice",
      },
      created: "2026-05-15T10:00:00.000+0000",
      updated: "2026-05-15T10:01:00.000+0000",
      resolutiondate: null,
      issuetype: {
        name: "Task",
      },
      project: {
        key: "FCD",
        id: "10000",
      },
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
      throw new Error(`Unexpected Jira request: ${String(input)}`);
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

    return new Response(
      response.status === 204 ? null : JSON.stringify(response.body ?? {}),
      {
        status: response.status ?? 200,
        headers: {
          "content-type": "application/json",
        },
      },
    );
  };

  return { calls, fetch: fetchFn };
}

describe("Jira work tracker provider", () => {
  it("creates Jira issues with ADF descriptions, labels, refs, and basic auth", async () => {
    const fake = queuedFetch([
      {
        status: 201,
        body: {
          id: "10001",
          key: "FCD-1",
          self: "https://example.atlassian.net/rest/api/3/issue/10001",
        },
      },
      {
        body: issue(),
      },
    ]);
    const provider = createJiraWorkTrackerProvider({
      config: jiraConfig({ issueType: "Bug" }),
      email: "agent@example.com",
      apiToken: "jira-token",
      fetch: fake.fetch,
      env: {},
    });

    const item = await provider.createWorkItem({
      title: "  Tracked task  ",
      description: "Issue body",
      status: "blocked",
      labels: ["bug"],
      assignees: ["abc-123"],
    });

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]).toMatchObject({
      url: "https://example.atlassian.net/rest/api/3/issue",
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(
          "agent@example.com:jira-token",
          "utf8",
        ).toString("base64")}`,
      },
      body: {
        fields: {
          project: {
            key: "FCD",
          },
          issuetype: {
            name: "Bug",
          },
          summary: "Tracked task",
          description: adf("Issue body"),
          labels: ["bug", "status:blocked"],
          assignee: {
            accountId: "abc-123",
          },
        },
      },
    });
    expect(item).toMatchObject({
      id: "jira-FCD-1",
      status: "blocked",
      provider: "jira",
      labels: ["bug"],
      assignees: ["abc-123"],
      webUrl: "https://example.atlassian.net/browse/FCD-1",
      externalRef: {
        provider: "jira",
        projectId: "FCD",
        itemId: "10001",
        itemKey: "FCD-1",
      },
    });
  });

  it("lists Jira issues with bounded JQL and local neutral-status filtering", async () => {
    const fake = queuedFetch([
      {
        body: {
          issues: [
            issue({
              key: "FCD-1",
              fields: {
                ...issue().fields,
                summary: "Ready task",
                labels: ["bug", "status:ready"],
              },
            }),
            issue({
              key: "FCD-2",
              fields: {
                ...issue().fields,
                summary: "Todo task",
                labels: ["bug"],
                status: {
                  name: "To Do",
                  statusCategory: {
                    key: "new",
                  },
                },
              },
            }),
            issue({
              key: "FCD-3",
              fields: {
                ...issue().fields,
                summary: "Closed task",
                labels: ["bug"],
                status: {
                  name: "Done",
                  statusCategory: {
                    key: "done",
                  },
                },
                resolutiondate: "2026-05-15T10:10:00.000+0000",
              },
            }),
          ],
        },
      },
    ]);
    const provider = createJiraWorkTrackerProvider({
      config: jiraConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    const items = await provider.listWorkItems({
      status: ["ready", "done"],
      labels: ["bug"],
      assignees: ["abc-123"],
      search: "task",
      limit: 10,
    });

    expect(fake.calls[0]).toMatchObject({
      url: "https://example.atlassian.net/rest/api/3/search/jql",
      method: "POST",
      body: {
        jql: 'project = "FCD" AND labels in ("bug") AND assignee in ("abc-123") ORDER BY updated DESC',
        maxResults: 10,
      },
    });
    expect(items).toMatchObject([
      {
        id: "jira-FCD-1",
        status: "ready",
      },
      {
        id: "jira-FCD-3",
        status: "done",
      },
    ]);
  });

  it("updates status labels and applies configured Jira workflow transitions", async () => {
    const fake = queuedFetch([
      {
        body: issue({
          fields: {
            ...issue().fields,
            labels: ["bug", "status:ready"],
          },
        }),
      },
      {
        status: 204,
      },
      {
        status: 204,
      },
      {
        body: issue({
          fields: {
            ...issue().fields,
            labels: ["bug", "status:blocked"],
          },
        }),
      },
    ]);
    const provider = createJiraWorkTrackerProvider({
      config: jiraConfig({
        board: {
          kind: "jira-workflow",
          statusOptions: {
            blocked: "31",
          },
        },
      }),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(provider.setStatus({ id: "jira-FCD-1" }, "blocked")).resolves.toMatchObject({
      id: "jira-FCD-1",
      status: "blocked",
      labels: ["bug"],
    });
    expect(fake.calls[1]).toMatchObject({
      method: "PUT",
      body: {
        fields: {
          labels: ["bug", "status:blocked"],
        },
      },
    });
    expect(fake.calls[2]).toMatchObject({
      method: "POST",
      url: "https://example.atlassian.net/rest/api/3/issue/FCD-1/transitions",
      body: {
        transition: {
          id: "31",
        },
      },
    });
  });

  it("adds comments and reports Jira API errors with context", async () => {
    const fake = queuedFetch([
      {
        status: 201,
        body: {
          id: "9001",
          self: "https://example.atlassian.net/rest/api/3/issue/FCD-1/comment/9001",
          body: adf("Recorded from DevNexus"),
          author: {
            accountId: "abc-123",
            displayName: "Alice",
          },
          created: "2026-05-15T11:00:00.000+0000",
          updated: "2026-05-15T11:00:00.000+0000",
        },
      },
      {
        status: 404,
        body: {
          errorMessages: ["Issue does not exist or you do not have permission"],
        },
      },
    ]);
    const provider = createJiraWorkTrackerProvider({
      config: jiraConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(
      provider.addComment(
        {
          externalRef: {
            provider: "jira",
            itemKey: "FCD-1",
            itemId: "10001",
          },
        },
        "  Recorded from DevNexus  ",
      ),
    ).resolves.toMatchObject({
      id: "jira-comment-9001",
      body: "Recorded from DevNexus",
      author: "Alice",
      externalRef: {
        itemId: "9001",
        itemKey: "FCD-1",
      },
    });
    expect(fake.calls[0]).toMatchObject({
      url: "https://example.atlassian.net/rest/api/3/issue/FCD-1/comment",
      method: "POST",
      body: {
        body: adf("Recorded from DevNexus"),
      },
    });

    await expect(provider.getWorkItem({ id: "FCD-404" })).rejects.toThrow(
      /GET \/rest\/api\/3\/issue\/FCD-404 returned 404: Issue does not exist/,
    );
  });

  it("normalizes Jira host values and falls back to Git credential helpers", async () => {
    expect(normalizeJiraApiBaseUrl("example.atlassian.net")).toBe(
      `https://example.atlassian.net${jiraRestApiPath}`,
    );
    expect(normalizeJiraApiBaseUrl("https://jira.example.test/jira/rest/api/3/")).toBe(
      "https://jira.example.test/jira/rest/api/3",
    );
    expect(normalizeJiraWebBaseUrl("https://jira.example.test/jira/rest/api/3/")).toBe(
      "https://jira.example.test/jira",
    );
    expect(jiraCredentialRequest(jiraConfig())).toEqual({
      protocol: "https",
      host: "example.atlassian.net",
    });

    const fake = queuedFetch([{ body: issue() }, { body: issue() }]);
    const credentialCalls: Array<{
      request: ReturnType<typeof jiraCredentialRequest>;
      interactive: boolean;
    }> = [];
    const provider = createJiraWorkTrackerProvider({
      config: jiraConfig(),
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
            "host=example.atlassian.net",
            "username=agent@example.com",
            "password=gcm-jira-token",
            "",
          ].join("\n"),
          stderr: "",
        };
      },
    });

    await provider.getWorkItem({ id: "FCD-1" });
    await provider.getWorkItem({ id: "FCD-1" });

    expect(credentialCalls).toEqual([
      {
        request: {
          protocol: "https",
          host: "example.atlassian.net",
        },
        interactive: false,
      },
    ]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.headers.Authorization).toBe(
      `Basic ${Buffer.from("agent@example.com:gcm-jira-token", "utf8").toString("base64")}`,
    );
    expect(fake.calls[1]?.headers.Authorization).toBe(
      fake.calls[0]?.headers.Authorization,
    );
  });

  it("rejects unsupported Jira milestone and multiple-assignee writes", async () => {
    const fake = queuedFetch([]);
    const provider = createJiraWorkTrackerProvider({
      config: jiraConfig(),
      fetch: fake.fetch,
      env: {},
      credentialRunner: false,
    });

    await expect(
      provider.createWorkItem({ title: "Invalid", milestone: "M1" }),
    ).rejects.toThrow(/milestone mapping is not configured/);
    await expect(
      provider.createWorkItem({
        title: "Invalid",
        assignees: ["abc-123", "def-456"],
      }),
    ).rejects.toThrow(/only one assignee/);
  });
});
