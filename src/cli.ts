#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import {
  doctorCodexWorkspace,
  initCodexWorkspace,
  type CodexDoctorCheck,
  type DoctorCodexWorkspaceResult,
  type InitCodexWorkspaceResult,
} from "./codexConfig.js";
import {
  buildCodexWorktreeGuide,
  type CodexWorktreeGuideResult,
} from "./codexWorktreeGuide.js";
import {
  archiveCodexWorktree,
  getCodexWorktreeStatus,
  listCodexWorktrees,
  prepareCodexWorktree,
  recordCodexWorktreeExecution,
  type ArchiveCodexWorktreeResult,
  type CodexWorktreePublicationDecisionType,
  type CodexWorktreeState,
  type CodexWorktreeVerificationStatus,
  type GetCodexWorktreeStatusResult,
  type ListCodexWorktreesResult,
  type PrepareCodexWorktreeResult,
  type RecordCodexWorktreeExecutionResult,
} from "./codexWorktreeService.js";
import { commentCodexWorktreeHandoff } from "./codexWorktreeTrackerHandoff.js";
import {
  createDefaultHomeConfig,
  defaultPharoNexusHomePath,
  initPharoNexusHome,
  loadHomeConfig,
  loadProjectConfig,
  type InitPharoNexusHomeOptions,
} from "./config.js";
import {
  getPlexusGatewayStatus,
  startPlexusGateway,
  stopPlexusGateway,
} from "./plexusGatewayService.js";
import {
  getPharoNexusStatus,
  startPharoNexus,
  stopPharoNexus,
} from "./pharoNexusRuntime.js";
import {
  configurePharoNexusProjectTracker,
  createPharoNexusProject,
  getPharoNexusProjectStatus,
  importPharoNexusProject,
  linkPharoNexusProjectTracker,
  listPharoNexusProjects,
  syncPharoNexusProjectTracker,
  type ConfigurePharoNexusProjectTrackerProvider,
  type ConfigurePharoNexusProjectTrackerResult,
  type CreatePharoNexusProjectResult,
  type GetPharoNexusProjectStatusResult,
  type ImportPharoNexusProjectResult,
  type LinkPharoNexusProjectTrackerResult,
  type ListPharoNexusProjectsResult,
  type PharoNexusProjectStatus,
  type GitRunner,
  type SyncPharoNexusProjectTrackerResult,
} from "./projectService.js";
import type { WorkComment } from "./workTrackingTypes.js";
import {
  runPharoNexusMcpServer,
  runPharoNexusMcpStdioServer,
} from "./mcpServer.js";
import { installPharoNexusAndPlexusMcpForExecutor } from "./vibeKanbanMcpConfig.js";
import {
  getVibeKanbanStatus,
  startVibeKanban,
  stopVibeKanban,
} from "./vibeKanbanService.js";
import {
  getVibeKanbanBackendStatus,
  startVibeKanbanBackend,
  stopVibeKanbanBackend,
} from "./vibeKanbanBackendService.js";

export function usage(): string {
  return [
    "Usage:",
    "  pharo-nexus --help",
    "  pharo-nexus init [home] [options]",
    "  pharo-nexus start [home] [options]",
    "  pharo-nexus status [home] [options]",
    "  pharo-nexus stop [home] [options]",
    "  pharo-nexus mcp [home] [--host <host>] [--port <port>]",
    "  pharo-nexus mcp-stdio",
    "  pharo-nexus codex init <workspace> [options]",
    "  pharo-nexus codex doctor <workspace> [options]",
    "  pharo-nexus codex worktree guide [options]",
    "  pharo-nexus codex worktree list [options]",
    "  pharo-nexus codex worktree status <id> [options]",
    "  pharo-nexus codex worktree prepare <project> [options]",
    "  pharo-nexus codex worktree record <id> [options]",
    "  pharo-nexus codex worktree archive <id> [options]",
    "  pharo-nexus project create <name> [--from <git-url> | --git-init] [options]",
    "  pharo-nexus project import <path> [--name <name>] [options]",
    "  pharo-nexus project configure-tracker <id-or-path> --provider <local|github> [options]",
    "  pharo-nexus project link-tracker <id-or-path> --tracker-project-id <id> [options]",
    "  pharo-nexus project sync-tracker <id-or-path> [options]",
    "  pharo-nexus project list [options]",
    "  pharo-nexus project status <id-or-path> [options]",
    "  pharo-nexus plexus-gateway start <home> [--force]",
    "  pharo-nexus plexus-gateway status <home> [--check-health]",
    "  pharo-nexus plexus-gateway stop <home> [--force]",
    "  pharo-nexus vibe-kanban start <home> [--force]",
    "  pharo-nexus vibe-kanban status <home> [--check-health]",
    "  pharo-nexus vibe-kanban stop <home> [--force]",
    "  pharo-nexus vibe-backend start <home> [--force]",
    "  pharo-nexus vibe-backend status <home> [--check-health]",
    "  pharo-nexus vibe-backend stop <home>",
    "  pharo-nexus vibe-kanban mcp-config install <home> --executor <name> [options]",
    "",
    "Options for init:",
    "  --projects-root <path>",
    "  --workspaces-root <path>",
    "  --plexus-state-root <path>",
    "  --vibe-kanban-port <port>",
    "  --pharo-nexus-mcp-port <port>",
    "  --plexus-mcp-port <port>",
    "  --interactive",
    "  --force",
    "  --json",
    "",
    "Options for start:",
    "  --force",
    "  --executor <name>",
    "  --server-name <name>",
    "  --skip-mcp-config",
    "  --no-open-browser",
    "  --vibe-health-timeout-ms <ms>",
    "",
    "Options for status:",
    "  --check-health",
    "  --health-timeout-ms <ms>",
    "",
    "Options for stop:",
    "  --force",
    "  --timeout-ms <ms>",
    "  --poll-interval-ms <ms>",
    "",
    "Options for codex init:",
    "  --home <path>",
    "  --dry-run",
    "  --json",
    "",
    "Options for codex doctor:",
    "  --home <path>",
    "  --timeout-ms <ms>",
    "  --json",
    "",
    "Options for codex worktree guide:",
    "  --home <path>",
    "  --id <worktree-id>",
    "  --project <id-or-path>",
    "  --work-item-id <id>",
    "  --branch <name>",
    "  --comment-work-item",
    "  --remove-worktree",
    "  --publication-decision <not_decided|local_only|direct_integration|review_handoff|blocked>",
    "  --json",
    "",
    "Options for codex worktree list:",
    "  --home <path>",
    "  --project <id-or-path>",
    "  --state <active|archived>",
    "  --json",
    "",
    "Options for codex worktree status:",
    "  --home <path>",
    "  --json",
    "",
    "Options for codex worktree prepare:",
    "  --home <path>",
    "  --branch <name>",
    "  --worktree-name <name>",
    "  --base-ref <ref>",
    "  --work-item-id <id>",
    "  --comment-work-item",
    "  --json",
    "",
    "Options for codex worktree record:",
    "  --home <path>",
    "  --commit-id <sha>",
    "  --verification-command <command>",
    "  --verification-status <passed|failed|not_run>",
    "  --verification-summary <text>",
    "  --publication-decision <not_decided|local_only|direct_integration|review_handoff|blocked>",
    "  --target-branch <branch>",
    "  --remote <name>",
    "  --pr-url <url>",
    "  --reason <text>",
    "  --json",
    "",
    "Options for codex worktree archive:",
    "  --home <path>",
    "  --remove-worktree",
    "  --comment-work-item",
    "  --json",
    "",
    "Options for project create:",
    "  --from <git-url>",
    "  --git-init",
    "  --root <path>",
    "  --tracker-project-id <id>",
    "  --sync-tracker",
    "  --vibe-host <host>",
    "  --vibe-port <port>",
    "  --home <path>",
    "  --json",
    "",
    "Options for project import:",
    "  --name <name>",
    "  --project-root <path>",
    "  --tracker-project-id <id>",
    "  --sync-tracker",
    "  --vibe-host <host>",
    "  --vibe-port <port>",
    "  --home <path>",
    "  --json",
    "",
    "Options for project configure-tracker:",
    "  --provider <local|github>",
    "  --repository-owner <owner>    required for GitHub",
    "  --repository-name <name>      required for GitHub",
    "  --host <host>                 optional GitHub Enterprise host",
    "  --store-path <path>           optional local provider store path",
    "  --home <path>",
    "  --json",
    "",
    "Options for project link-tracker:",
    "  --tracker-project-id <id>",
    "  --home <path>",
    "  --json",
    "",
    "Options for project sync-tracker:",
    "  --vibe-host <host>",
    "  --vibe-port <port>",
    "  --home <path>",
    "  --json",
    "",
    "Options for project list/status:",
    "  --home <path>",
    "  --json",
    "",
    "Options for vibe-kanban mcp-config install:",
    "  --executor <name>",
    "  --server-name <name>",
    "  --host <host>",
    "  --port <port>",
    "  --dry-run",
    "",
    "Planned commands:",
    "  pharo-nexus config show",
  ].join("\n");
}

function parsePort(value: string, optionName: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${optionName} must be an integer between 1 and 65535`);
  }

  return port;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${optionName} must be a positive integer`);
  }

  return parsed;
}

function printProgress(message: string): void {
  console.error(`[pharo-nexus] ${message}`);
}

interface ParsedInitCommand extends InitPharoNexusHomeOptions {
  interactive?: boolean;
  json?: boolean;
}

function parseInitCommand(argv: string[]): ParsedInitCommand {
  const [, homePath, ...rest] = argv;
  const options: Partial<ParsedInitCommand> = {};
  const remaining = homePath?.startsWith("--") ? [homePath, ...rest] : rest;
  if (homePath && !homePath.startsWith("--")) {
    options.homePath = homePath;
  }

  for (let index = 0; index < remaining.length; index += 1) {
    const arg = remaining[index];
    const next = (): string => {
      index += 1;
      if (index >= remaining.length) {
        throw new Error(`${arg} requires a value`);
      }

      return remaining[index];
    };

    switch (arg) {
      case "--projects-root":
        options.projectsRoot = next();
        break;
      case "--workspaces-root":
        options.workspacesRoot = next();
        break;
      case "--plexus-state-root":
        options.plexusStateRoot = next();
        break;
      case "--vibe-kanban-port":
        options.vibeKanbanPort = parsePort(next(), arg);
        break;
      case "--pharo-nexus-mcp-port":
        options.pharoNexusMcpPort = parsePort(next(), arg);
        break;
      case "--plexus-mcp-port":
        options.plexusMcpPort = parsePort(next(), arg);
        break;
      case "--interactive":
        options.interactive = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown init option: ${arg}`);
    }
  }

  return {
    homePath: defaultHomePath(),
    ...options,
  };
}

async function promptInitCommand(
  options: ParsedInitCommand,
): Promise<ParsedInitCommand> {
  if (!options.interactive) {
    return options;
  }

  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const ask = async (question: string, fallback: string): Promise<string> => {
      const answer = await terminal.question(`${question} [${fallback}]: `);
      return answer.trim() || fallback;
    };
    const askPort = async (
      question: string,
      fallback: number,
      optionName: string,
    ): Promise<number> => parsePort(await ask(question, String(fallback)), optionName);
    const askBoolean = async (
      question: string,
      fallback: boolean,
    ): Promise<boolean> => {
      const answer = await terminal.question(
        `${question} [${fallback ? "Y/n" : "y/N"}]: `,
      );
      const normalized = answer.trim().toLowerCase();
      if (!normalized) {
        return fallback;
      }

      return normalized === "y" || normalized === "yes";
    };

    const homePath = await ask(
      "PharoNexus home",
      options.homePath,
    );
    const defaults = createDefaultHomeConfig(homePath, {
      projectsRoot: options.projectsRoot,
      workspacesRoot: options.workspacesRoot,
      plexusStateRoot: options.plexusStateRoot,
      vibeKanbanPort: options.vibeKanbanPort,
      pharoNexusMcpPort: options.pharoNexusMcpPort,
      plexusMcpPort: options.plexusMcpPort,
    });

    return {
      ...options,
      homePath,
      projectsRoot: await ask("Projects root", defaults.paths.projectsRoot),
      workspacesRoot: await ask("Workspaces root", defaults.paths.workspacesRoot),
      plexusStateRoot: await ask(
        "PLexus state root",
        defaults.paths.plexusStateRoot,
      ),
      vibeKanbanPort: await askPort(
        "Vibe Kanban port",
        defaults.ports.vibeKanban,
        "--vibe-kanban-port",
      ),
      pharoNexusMcpPort: await askPort(
        "PharoNexus MCP port",
        defaults.ports.pharoNexusMcp,
        "--pharo-nexus-mcp-port",
      ),
      plexusMcpPort: await askPort(
        "PLexus MCP port",
        defaults.ports.plexusMcp,
        "--plexus-mcp-port",
      ),
      force: options.force ?? (await askBoolean("Overwrite if initialized", false)),
    };
  } finally {
    terminal.close();
  }
}

function printInitResult(
  initResult: ReturnType<typeof initPharoNexusHome>,
  json: boolean | undefined,
): void {
  if (json) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          homePath: initResult.homePath,
          configPath: initResult.configPath,
          config: initResult.config,
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log("PharoNexus home initialized.");
  console.log(`  Home: ${initResult.homePath}`);
  console.log(`  Config: ${initResult.configPath}`);
  console.log("  Paths:");
  console.log(`    Projects: ${initResult.config.paths.projectsRoot}`);
  console.log(`    Workspaces: ${initResult.config.paths.workspacesRoot}`);
  console.log(`    PLexus state: ${initResult.config.paths.plexusStateRoot}`);
  console.log(`    Control project: ${initResult.config.controlProject.root}`);
  console.log("  Ports:");
  console.log(`    Vibe Kanban: ${initResult.config.ports.vibeKanban}`);
  console.log(`    PharoNexus MCP: ${initResult.config.ports.pharoNexusMcp}`);
  console.log(`    PLexus MCP: ${initResult.config.ports.plexusMcp}`);
  console.log("");
  console.log("Next:");
  console.log("  pharo-nexus start");
}

interface ParsedMcpCommand {
  homePath: string;
  host?: string;
  port?: number;
}

function parseMcpCommand(argv: string[]): ParsedMcpCommand {
  const [, ...rest] = argv;
  const parsed: Partial<ParsedMcpCommand> = {};
  let homePath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--host":
        parsed.host = next();
        break;
      case "--port":
        parsed.port = parsePort(next(), arg);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown mcp option: ${arg}`);
        }

        if (homePath) {
          throw new Error(`Unexpected mcp argument: ${arg}`);
        }

        homePath = arg;
    }
  }

  return {
    homePath: homePath ?? defaultHomePath(),
    ...parsed,
  };
}

async function handleMcpCommand(argv: string[]): Promise<number> {
  const parsed = parseMcpCommand(argv);
  const config = loadHomeConfig(parsed.homePath);
  process.env.PHARO_NEXUS_HOME = parsed.homePath;
  await runPharoNexusMcpServer({
    host: parsed.host ?? config.mcp.host,
    port: parsed.port ?? config.ports.pharoNexusMcp,
  });
  return 0;
}

interface ParsedCodexWorkspaceCommand {
  command: "init" | "doctor";
  workspacePath: string;
  homePath: string;
  dryRun?: boolean;
  json?: boolean;
  timeoutMs?: number;
}

interface ParsedCodexWorktreePrepareCommand {
  command: "worktree_prepare";
  project: string;
  homePath: string;
  branchName?: string;
  worktreeName?: string;
  baseRef?: string;
  workItemId?: string;
  commentWorkItem?: boolean;
  json?: boolean;
}

interface ParsedCodexWorktreeArchiveCommand {
  command: "worktree_archive";
  id: string;
  homePath: string;
  removeWorktree?: boolean;
  commentWorkItem?: boolean;
  json?: boolean;
}

interface ParsedCodexWorktreeListCommand {
  command: "worktree_list";
  homePath: string;
  project?: string;
  state?: CodexWorktreeState;
  json?: boolean;
}

interface ParsedCodexWorktreeStatusCommand {
  command: "worktree_status";
  id: string;
  homePath: string;
  json?: boolean;
}

interface ParsedCodexWorktreeRecordCommand {
  command: "worktree_record";
  id: string;
  homePath: string;
  commitIds: string[];
  verificationCommand?: string;
  verificationStatus?: CodexWorktreeVerificationStatus;
  verificationSummary?: string;
  publicationDecisionType?: CodexWorktreePublicationDecisionType;
  targetBranch?: string;
  remote?: string;
  prUrl?: string;
  reason?: string;
  json?: boolean;
}

interface ParsedCodexWorktreeGuideCommand {
  command: "worktree_guide";
  homePath: string;
  id?: string;
  project?: string;
  workItemId?: string;
  branchName?: string;
  commentWorkItem?: boolean;
  removeWorktree?: boolean;
  publicationDecision?: CodexWorktreePublicationDecisionType;
  json?: boolean;
}

type ParsedCodexCommand =
  | ParsedCodexWorkspaceCommand
  | ParsedCodexWorktreePrepareCommand
  | ParsedCodexWorktreeArchiveCommand
  | ParsedCodexWorktreeListCommand
  | ParsedCodexWorktreeStatusCommand
  | ParsedCodexWorktreeRecordCommand
  | ParsedCodexWorktreeGuideCommand;

function parseCodexCommand(argv: string[]): ParsedCodexCommand {
  const [, command, workspacePath, ...rest] = argv;
  if (command === "worktree") {
    return parseCodexWorktreeCommand(argv);
  }

  if (command !== "init" && command !== "doctor") {
    throw new Error("codex requires init, doctor, or worktree");
  }

  if (!workspacePath || workspacePath.startsWith("--")) {
    throw new Error(`codex ${command} requires a workspace path`);
  }

  const parsed: Partial<ParsedCodexWorkspaceCommand> = {
    command,
    workspacePath,
    homePath: defaultHomePath(),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--dry-run":
        if (command !== "init") {
          throw new Error("--dry-run is only supported for codex init");
        }
        parsed.dryRun = true;
        break;
      case "--timeout-ms":
        if (command !== "doctor") {
          throw new Error("--timeout-ms is only supported for codex doctor");
        }
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown codex ${command} option: ${arg}`);
    }
  }

  return parsed as ParsedCodexCommand;
}

function parseCodexWorktreeCommand(argv: string[]): ParsedCodexCommand {
  const [, , action] = argv;
  if (
    action !== "prepare" &&
    action !== "archive" &&
    action !== "list" &&
    action !== "status" &&
    action !== "record" &&
    action !== "guide"
  ) {
    throw new Error("codex worktree requires guide, list, status, prepare, record, or archive");
  }

  const remaining = argv.slice(3);
  const takesPositional = action !== "list" && action !== "guide";
  const target = takesPositional ? remaining[0] : undefined;
  const rest = takesPositional ? remaining.slice(1) : remaining;
  if (!takesPositional && remaining[0] && !remaining[0].startsWith("--")) {
    throw new Error(`codex worktree ${action} does not accept a positional argument`);
  }
  if (takesPositional && (!target || target.startsWith("--"))) {
    throw new Error(`codex worktree ${action} requires ${action === "prepare" ? "a project" : "an id"}`);
  }
  const targetValue = target ?? "";

  const parsed:
    | Partial<ParsedCodexWorktreePrepareCommand>
    | Partial<ParsedCodexWorktreeArchiveCommand>
    | Partial<ParsedCodexWorktreeListCommand>
    | Partial<ParsedCodexWorktreeStatusCommand>
    | Partial<ParsedCodexWorktreeRecordCommand>
    | Partial<ParsedCodexWorktreeGuideCommand> =
    action === "prepare"
      ? {
          command: "worktree_prepare",
          project: targetValue,
          homePath: defaultHomePath(),
        }
      : action === "archive"
        ? {
            command: "worktree_archive",
            id: targetValue,
            homePath: defaultHomePath(),
          }
        : action === "status"
          ? {
              command: "worktree_status",
              id: targetValue,
              homePath: defaultHomePath(),
            }
          : action === "record"
            ? {
                command: "worktree_record",
                id: targetValue,
                homePath: defaultHomePath(),
                commitIds: [],
              }
            : {
                command: action === "guide" ? "worktree_guide" : "worktree_list",
                homePath: defaultHomePath(),
              };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--project":
        if (action !== "list" && action !== "guide") {
          throw new Error("--project is only supported for codex worktree list or guide");
        }
        (
          parsed as
            | Partial<ParsedCodexWorktreeListCommand>
            | Partial<ParsedCodexWorktreeGuideCommand>
        ).project = next();
        break;
      case "--id":
        if (action !== "guide") {
          throw new Error("--id is only supported for codex worktree guide");
        }
        (parsed as Partial<ParsedCodexWorktreeGuideCommand>).id = next();
        break;
      case "--state":
        if (action !== "list") {
          throw new Error("--state is only supported for codex worktree list");
        }
        (parsed as Partial<ParsedCodexWorktreeListCommand>).state =
          parseCodexWorktreeState(next(), arg);
        break;
      case "--branch":
        if (action !== "prepare" && action !== "guide") {
          throw new Error("--branch is only supported for codex worktree prepare or guide");
        }
        (
          parsed as
            | Partial<ParsedCodexWorktreePrepareCommand>
            | Partial<ParsedCodexWorktreeGuideCommand>
        ).branchName = next();
        break;
      case "--worktree-name":
        if (action !== "prepare") {
          throw new Error("--worktree-name is only supported for codex worktree prepare");
        }
        (parsed as Partial<ParsedCodexWorktreePrepareCommand>).worktreeName = next();
        break;
      case "--base-ref":
        if (action !== "prepare") {
          throw new Error("--base-ref is only supported for codex worktree prepare");
        }
        (parsed as Partial<ParsedCodexWorktreePrepareCommand>).baseRef = next();
        break;
      case "--work-item-id":
        if (action !== "prepare" && action !== "guide") {
          throw new Error("--work-item-id is only supported for codex worktree prepare or guide");
        }
        (
          parsed as
            | Partial<ParsedCodexWorktreePrepareCommand>
            | Partial<ParsedCodexWorktreeGuideCommand>
        ).workItemId = next();
        break;
      case "--comment-work-item":
        if (action !== "prepare" && action !== "archive" && action !== "guide") {
          throw new Error("--comment-work-item is only supported for codex worktree prepare, archive, or guide");
        }
        (
          parsed as
            | Partial<ParsedCodexWorktreePrepareCommand>
            | Partial<ParsedCodexWorktreeArchiveCommand>
            | Partial<ParsedCodexWorktreeGuideCommand>
        ).commentWorkItem = true;
        break;
      case "--commit-id":
        if (action !== "record") {
          throw new Error("--commit-id is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).commitIds?.push(next());
        break;
      case "--verification-command":
        if (action !== "record") {
          throw new Error("--verification-command is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).verificationCommand = next();
        break;
      case "--verification-status":
        if (action !== "record") {
          throw new Error("--verification-status is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).verificationStatus =
          parseCodexWorktreeVerificationStatus(next(), arg);
        break;
      case "--verification-summary":
        if (action !== "record") {
          throw new Error("--verification-summary is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).verificationSummary = next();
        break;
      case "--publication-decision":
        if (action !== "record" && action !== "guide") {
          throw new Error("--publication-decision is only supported for codex worktree record or guide");
        }
        if (action === "record") {
          (parsed as Partial<ParsedCodexWorktreeRecordCommand>).publicationDecisionType =
            parseCodexWorktreePublicationDecisionType(next(), arg);
        } else {
          (parsed as Partial<ParsedCodexWorktreeGuideCommand>).publicationDecision =
            parseCodexWorktreePublicationDecisionType(next(), arg);
        }
        break;
      case "--target-branch":
        if (action !== "record") {
          throw new Error("--target-branch is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).targetBranch = next();
        break;
      case "--remote":
        if (action !== "record") {
          throw new Error("--remote is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).remote = next();
        break;
      case "--pr-url":
        if (action !== "record") {
          throw new Error("--pr-url is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).prUrl = next();
        break;
      case "--reason":
        if (action !== "record") {
          throw new Error("--reason is only supported for codex worktree record");
        }
        (parsed as Partial<ParsedCodexWorktreeRecordCommand>).reason = next();
        break;
      case "--remove-worktree":
        if (action !== "archive" && action !== "guide") {
          throw new Error("--remove-worktree is only supported for codex worktree archive or guide");
        }
        (
          parsed as
            | Partial<ParsedCodexWorktreeArchiveCommand>
            | Partial<ParsedCodexWorktreeGuideCommand>
        ).removeWorktree = true;
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown codex worktree ${action} option: ${arg}`);
    }
  }

  if (action === "record") {
    validateParsedCodexWorktreeRecord(parsed as ParsedCodexWorktreeRecordCommand);
  }

  return parsed as ParsedCodexCommand;
}

function parseCodexWorktreeState(
  value: string,
  optionName: string,
): CodexWorktreeState {
  if (value === "active" || value === "archived") {
    return value;
  }

  throw new Error(`${optionName} must be active or archived`);
}

function parseCodexWorktreeVerificationStatus(
  value: string,
  optionName: string,
): CodexWorktreeVerificationStatus {
  if (value === "passed" || value === "failed" || value === "not_run") {
    return value;
  }

  throw new Error(`${optionName} must be passed, failed, or not_run`);
}

function parseCodexWorktreePublicationDecisionType(
  value: string,
  optionName: string,
): CodexWorktreePublicationDecisionType {
  if (
    value === "not_decided" ||
    value === "local_only" ||
    value === "direct_integration" ||
    value === "review_handoff" ||
    value === "blocked"
  ) {
    return value;
  }

  throw new Error(
    `${optionName} must be not_decided, local_only, direct_integration, review_handoff, or blocked`,
  );
}

function validateParsedCodexWorktreeRecord(
  parsed: ParsedCodexWorktreeRecordCommand,
): void {
  if (
    (parsed.verificationStatus || parsed.verificationSummary) &&
    !parsed.verificationCommand
  ) {
    throw new Error(
      "--verification-status and --verification-summary require --verification-command",
    );
  }
  if (
    (parsed.targetBranch || parsed.remote || parsed.prUrl || parsed.reason) &&
    !parsed.publicationDecisionType
  ) {
    throw new Error(
      "publication detail options require --publication-decision",
    );
  }
}

function printCodexInitResult(
  result: InitCodexWorkspaceResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(result.updated ? "Codex config updated." : "Codex config already up to date.");
  console.log(`  Workspace: ${result.workspacePath}`);
  console.log(`  Config: ${result.configPath}`);
  console.log(`  MCP servers: ${Object.keys(result.servers).join(", ")}`);
}

function formatDoctorCheck(check: CodexDoctorCheck): string {
  const marker =
    check.status === "ok" ? "ok" : check.status === "skipped" ? "skipped" : "failed";
  return `  [${marker}] ${check.name}: ${check.message}`;
}

function printCodexDoctorResult(
  result: DoctorCodexWorkspaceResult,
  json: boolean | undefined,
): void {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(result.ok ? "Codex doctor passed." : "Codex doctor found problems.");
  console.log(`  Workspace: ${result.workspacePath}`);
  console.log(`  Config: ${result.configPath}`);
  for (const check of result.checks) {
    console.log(formatDoctorCheck(check));
  }
}

function printCodexWorktreePrepareResult(
  result: PrepareCodexWorktreeResult,
  json: boolean | undefined,
  trackerComment?: WorkComment,
): void {
  const payload = { ok: true, ...result, ...(trackerComment ? { trackerComment } : {}) };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Codex worktree prepared.");
  console.log(`  Project: ${result.metadataRecord.projectId}`);
  console.log(`  Worktree: ${result.worktreePath}`);
  console.log(`  Branch: ${result.branchName}`);
  console.log(`  Metadata: ${result.metadataPath}`);
  if (trackerComment) {
    console.log(`  Tracker comment: ${trackerComment.id}`);
  }
}

function printCodexWorktreeArchiveResult(
  result: ArchiveCodexWorktreeResult,
  json: boolean | undefined,
  trackerComment?: WorkComment,
): void {
  const payload = { ok: true, ...result, ...(trackerComment ? { trackerComment } : {}) };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Codex worktree archived.");
  console.log(`  Record: ${result.metadataRecord.id}`);
  console.log(`  Worktree: ${result.metadataRecord.worktreePath}`);
  console.log(`  Removed worktree: ${result.removedWorktree ? "yes" : "no"}`);
  console.log(`  Metadata: ${result.metadataPath}`);
  if (trackerComment) {
    console.log(`  Tracker comment: ${trackerComment.id}`);
  }
}

function printCodexWorktreeListResult(
  result: ListCodexWorktreesResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`Codex worktrees: ${result.worktrees.length}`);
  console.log(`  Metadata: ${result.metadataPath}`);
  for (const worktree of result.worktrees) {
    const record = worktree.metadataRecord;
    console.log(
      `  ${record.id} [${record.state}] ${record.branchName} -> ${record.worktreePath} (${worktree.worktreeExists ? "present" : "missing"})`,
    );
  }
}

function printCodexWorktreeStatusResult(
  result: GetCodexWorktreeStatusResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const record = result.worktree.metadataRecord;
  console.log("Codex worktree status.");
  console.log(`  Record: ${record.id}`);
  console.log(`  Project: ${record.projectId}`);
  console.log(`  State: ${record.state}`);
  console.log(`  Branch: ${record.branchName}`);
  console.log(`  Worktree: ${record.worktreePath}`);
  console.log(`  Worktree exists: ${result.worktree.worktreeExists ? "yes" : "no"}`);
  console.log(`  Source exists: ${result.worktree.sourceRootExists ? "yes" : "no"}`);
  console.log(`  Metadata: ${result.metadataPath}`);
}

function printCodexWorktreeRecordResult(
  result: RecordCodexWorktreeExecutionResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const execution = result.metadataRecord.execution;
  console.log("Codex worktree execution recorded.");
  console.log(`  Record: ${result.metadataRecord.id}`);
  console.log(`  Commits: ${execution.commitIds.length}`);
  console.log(`  Verification records: ${execution.verification.length}`);
  console.log(
    `  Publication decision: ${execution.publicationDecision?.type ?? "none"}`,
  );
  console.log(`  Metadata: ${result.metadataPath}`);
}

function printCodexWorktreeGuideResult(
  result: CodexWorktreeGuideResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("Direct Codex worktree workflow.");
  for (const [index, step] of result.steps.entries()) {
    console.log(`${index + 1}. ${step.title}`);
    if (step.command) {
      console.log(`   ${step.command}`);
    }
    console.log(`   ${step.detail}`);
  }
  for (const note of result.notes) {
    console.log(`Note: ${note}`);
  }
}

export interface CliContext {
  gitRunner?: GitRunner;
}

async function handleCodexCommand(
  argv: string[],
  context: CliContext = {},
): Promise<number> {
  const parsed = parseCodexCommand(argv);
  if (parsed.command === "init") {
    const result = initCodexWorkspace({
      workspacePath: parsed.workspacePath,
      homePath: parsed.homePath,
      dryRun: parsed.dryRun,
    });
    printCodexInitResult(result, parsed.json);
    return 0;
  }

  if (parsed.command === "worktree_guide") {
    const result = buildCodexWorktreeGuide({
      homePath: parsed.homePath,
      id: parsed.id,
      project: parsed.project,
      workItemId: parsed.workItemId,
      branchName: parsed.branchName,
      commentWorkItem: parsed.commentWorkItem,
      removeWorktree: parsed.removeWorktree,
      publicationDecision: parsed.publicationDecision,
    });
    printCodexWorktreeGuideResult(result, parsed.json);
    return 0;
  }

  if (parsed.command === "worktree_prepare") {
    const result = prepareCodexWorktree({
      homePath: parsed.homePath,
      project: parsed.project,
      branchName: parsed.branchName,
      worktreeName: parsed.worktreeName,
      baseRef: parsed.baseRef,
      workItem: parsed.workItemId ? { id: parsed.workItemId } : undefined,
      gitRunner: context.gitRunner,
    });
    const trackerComment = parsed.commentWorkItem
      ? await commentCodexWorktreeHandoff({
          homePath: parsed.homePath,
          metadataPath: result.metadataPath,
          metadataRecord: result.metadataRecord,
          event: "prepared",
        })
      : undefined;
    printCodexWorktreePrepareResult(result, parsed.json, trackerComment);
    return 0;
  }

  if (parsed.command === "worktree_archive") {
    const result = archiveCodexWorktree({
      homePath: parsed.homePath,
      id: parsed.id,
      removeWorktree: parsed.removeWorktree,
      gitRunner: context.gitRunner,
    });
    const trackerComment = parsed.commentWorkItem
      ? await commentCodexWorktreeHandoff({
          homePath: parsed.homePath,
          metadataPath: result.metadataPath,
          metadataRecord: result.metadataRecord,
          event: "archived",
          removedWorktree: result.removedWorktree,
        })
      : undefined;
    printCodexWorktreeArchiveResult(result, parsed.json, trackerComment);
    return 0;
  }

  if (parsed.command === "worktree_list") {
    const result = listCodexWorktrees({
      homePath: parsed.homePath,
      project: parsed.project,
      state: parsed.state,
    });
    printCodexWorktreeListResult(result, parsed.json);
    return 0;
  }

  if (parsed.command === "worktree_status") {
    const result = getCodexWorktreeStatus({
      homePath: parsed.homePath,
      id: parsed.id,
    });
    printCodexWorktreeStatusResult(result, parsed.json);
    return 0;
  }

  if (parsed.command === "worktree_record") {
    const result = recordCodexWorktreeExecution({
      homePath: parsed.homePath,
      id: parsed.id,
      commitIds: parsed.commitIds,
      verification: parsed.verificationCommand
        ? {
            command: parsed.verificationCommand,
            status: parsed.verificationStatus,
            summary: parsed.verificationSummary,
          }
        : undefined,
      publicationDecision: parsed.publicationDecisionType
        ? {
            type: parsed.publicationDecisionType,
            targetBranch: parsed.targetBranch,
            remote: parsed.remote,
            prUrl: parsed.prUrl,
            reason: parsed.reason,
          }
        : undefined,
    });
    printCodexWorktreeRecordResult(result, parsed.json);
    return 0;
  }

  const result = await doctorCodexWorkspace({
    workspacePath: parsed.workspacePath,
    homePath: parsed.homePath,
    timeoutMs: parsed.timeoutMs,
  });
  printCodexDoctorResult(result, parsed.json);
  return result.ok ? 0 : 1;
}

export async function main(argv: string[], context: CliContext = {}): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  if (argv[0] === "init") {
    const parsed = await promptInitCommand(parseInitCommand(argv));
    const initResult = initPharoNexusHome(parsed);
    printInitResult(initResult, parsed.json);
    return 0;
  }

  if (argv[0] === "start") {
    return handleStartCommand(argv);
  }

  if (argv[0] === "status") {
    return handleStatusCommand(argv);
  }

  if (argv[0] === "stop") {
    return handleStopCommand(argv);
  }

  if (argv[0] === "mcp") {
    return handleMcpCommand(argv);
  }

  if (argv[0] === "mcp-stdio") {
    await runPharoNexusMcpStdioServer();
    return 0;
  }

  if (argv[0] === "codex") {
    return handleCodexCommand(argv, context);
  }

  if (argv[0] === "project") {
    return handleProjectCommand(argv);
  }

  if (argv[0] === "plexus-gateway") {
    return handlePlexusGatewayCommand(argv);
  }

  if (argv[0] === "vibe-kanban") {
    return handleVibeKanbanCommand(argv);
  }

  if (argv[0] === "vibe-backend") {
    return handleVibeKanbanBackendCommand(argv);
  }

  console.error(`Unknown command: ${argv.join(" ")}`);
  console.error("");
  console.error(usage());
  return 2;
}

interface ParsedStartCommand {
  homePath: string;
  force?: boolean;
  executor?: string;
  serverName?: string;
  skipMcpConfig?: boolean;
  openBrowser?: boolean;
  vibeHealthTimeoutMs?: number;
}

function defaultHomePath(): string {
  return defaultPharoNexusHomePath();
}

function parseStartCommand(argv: string[]): ParsedStartCommand {
  const [, ...rest] = argv;
  const parsed: Partial<ParsedStartCommand> = {};
  let homePath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--force":
        parsed.force = true;
        break;
      case "--executor":
        parsed.executor = next();
        break;
      case "--server-name":
        parsed.serverName = next();
        break;
      case "--skip-mcp-config":
        parsed.skipMcpConfig = true;
        break;
      case "--no-open-browser":
        parsed.openBrowser = false;
        break;
      case "--vibe-health-timeout-ms":
        parsed.vibeHealthTimeoutMs = parsePositiveInteger(next(), arg);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown start option: ${arg}`);
        }

        if (homePath) {
          throw new Error(`Unexpected start argument: ${arg}`);
        }

        homePath = arg;
    }
  }

  return {
    homePath: homePath ?? defaultHomePath(),
    ...parsed,
  };
}

async function handleStartCommand(argv: string[]): Promise<number> {
  const result = await startPharoNexus({
    ...parseStartCommand(argv),
    progress: printProgress,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

interface ParsedStatusCommand {
  homePath: string;
  checkHealth?: boolean;
  healthTimeoutMs?: number;
}

function parseStatusCommand(argv: string[]): ParsedStatusCommand {
  const [, ...rest] = argv;
  const parsed: Partial<ParsedStatusCommand> = {};
  let homePath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--check-health":
        parsed.checkHealth = true;
        break;
      case "--health-timeout-ms":
        parsed.healthTimeoutMs = parsePositiveInteger(next(), arg);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown status option: ${arg}`);
        }

        if (homePath) {
          throw new Error(`Unexpected status argument: ${arg}`);
        }

        homePath = arg;
    }
  }

  return {
    homePath: homePath ?? defaultHomePath(),
    ...parsed,
  };
}

async function handleStatusCommand(argv: string[]): Promise<number> {
  const result = await getPharoNexusStatus(parseStatusCommand(argv));
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

interface ParsedStopCommand {
  homePath: string;
  force?: boolean;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function parseStopCommand(argv: string[]): ParsedStopCommand {
  const [, ...rest] = argv;
  const parsed: Partial<ParsedStopCommand> = {};
  let homePath: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--force":
        parsed.force = true;
        break;
      case "--timeout-ms":
        parsed.timeoutMs = parsePositiveInteger(next(), arg);
        break;
      case "--poll-interval-ms":
        parsed.pollIntervalMs = parsePositiveInteger(next(), arg);
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown stop option: ${arg}`);
        }

        if (homePath) {
          throw new Error(`Unexpected stop argument: ${arg}`);
        }

        homePath = arg;
    }
  }

  return {
    homePath: homePath ?? defaultHomePath(),
    ...parsed,
  };
}

async function handleStopCommand(argv: string[]): Promise<number> {
  const result = await stopPharoNexus({
    ...parseStopCommand(argv),
    progress: printProgress,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

interface ParsedProjectCreateCommand {
  homePath: string;
  name: string;
  from?: string;
  gitInit?: boolean;
  root?: string;
  trackerProjectId?: string;
  syncTracker?: boolean;
  vibeHost?: string;
  vibePort?: number;
  json?: boolean;
}

interface ParsedProjectImportCommand {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
  trackerProjectId?: string;
  syncTracker?: boolean;
  vibeHost?: string;
  vibePort?: number;
  json?: boolean;
}

interface ParsedProjectConfigureTrackerCommand {
  homePath: string;
  project: string;
  provider: ConfigurePharoNexusProjectTrackerProvider;
  host?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  storePath?: string;
  json?: boolean;
}

interface ParsedProjectLinkTrackerCommand {
  homePath: string;
  project: string;
  trackerProjectId: string;
  json?: boolean;
}

interface ParsedProjectSyncTrackerCommand {
  homePath: string;
  project: string;
  vibeHost?: string;
  vibePort?: number;
  json?: boolean;
}

interface ParsedProjectListCommand {
  homePath: string;
  json?: boolean;
}

interface ParsedProjectStatusCommand {
  homePath: string;
  project: string;
  json?: boolean;
}

function parseProjectCreateCommand(argv: string[]): ParsedProjectCreateCommand {
  const [, command, name, ...rest] = argv;
  if (command !== "create") {
    throw new Error("project requires create");
  }

  if (!name || name.startsWith("--")) {
    throw new Error("project create requires a project name");
  }

  const parsed: Partial<ParsedProjectCreateCommand> = {
    name,
    homePath: defaultHomePath(),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--from":
        parsed.from = next();
        break;
      case "--git-init":
        parsed.gitInit = true;
        break;
      case "--root":
        parsed.root = next();
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--sync-tracker":
        parsed.syncTracker = true;
        break;
      case "--vibe-host":
        parsed.vibeHost = next();
        break;
      case "--vibe-port":
        parsed.vibePort = parsePort(next(), arg);
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project create option: ${arg}`);
    }
  }

  if (parsed.syncTracker && parsed.trackerProjectId) {
    throw new Error("--sync-tracker and --tracker-project-id are mutually exclusive");
  }

  return parsed as ParsedProjectCreateCommand;
}

function parseProjectImportCommand(argv: string[]): ParsedProjectImportCommand {
  const [, command, root, ...rest] = argv;
  if (command !== "import") {
    throw new Error("project requires import");
  }

  if (!root || root.startsWith("--")) {
    throw new Error("project import requires a project path");
  }

  const parsed: Partial<ParsedProjectImportCommand> = {
    root,
    homePath: defaultHomePath(),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--name":
        parsed.name = next();
        break;
      case "--project-root":
        parsed.projectRoot = next();
        break;
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--sync-tracker":
        parsed.syncTracker = true;
        break;
      case "--vibe-host":
        parsed.vibeHost = next();
        break;
      case "--vibe-port":
        parsed.vibePort = parsePort(next(), arg);
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project import option: ${arg}`);
    }
  }

  if (parsed.syncTracker && parsed.trackerProjectId) {
    throw new Error("--sync-tracker and --tracker-project-id are mutually exclusive");
  }

  return parsed as ParsedProjectImportCommand;
}

function parseProjectConfigureTrackerCommand(
  argv: string[],
): ParsedProjectConfigureTrackerCommand {
  const [, command, project, ...rest] = argv;
  if (command !== "configure-tracker") {
    throw new Error("project requires configure-tracker");
  }

  if (!project || project.startsWith("--")) {
    throw new Error("project configure-tracker requires a project id or path");
  }

  const parsed: Partial<ParsedProjectConfigureTrackerCommand> = {
    homePath: defaultHomePath(),
    project,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--provider":
        parsed.provider = parseTrackerProvider(next());
        break;
      case "--repository-owner":
        parsed.repositoryOwner = next();
        break;
      case "--repository-name":
        parsed.repositoryName = next();
        break;
      case "--host":
        parsed.host = next();
        break;
      case "--store-path":
        parsed.storePath = next();
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project configure-tracker option: ${arg}`);
    }
  }

  if (!parsed.provider) {
    throw new Error("--provider is required");
  }

  return parsed as ParsedProjectConfigureTrackerCommand;
}

function parseTrackerProvider(
  value: string,
): ConfigurePharoNexusProjectTrackerProvider {
  if (value === "local" || value === "github") {
    return value;
  }

  throw new Error("--provider must be local or github");
}

function parseProjectLinkTrackerCommand(
  argv: string[],
): ParsedProjectLinkTrackerCommand {
  const [, command, project, ...rest] = argv;
  if (command !== "link-tracker") {
    throw new Error("project requires link-tracker");
  }

  if (!project || project.startsWith("--")) {
    throw new Error("project link-tracker requires a project id or path");
  }

  const parsed: Partial<ParsedProjectLinkTrackerCommand> = {
    homePath: defaultHomePath(),
    project,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--tracker-project-id":
        parsed.trackerProjectId = next();
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project link-tracker option: ${arg}`);
    }
  }

  if (!parsed.trackerProjectId) {
    throw new Error("--tracker-project-id is required");
  }

  return parsed as ParsedProjectLinkTrackerCommand;
}

function parseProjectSyncTrackerCommand(
  argv: string[],
): ParsedProjectSyncTrackerCommand {
  const [, command, project, ...rest] = argv;
  if (command !== "sync-tracker") {
    throw new Error("project requires sync-tracker");
  }

  if (!project || project.startsWith("--")) {
    throw new Error("project sync-tracker requires a project id or path");
  }

  const parsed: Partial<ParsedProjectSyncTrackerCommand> = {
    homePath: defaultHomePath(),
    project,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--vibe-host":
        parsed.vibeHost = next();
        break;
      case "--vibe-port":
        parsed.vibePort = parsePort(next(), arg);
        break;
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project sync-tracker option: ${arg}`);
    }
  }

  return parsed as ParsedProjectSyncTrackerCommand;
}

function parseProjectListCommand(argv: string[]): ParsedProjectListCommand {
  const [, command, ...rest] = argv;
  if (command !== "list") {
    throw new Error(
      "project requires create, import, configure-tracker, link-tracker, sync-tracker, list, or status",
    );
  }

  const parsed: Partial<ParsedProjectListCommand> = {
    homePath: defaultHomePath(),
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project list option: ${arg}`);
    }
  }

  return parsed as ParsedProjectListCommand;
}

function parseProjectStatusCommand(argv: string[]): ParsedProjectStatusCommand {
  const [, command, project, ...rest] = argv;
  if (command !== "status") {
    throw new Error(
      "project requires create, import, configure-tracker, link-tracker, sync-tracker, list, or status",
    );
  }

  if (!project || project.startsWith("--")) {
    throw new Error("project status requires a project id or path");
  }

  const parsed: Partial<ParsedProjectStatusCommand> = {
    homePath: defaultHomePath(),
    project,
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--home":
        parsed.homePath = next();
        break;
      case "--json":
        parsed.json = true;
        break;
      default:
        throw new Error(`Unknown project status option: ${arg}`);
    }
  }

  return parsed as ParsedProjectStatusCommand;
}

function printProjectCreateResult(
  result: CreatePharoNexusProjectResult,
  syncResult: SyncPharoNexusProjectTrackerResult | undefined,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
    ...(syncResult ? { trackerSync: syncResult } : {}),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("PharoNexus project created.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  PLexus config: ${result.plexusProjectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  console.log(`  Git: ${result.git.operation}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  if (result.projectConfig.kanban.projectId) {
    console.log(`  Vibe Kanban project: ${result.projectConfig.kanban.projectId}`);
  }
  if (syncResult) {
    console.log(`  Synced tracker board: ${syncResult.vibeKanbanProjectId}`);
    console.log(`  Synced tracker repo: ${syncResult.vibeKanbanRepoId}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectImportResult(
  result: ImportPharoNexusProjectResult,
  syncResult: SyncPharoNexusProjectTrackerResult | undefined,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
    ...(syncResult ? { trackerSync: syncResult } : {}),
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("PharoNexus project imported.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  PLexus config: ${result.plexusProjectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  if (result.projectConfig.kanban.projectId) {
    console.log(`  Vibe Kanban project: ${result.projectConfig.kanban.projectId}`);
  }
  if (syncResult) {
    console.log(`  Synced tracker board: ${syncResult.vibeKanbanProjectId}`);
    console.log(`  Synced tracker repo: ${syncResult.vibeKanbanRepoId}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectLinkTrackerResult(
  result: LinkPharoNexusProjectTrackerResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("PharoNexus project linked to tracker.");
  console.log(`  Project: ${result.project.id} (${result.project.name})`);
  console.log(`  Tracker project: ${result.vibeKanbanProjectId}`);
  if (result.vibeKanbanRepoId) {
    console.log(`  Tracker repo: ${result.vibeKanbanRepoId}`);
  }
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  PLexus config: ${result.plexusProjectConfigPath}`);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectConfigureTrackerResult(
  result: ConfigurePharoNexusProjectTrackerResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("PharoNexus project tracker configured.");
  console.log(`  Project: ${result.project.id} (${result.project.name})`);
  console.log(`  Provider: ${result.workTracking.provider}`);
  if (result.workTracking.provider === "github") {
    console.log(
      `  Repository: ${result.workTracking.repository.owner}/${result.workTracking.repository.name}`,
    );
    console.log(`  Host: ${result.workTracking.host ?? "github.com"}`);
  }
  if (result.workTracking.provider === "local" && result.workTracking.storePath) {
    console.log(`  Store: ${result.workTracking.storePath}`);
  }
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectSyncTrackerResult(
  result: SyncPharoNexusProjectTrackerResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("PharoNexus project synced to tracker.");
  console.log(`  Project: ${result.project.id} (${result.project.name})`);
  console.log(`  Tracker board: ${result.vibeKanbanProjectId}`);
  console.log(`  Tracker repo: ${result.vibeKanbanRepoId}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  PLexus config: ${result.plexusProjectConfigPath}`);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectStatus(project: PharoNexusProjectStatus): void {
  console.log(`  ${project.id} (${project.name})`);
  console.log(`    Root: ${project.projectRoot}`);
  console.log(`    Repo origin: ${project.repo?.remoteUrl ?? "(none)"}`);
  console.log(
    `    Default branch: ${project.repo?.defaultBranch ?? "(unknown)"}`,
  );
  console.log(
    `    Work tracker: ${project.workTracking?.provider ?? "(legacy/default)"}`,
  );
  console.log(
    `    Vibe Kanban project: ${project.vibeKanbanProjectId ?? "(unlinked)"}`,
  );
  console.log(
    `    Vibe Kanban repo: ${project.vibeKanbanRepoId ?? "(unregistered)"}`,
  );
  console.log(`    PLexus config: ${project.plexusProjectConfigPath}`);
  console.log(`    Worktrees: ${project.worktreesRoot}`);
}

function printProjectListResult(
  result: ListPharoNexusProjectsResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`PharoNexus projects: ${result.projects.length}`);
  for (const project of result.projects) {
    printProjectStatus(project);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectStatusResult(
  result: GetPharoNexusProjectStatusResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("PharoNexus project status.");
  printProjectStatus(result.project);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

async function handleProjectCommand(argv: string[]): Promise<number> {
  const command = argv[1];
  if (command === "create") {
    const parsed = parseProjectCreateCommand(argv);
    const result = createPharoNexusProject({
      ...parsed,
      vibeKanbanProjectId: parsed.trackerProjectId,
    });
    let syncResult: SyncPharoNexusProjectTrackerResult | undefined;
    if (parsed.syncTracker) {
      try {
        syncResult = await syncPharoNexusProjectTracker({
          homePath: parsed.homePath,
          project: result.projectRoot,
          host: parsed.vibeHost,
          port: parsed.vibePort,
        });
        result.projectConfig = loadProjectConfig(result.projectRoot);
        result.plexusProjectConfig = syncResult.plexusProjectConfig;
      } catch (error) {
        throw new Error(
          `Project was created locally at ${result.projectRoot}, but tracker sync failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    printProjectCreateResult(result, syncResult, parsed.json);
    return 0;
  }

  if (command === "import") {
    const parsed = parseProjectImportCommand(argv);
    const result = importPharoNexusProject({
      ...parsed,
      vibeKanbanProjectId: parsed.trackerProjectId,
    });
    let syncResult: SyncPharoNexusProjectTrackerResult | undefined;
    if (parsed.syncTracker) {
      try {
        syncResult = await syncPharoNexusProjectTracker({
          homePath: parsed.homePath,
          project: result.projectRoot,
          host: parsed.vibeHost,
          port: parsed.vibePort,
        });
        result.projectConfig = loadProjectConfig(result.projectRoot);
        result.plexusProjectConfig = syncResult.plexusProjectConfig;
      } catch (error) {
        throw new Error(
          `Project was imported locally at ${result.projectRoot}, but tracker sync failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    printProjectImportResult(result, syncResult, parsed.json);
    return 0;
  }

  if (command === "link-tracker") {
    const parsed = parseProjectLinkTrackerCommand(argv);
    const result = linkPharoNexusProjectTracker(parsed);
    printProjectLinkTrackerResult(result, parsed.json);
    return 0;
  }

  if (command === "configure-tracker") {
    const parsed = parseProjectConfigureTrackerCommand(argv);
    const result = configurePharoNexusProjectTracker(parsed);
    printProjectConfigureTrackerResult(result, parsed.json);
    return 0;
  }

  if (command === "sync-tracker") {
    const parsed = parseProjectSyncTrackerCommand(argv);
    const result = await syncPharoNexusProjectTracker({
      homePath: parsed.homePath,
      project: parsed.project,
      host: parsed.vibeHost,
      port: parsed.vibePort,
    });
    printProjectSyncTrackerResult(result, parsed.json);
    return 0;
  }

  if (command === "list") {
    const parsed = parseProjectListCommand(argv);
    const result = listPharoNexusProjects({ homePath: parsed.homePath });
    printProjectListResult(result, parsed.json);
    return 0;
  }

  if (command === "status") {
    const parsed = parseProjectStatusCommand(argv);
    const result = getPharoNexusProjectStatus(parsed);
    printProjectStatusResult(result, parsed.json);
    return 0;
  }

  throw new Error(
    "project requires create, import, configure-tracker, link-tracker, sync-tracker, list, or status",
  );
}

async function handlePlexusGatewayCommand(argv: string[]): Promise<number> {
  const [, command, homePath, ...rest] = argv;
  if (
    command !== "start" &&
    command !== "status" &&
    command !== "stop"
  ) {
    throw new Error("plexus-gateway requires start, status, or stop");
  }

  if (!homePath) {
    throw new Error(`plexus-gateway ${command} requires a home path`);
  }

  const force = rest.includes("--force");
  const checkHealth = rest.includes("--check-health");
  const unknownOption = rest.find(
    (option) => option !== "--force" && option !== "--check-health",
  );
  if (unknownOption) {
    throw new Error(`Unknown plexus-gateway option: ${unknownOption}`);
  }

  if (command === "start") {
    const state = await startPlexusGateway({ homePath, force });
    console.log(JSON.stringify({ ok: true, state }, null, 2));
    return 0;
  }

  if (command === "status") {
    const status = await getPlexusGatewayStatus({ homePath, checkHealth });
    console.log(JSON.stringify({ ok: true, ...status }, null, 2));
    return 0;
  }

  const result = await stopPlexusGateway({
    homePath,
    force: force ? true : undefined,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

interface ParsedVibeKanbanMcpInstallCommand {
  homePath: string;
  executor: string;
  serverName?: string;
  host?: string;
  port?: number;
  dryRun?: boolean;
}

function parseVibeKanbanMcpInstallCommand(
  argv: string[],
): ParsedVibeKanbanMcpInstallCommand {
  const [, scope, command, homePath, ...rest] = argv;
  if (scope !== "mcp-config" || command !== "install") {
    throw new Error("vibe-kanban requires mcp-config install");
  }

  if (!homePath) {
    throw new Error("vibe-kanban mcp-config install requires a home path");
  }

  const parsed: Partial<ParsedVibeKanbanMcpInstallCommand> = { homePath };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    const next = (): string => {
      index += 1;
      if (index >= rest.length) {
        throw new Error(`${arg} requires a value`);
      }

      return rest[index];
    };

    switch (arg) {
      case "--executor":
        parsed.executor = next();
        break;
      case "--server-name":
        parsed.serverName = next();
        break;
      case "--host":
        parsed.host = next();
        break;
      case "--port":
        parsed.port = parsePort(next(), arg);
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      default:
        throw new Error(`Unknown vibe-kanban mcp-config option: ${arg}`);
    }
  }

  if (!parsed.executor) {
    throw new Error("--executor is required");
  }

  return parsed as ParsedVibeKanbanMcpInstallCommand;
}

async function handleVibeKanbanCommand(argv: string[]): Promise<number> {
  if (
    argv[1] === "start" ||
    argv[1] === "status" ||
    argv[1] === "stop"
  ) {
    return handleVibeKanbanServiceCommand(argv);
  }

  if (argv[1] !== "mcp-config") {
    throw new Error(
      "vibe-kanban requires start, status, stop, or mcp-config install",
    );
  }

  const parsed = parseVibeKanbanMcpInstallCommand(argv);
  const config = loadHomeConfig(parsed.homePath);
  const result = await installPharoNexusAndPlexusMcpForExecutor({
    homePath: parsed.homePath,
    config,
    executor: parsed.executor,
    plexusServerName: parsed.serverName,
    pharoNexusServerName: config.integrations.vibeKanban.pharoNexusMcpServerName,
    host: parsed.host,
    port: parsed.port ?? config.ports.vibeKanban,
    dryRun: parsed.dryRun,
  });

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

async function handleVibeKanbanServiceCommand(
  argv: string[],
): Promise<number> {
  const [, command, homePath, ...rest] = argv;
  if (
    command !== "start" &&
    command !== "status" &&
    command !== "stop"
  ) {
    throw new Error(
      "vibe-kanban requires start, status, stop, or mcp-config install",
    );
  }

  if (!homePath) {
    throw new Error(`vibe-kanban ${command} requires a home path`);
  }

  const force = rest.includes("--force");
  const checkHealth = rest.includes("--check-health");
  const unknownOption = rest.find(
    (option) => option !== "--force" && option !== "--check-health",
  );
  if (unknownOption) {
    throw new Error(`Unknown vibe-kanban option: ${unknownOption}`);
  }

  if (command === "start") {
    const state = await startVibeKanban({ homePath, force });
    console.log(JSON.stringify({ ok: true, state }, null, 2));
    return 0;
  }

  if (command === "status") {
    const status = await getVibeKanbanStatus({ homePath, checkHealth });
    console.log(JSON.stringify({ ok: true, ...status }, null, 2));
    return 0;
  }

  const result = await stopVibeKanban({
    homePath,
    force: force ? true : undefined,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

async function handleVibeKanbanBackendCommand(
  argv: string[],
): Promise<number> {
  const [, command, homePath, ...rest] = argv;
  if (
    command !== "start" &&
    command !== "status" &&
    command !== "stop"
  ) {
    throw new Error("vibe-backend requires start, status, or stop");
  }

  if (!homePath) {
    throw new Error(`vibe-backend ${command} requires a home path`);
  }

  const force = rest.includes("--force");
  const checkHealth = rest.includes("--check-health");
  const unknownOption = rest.find(
    (option) => option !== "--force" && option !== "--check-health",
  );
  if (unknownOption) {
    throw new Error(`Unknown vibe-backend option: ${unknownOption}`);
  }

  if (command === "start") {
    const state = await startVibeKanbanBackend({
      homePath,
      force,
      progress: printProgress,
    });
    console.log(JSON.stringify({ ok: true, state }, null, 2));
    return 0;
  }

  if (command === "status") {
    const status = await getVibeKanbanBackendStatus({ homePath, checkHealth });
    console.log(JSON.stringify({ ok: true, ...status }, null, 2));
    return 0;
  }

  const result = await stopVibeKanbanBackend({ homePath });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

function isCliEntrypoint(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  const normalize = (filePath: string): string => {
    const resolved = path.resolve(filePath);
    try {
      return fs.realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  };

  return normalize(entrypoint) === normalize(fileURLToPath(import.meta.url));
}

if (isCliEntrypoint()) {
  main(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
