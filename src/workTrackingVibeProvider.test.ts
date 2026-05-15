import { describe, expect, it, vi } from "vitest";
import {
  createVibeWorkTrackerProvider,
  vibeWorkTrackerCapabilities,
  VibeWorkTrackerProviderError,
} from "./workTrackingVibeProvider.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("Vibe work tracker provider", () => {
  it("registers the source checkout as the Vibe project", async () => {
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        jsonResponse({
          success: true,
          data: {
            id: "repo-1",
            path: "C:\\dev\\code\\git\\PharoNexus",
            display_name: "MetaPharoNexus",
          },
        }),
    );
    const provider = createVibeWorkTrackerProvider({
      host: "localhost",
      port: 3010,
      fetch: fetchMock,
    });

    await expect(
      provider.ensureProject({
        homePath: "C:\\dev\\code\\pharo-nexus",
        projectRoot: "C:\\dev\\code\\pharo-nexus\\MetaPharoNexus",
        sourceRoot: "C:\\dev\\code\\git\\PharoNexus",
        projectId: "meta-pharo-nexus",
        projectName: "MetaPharoNexus",
      }),
    ).resolves.toEqual({
      provider: "vibe-kanban",
      id: "repo-1",
      name: "MetaPharoNexus",
      externalRef: {
        provider: "vibe-kanban",
        host: "localhost",
        itemId: "repo-1",
        projectId: "repo-1",
        repositoryId: "repo-1",
      },
    });

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:3010/api/repos",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      path: "C:\\dev\\code\\git\\PharoNexus",
      display_name: "MetaPharoNexus",
    });
  });

  it("ensures the named Vibe board through the board adapter", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3020/api/info") {
        return jsonResponse({
          success: true,
          data: {
            shared_api_base: "https://api.example.test",
          },
        });
      }
      if (url === "http://127.0.0.1:3020/api/auth/token") {
        return jsonResponse({
          success: true,
          data: {
            access_token: "token-1",
          },
        });
      }
      if (url === "https://api.example.test/v1/organizations") {
        return jsonResponse({
          organizations: [
            {
              id: "org-1",
              name: "Personal",
              is_personal: true,
            },
          ],
        });
      }
      if (
        url === "https://api.example.test/v1/fallback/projects?organization_id=org-1"
      ) {
        return jsonResponse({
          projects: [
            {
              id: "board-1",
              organization_id: "org-1",
              name: "MetaPharoNexus",
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });
    const provider = createVibeWorkTrackerProvider({
      port: 3020,
      fetch: fetchMock,
    });

    await expect(
      provider.ensureBoard({
        homePath: "C:\\dev\\code\\pharo-nexus",
        projectRoot: "C:\\dev\\code\\pharo-nexus\\MetaPharoNexus",
        projectId: "meta-pharo-nexus",
        projectName: "MetaPharoNexus",
      }),
    ).resolves.toEqual({
      provider: "vibe-kanban",
      id: "board-1",
      name: "MetaPharoNexus",
      externalRef: {
        provider: "vibe-kanban",
        host: null,
        itemId: "board-1",
        projectId: "board-1",
        boardId: "board-1",
      },
    });
  });

  it("advertises Vibe as board-only until neutral work item APIs exist", async () => {
    const provider = createVibeWorkTrackerProvider({
      port: 3000,
      fetch: vi.fn(),
    });

    expect(provider.capabilities).toEqual(vibeWorkTrackerCapabilities);
    expect(provider.capabilities.board).toBe(true);
    expect(provider.capabilities.createItem).toBe(false);
    await expect(
      provider.createWorkItem({ title: "Item routed through Vibe" }),
    ).rejects.toThrow(VibeWorkTrackerProviderError);
    await expect(provider.listWorkItems({})).rejects.toThrow(
      /does not support neutral work item operation: listWorkItems/,
    );
  });
});
