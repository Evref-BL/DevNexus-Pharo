import { describe, expect, it } from "vitest";
import {
  applyWorktreeExecutionUpdate,
  emptyWorktreeExecutionMetadata,
  normalizeWorktreeExecutionMetadata,
  WorktreeExecutionMetadataError,
} from "./worktreeExecutionMetadata.js";

describe("worktree execution metadata", () => {
  it("creates and normalizes empty execution metadata", () => {
    expect(emptyWorktreeExecutionMetadata()).toEqual({
      commitIds: [],
      verification: [],
      publicationDecision: null,
      updatedAt: null,
    });
    expect(normalizeWorktreeExecutionMetadata(undefined)).toEqual(
      emptyWorktreeExecutionMetadata(),
    );
  });

  it("applies commit, verification, and publication updates", () => {
    const updated = applyWorktreeExecutionUpdate(
      {
        commitIds: ["abc123"],
        verification: [
          {
            command: "npm test",
            status: "passed",
            summary: "37 tests passed",
            recordedAt: "2026-05-15T09:00:00.000Z",
          },
        ],
        publicationDecision: null,
        updatedAt: "2026-05-15T09:00:00.000Z",
      },
      {
        commitIds: ["def456", "abc123"],
        verification: {
          command: "npm run check",
          summary: null,
        },
        publicationDecision: {
          type: "review_handoff",
          prUrl: "https://example.test/pull/1",
          reason: "Needs review",
        },
      },
      "2026-05-15T10:00:00.000Z",
    );

    expect(updated).toEqual({
      commitIds: ["abc123", "def456"],
      verification: [
        {
          command: "npm test",
          status: "passed",
          summary: "37 tests passed",
          recordedAt: "2026-05-15T09:00:00.000Z",
        },
        {
          command: "npm run check",
          status: "passed",
          summary: null,
          recordedAt: "2026-05-15T10:00:00.000Z",
        },
      ],
      publicationDecision: {
        type: "review_handoff",
        targetBranch: null,
        remote: null,
        prUrl: "https://example.test/pull/1",
        reason: "Needs review",
        decidedAt: "2026-05-15T10:00:00.000Z",
      },
      updatedAt: "2026-05-15T10:00:00.000Z",
    });
  });

  it("normalizes persisted records with nullable optional fields", () => {
    expect(
      normalizeWorktreeExecutionMetadata({
        commitIds: ["abc123"],
        verification: [
          {
            command: "npm test",
            status: "not_run",
            summary: null,
            recordedAt: "2026-05-15T09:00:00.000Z",
          },
        ],
        publicationDecision: {
          type: "blocked",
          targetBranch: null,
          remote: null,
          prUrl: null,
          reason: "Missing credentials",
          decidedAt: "2026-05-15T09:01:00.000Z",
        },
      }),
    ).toMatchObject({
      commitIds: ["abc123"],
      verification: [
        {
          command: "npm test",
          status: "not_run",
          summary: null,
        },
      ],
      publicationDecision: {
        type: "blocked",
        reason: "Missing credentials",
      },
      updatedAt: null,
    });
  });

  it("rejects invalid or empty updates", () => {
    expect(() =>
      applyWorktreeExecutionUpdate(
        emptyWorktreeExecutionMetadata(),
        {},
        "2026-05-15T10:00:00.000Z",
      ),
    ).toThrow(WorktreeExecutionMetadataError);
    expect(() =>
      normalizeWorktreeExecutionMetadata({
        commitIds: "abc123",
      }),
    ).toThrow(/commitIds must be an array/);
    expect(() =>
      normalizeWorktreeExecutionMetadata({
        publicationDecision: {
          type: "unknown",
          decidedAt: "2026-05-15T09:01:00.000Z",
        },
      }),
    ).toThrow(/publicationDecision\.type/);
  });
});
