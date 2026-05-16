import {
  getCodexWorktreeStatus,
  type CodexWorktreePublicationDecisionType,
  type CodexWorktreeStatus,
} from "./codexWorktreeService.js";

export interface BuildCodexWorktreeGuideOptions {
  homePath: string;
  id?: string;
  project?: string;
  workItemId?: string;
  branchName?: string;
  commentWorkItem?: boolean;
  removeWorktree?: boolean;
  publicationDecision?: CodexWorktreePublicationDecisionType;
}

export interface CodexWorktreeGuideStep {
  title: string;
  command?: string;
  detail: string;
}

export interface CodexWorktreeGuideResult {
  homePath: string;
  id: string | null;
  project: string | null;
  workItemId: string | null;
  worktree: CodexWorktreeStatus | null;
  steps: CodexWorktreeGuideStep[];
  notes: string[];
}

export function buildCodexWorktreeGuide(
  options: BuildCodexWorktreeGuideOptions,
): CodexWorktreeGuideResult {
  const worktreeStatus = options.id
    ? getCodexWorktreeStatus({
        homePath: options.homePath,
        id: options.id,
      }).worktree
    : null;
  const record = worktreeStatus?.metadataRecord;
  const id = options.id ?? record?.id ?? "<worktree-id-from-prepare-output>";
  const project = options.project ?? record?.projectId ?? "<project>";
  const workItemId = options.workItemId ?? record?.workItem?.id ?? null;
  const worktreePath = record?.worktreePath ?? "<worktree-path-from-prepare-output>";
  const commentFlag = options.commentWorkItem ? ["--comment-work-item"] : [];
  const prepareCommand = [
    "dev-nexus-pharo",
    "codex",
    "worktree",
    "prepare",
    project,
    "--home",
    options.homePath,
    ...(options.branchName ? ["--branch", options.branchName] : []),
    ...(workItemId ? ["--work-item-id", workItemId] : []),
    ...commentFlag,
    "--json",
  ];
  const publicationDecision = options.publicationDecision ?? "review_handoff";
  const recordCommand = [
    "dev-nexus-pharo",
    "codex",
    "worktree",
    "record",
    id,
    "--home",
    options.homePath,
    "--commit-id",
    "<commit-sha>",
    "--verification-command",
    "<verification-command>",
    "--verification-status",
    "passed",
    "--publication-decision",
    publicationDecision,
    "--json",
  ];
  const archiveCommand = [
    "dev-nexus-pharo",
    "codex",
    "worktree",
    "archive",
    id,
    "--home",
    options.homePath,
    ...(options.removeWorktree ? ["--remove-worktree"] : []),
    ...commentFlag,
    "--json",
  ];

  return {
    homePath: options.homePath,
    id: record?.id ?? (options.id ?? null),
    project: project === "<project>" ? null : project,
    workItemId,
    worktree: worktreeStatus,
    steps: [
      {
        title: "Prepare worktree",
        command: shellCommand(prepareCommand),
        detail:
          "Create a DevNexus-Pharo-managed Git worktree and home-level metadata record. Use --comment-work-item only when a linked work item should receive an explicit handoff comment.",
      },
      {
        title: "Run Codex directly",
        command: `cd ${quoteShellArg(worktreePath)}`,
        detail:
          "Open or start Codex in this worktree directory using the normal Codex app or CLI flow. Do not create a Vibe workspace/session/execution for implementation work.",
      },
      {
        title: "Record execution metadata",
        command: shellCommand(recordCommand),
        detail:
          "After committing or verifying work, record commit ids, verification commands, and the chosen publication decision on the worktree metadata record.",
      },
      {
        title: "Publish or block deliberately",
        detail:
          "Follow exactly one durable handoff path: direct integration, review handoff, blocked, or explicitly local-only. Record that decision before closeout.",
      },
      {
        title: "Archive worktree",
        command: shellCommand(archiveCommand),
        detail:
          "Archive the metadata record when the worktree is no longer active. Add --remove-worktree when the Git worktree should also be removed.",
      },
    ],
    notes: [
      "This guide is read-only and does not start agents, run Git, or mutate tracker state.",
      "Vibe Kanban can remain a work tracker provider, but this direct Codex flow does not use Vibe workspaces, sessions, or executions.",
    ],
  };
}

function shellCommand(args: string[]): string {
  return args.map(quoteShellArg).join(" ");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@-]+$/u.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '\\"')}"`;
}
