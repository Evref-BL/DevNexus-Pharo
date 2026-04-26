import { describe, expect, it, vi } from "vitest";
import {
  ensureVibeKanbanBoard,
  VibeKanbanBoardAdapterError,
} from "./vibeKanbanBoardAdapter.js";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

describe("Vibe Kanban board adapter", () => {
  it("returns an existing board with the requested name", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/info") {
        return jsonResponse({
          success: true,
          data: {
            shared_api_base: "https://api.example.test",
          },
        });
      }
      if (url === "http://127.0.0.1:3000/api/auth/token") {
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
      if (url === "https://api.example.test/v1/fallback/projects?organization_id=org-1") {
        return jsonResponse({
          projects: [
            {
              id: "board-1",
              organization_id: "org-1",
              name: "PharoNexus",
            },
          ],
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      ensureVibeKanbanBoard({
        port: 3000,
        name: "PharoNexus",
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      boardId: "board-1",
      created: false,
      organization: {
        id: "org-1",
      },
      board: {
        id: "board-1",
        name: "PharoNexus",
      },
    });
  });

  it("creates a board when no matching board exists", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === "http://127.0.0.1:3000/api/info") {
        return jsonResponse({
          success: true,
          data: {
            shared_api_base: "https://api.example.test/",
          },
        });
      }
      if (url === "http://127.0.0.1:3000/api/auth/token") {
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
              name: "Team",
            },
            {
              id: "org-personal",
              name: "Personal",
              is_personal: true,
            },
          ],
        });
      }
      if (
        url ===
        "https://api.example.test/v1/fallback/projects?organization_id=org-personal"
      ) {
        return jsonResponse({
          projects: [],
        });
      }
      if (url === "https://api.example.test/v1/projects") {
        expect(init).toMatchObject({
          method: "POST",
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          id: "board-new",
          organization_id: "org-personal",
          name: "PharoNexus",
          color: "210 90% 54%",
        });
        return jsonResponse({
          txid: "tx-1",
        });
      }

      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      ensureVibeKanbanBoard({
        port: 3000,
        name: "PharoNexus",
        uuid: () => "board-new",
        fetch: fetchMock,
      }),
    ).resolves.toMatchObject({
      boardId: "board-new",
      created: true,
      organization: {
        id: "org-personal",
      },
      board: {
        id: "board-new",
        organization_id: "org-personal",
        name: "PharoNexus",
      },
    });
  });

  it("rejects malformed auth token responses", async () => {
    await expect(
      ensureVibeKanbanBoard({
        port: 3000,
        name: "PharoNexus",
        fetch: async (input: string | URL | Request) => {
          if (String(input).endsWith("/api/info")) {
            return jsonResponse({
              success: true,
              data: {
                shared_api_base: "https://api.example.test",
              },
            });
          }

          return jsonResponse({
            success: true,
            data: {},
          });
        },
      }),
    ).rejects.toThrow(VibeKanbanBoardAdapterError);
  });
});
