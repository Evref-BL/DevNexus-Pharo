import type { CodexWorktreeRecord } from "./codexWorktreeService.js";
import { createWorkItemService } from "./workItemService.js";
import type { WorkComment } from "./workTrackingTypes.js";

export type CodexWorktreeTrackerEvent = "prepared" | "archived";

export interface CommentCodexWorktreeHandoffOptions {
  homePath: string;
  metadataPath: string;
  metadataRecord: CodexWorktreeRecord;
  event: CodexWorktreeTrackerEvent;
  removedWorktree?: boolean;
  now?: () => Date | string;
  body?: string;
}

export class CodexWorktreeTrackerHandoffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexWorktreeTrackerHandoffError";
  }
}

export async function commentCodexWorktreeHandoff(
  options: CommentCodexWorktreeHandoffOptions,
): Promise<WorkComment> {
  const workItem = options.metadataRecord.workItem;
  if (!workItem) {
    throw new CodexWorktreeTrackerHandoffError(
      "A Codex worktree tracker comment requires metadataRecord.workItem",
    );
  }

  const service = createWorkItemService({
    homePath: options.homePath,
    now: options.now,
  });
  return service.addComment({
    project: options.metadataRecord.projectId,
    ref: workItem,
    body: options.body ?? formatCodexWorktreeHandoffComment(options),
  });
}

export function formatCodexWorktreeHandoffComment(
  options: Pick<
    CommentCodexWorktreeHandoffOptions,
    "metadataPath" | "metadataRecord" | "event" | "removedWorktree"
  >,
): string {
  const record = options.metadataRecord;
  const lines = [
    options.event === "prepared"
      ? "Codex worktree prepared."
      : "Codex worktree archived.",
    "",
    `Worktree id: ${record.id}`,
    `Project: ${record.projectId}`,
    `Branch: ${record.branchName}`,
    `Worktree path: ${record.worktreePath}`,
    `Source root: ${record.sourceRoot}`,
    `Metadata: ${options.metadataPath}`,
  ];

  if (record.baseRef) {
    lines.push(`Base ref: ${record.baseRef}`);
  }
  if (options.event === "archived") {
    lines.push(`Removed worktree: ${options.removedWorktree ? "yes" : "no"}`);
  }

  return lines.join("\n");
}
