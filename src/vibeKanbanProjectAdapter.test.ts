import { describe, expect, it, vi } from "vitest";
import {
  listVibeKanbanProjects,
  registerVibeKanbanProject,
  VibeKanbanProjectAdapterError,
} from "./vibeKanbanProjectAdapter.js";

describe("Vibe Kanban project adapter", () => {
  it("registers a local repository as a Vibe Kanban project", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "repo-1",
              path: "C:\\dev\\code\\git\\MyProject",
              display_name: "MyProject",
            },
          }),
          { status: 200 },
        ),
    );

    const result = await registerVibeKanbanProject({
      port: 3000,
      projectRoot: "C:\\dev\\code\\git\\MyProject",
      name: "MyProject",
      fetch: fetchMock,
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:3000/api/repos",
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      path: "C:\\dev\\code\\git\\MyProject",
      display_name: "MyProject",
    });
    expect(result).toMatchObject({
      projectId: "repo-1",
      project: {
        id: "repo-1",
        display_name: "MyProject",
      },
    });
  });

  it("lists Vibe Kanban projects from registered repos", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                id: "repo-1",
                path: "C:\\dev\\code\\git\\MyProject",
              },
            ],
          }),
          { status: 200 },
        ),
    );

    await expect(
      listVibeKanbanProjects({
        host: "localhost",
        port: 3100,
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      projects: [
        {
          id: "repo-1",
        },
      ],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:3100/api/repos",
    );
  });

  it("rejects malformed project responses", async () => {
    await expect(
      registerVibeKanbanProject({
        port: 3000,
        projectRoot: "C:\\dev\\code\\git\\Bad",
        name: "Bad",
        fetch: async () =>
          new Response(JSON.stringify({ success: true, data: {} }), {
            status: 200,
          }),
      }),
    ).rejects.toThrow(VibeKanbanProjectAdapterError);
  });
});
