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
  createDefaultHomeConfig,
  defaultNexusHomePath,
  initNexusHome,
  loadHomeConfig,
  type InitNexusHomeOptions,
} from "./config.js";
import {
  getPlexusGatewayStatus,
  startPlexusGateway,
  stopPlexusGateway,
} from "./plexusGatewayService.js";
import {
  getDevNexusPharoStatus,
  startDevNexusPharo,
  stopDevNexusPharo,
} from "./devNexusPharoRuntime.js";
import {
  createNexusProject,
  getNexusProjectStatus,
  importNexusProject,
  listNexusProjects,
  type CreateNexusProjectResult,
  type GetNexusProjectStatusResult,
  type ImportNexusProjectResult,
  type ListNexusProjectsResult,
  type NexusProjectStatus,
} from "./nexusProjectService.js";
import {
  createDevNexusPharoProject,
  importDevNexusPharoProject,
  type CreateDevNexusPharoProjectResult,
  type ImportDevNexusPharoProjectResult,
} from "./devNexusPharoProjectService.js";
import {
  getProjectSkillStatus,
  refreshProjectSkills,
  type ProjectSkillRefreshResult,
  type ProjectSkillStatusResult,
} from "./nexusProjectSkillService.js";
import {
  runDevNexusPharoMcpServer,
  runDevNexusPharoMcpStdioServer,
} from "./mcpServer.js";
import { installDevNexusPharoAndPlexusMcpForExecutor } from "./vibeKanbanMcpConfig.js";
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
    "  dev-nexus-pharo --help",
    "  dev-nexus-pharo init [home] [options]",
    "  dev-nexus-pharo start [home] [options]",
    "  dev-nexus-pharo status [home] [options]",
    "  dev-nexus-pharo stop [home] [options]",
    "  dev-nexus-pharo mcp [home] [--host <host>] [--port <port>]",
    "  dev-nexus-pharo mcp-stdio",
    "  dev-nexus-pharo codex init <workspace> [options]",
    "  dev-nexus-pharo codex doctor <workspace> [options]",
    "  dev-nexus-pharo project create <name> [--from <git-url> | --git-init] [--generic] [options]",
    "  dev-nexus-pharo project import <path> [--name <name>] [--generic] [options]",
    "  dev-nexus-pharo project skills status <id-or-path> [options]",
    "  dev-nexus-pharo project skills refresh <id-or-path> [options]",
    "  dev-nexus-pharo project list [options]",
    "  dev-nexus-pharo project status <id-or-path> [options]",
    "  dev-nexus-pharo plexus-gateway start <home> [--force]",
    "  dev-nexus-pharo plexus-gateway status <home> [--check-health]",
    "  dev-nexus-pharo plexus-gateway stop <home> [--force]",
    "  dev-nexus-pharo vibe-kanban start <home> [--force]",
    "  dev-nexus-pharo vibe-kanban status <home> [--check-health]",
    "  dev-nexus-pharo vibe-kanban stop <home> [--force]",
    "  dev-nexus-pharo vibe-backend start <home> [--force]",
    "  dev-nexus-pharo vibe-backend status <home> [--check-health]",
    "  dev-nexus-pharo vibe-backend stop <home>",
    "  dev-nexus-pharo vibe-kanban mcp-config install <home> --executor <name> [options]",
    "",
    "Options for init:",
    "  --projects-root <path>",
    "  --workspaces-root <path>",
    "  --plexus-state-root <path>",
    "  --vibe-kanban-port <port>",
    "  --dev-nexus-pharo-mcp-port <port>",
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
    "Options for project create:",
    "  --from <git-url>",
    "  --git-init",
    "  --generic",
    "  --root <path>",
    "  --home <path>",
    "  --json",
    "",
    "Options for project import:",
    "  --name <name>",
    "  --project-root <path>",
    "  --generic",
    "  --home <path>",
    "  --json",
    "",
    "Options for project skills status/refresh:",
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
    "  dev-nexus-pharo config show",
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
  console.error(`[dev-nexus-pharo] ${message}`);
}

interface ParsedInitCommand extends InitNexusHomeOptions {
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
      case "--dev-nexus-pharo-mcp-port":
        options.devNexusPharoMcpPort = parsePort(next(), arg);
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
      "DevNexus-Pharo home",
      options.homePath,
    );
    const defaults = createDefaultHomeConfig(homePath, {
      projectsRoot: options.projectsRoot,
      workspacesRoot: options.workspacesRoot,
      plexusStateRoot: options.plexusStateRoot,
      vibeKanbanPort: options.vibeKanbanPort,
      devNexusPharoMcpPort: options.devNexusPharoMcpPort,
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
      devNexusPharoMcpPort: await askPort(
        "DevNexus-Pharo MCP port",
        defaults.ports.devNexusPharoMcp,
        "--dev-nexus-pharo-mcp-port",
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
  initResult: ReturnType<typeof initNexusHome>,
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

  console.log("DevNexus-Pharo home initialized.");
  console.log(`  Home: ${initResult.homePath}`);
  console.log(`  Config: ${initResult.configPath}`);
  console.log("  Paths:");
  console.log(`    Projects: ${initResult.config.paths.projectsRoot}`);
  console.log(`    Workspaces: ${initResult.config.paths.workspacesRoot}`);
  console.log(`    PLexus state: ${initResult.config.paths.plexusStateRoot}`);
  console.log(`    Control project: ${initResult.config.controlProject.root}`);
  console.log("  Ports:");
  console.log(`    Vibe Kanban: ${initResult.config.ports.vibeKanban}`);
  console.log(`    DevNexus-Pharo MCP: ${initResult.config.ports.devNexusPharoMcp}`);
  console.log(`    PLexus MCP: ${initResult.config.ports.plexusMcp}`);
  console.log("");
  console.log("Next:");
  console.log("  dev-nexus-pharo start");
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
  process.env.DEV_NEXUS_PHARO_HOME = parsed.homePath;
  await runDevNexusPharoMcpServer({
    host: parsed.host ?? config.mcp.host,
    port: parsed.port ?? config.ports.devNexusPharoMcp,
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

type ParsedCodexCommand = ParsedCodexWorkspaceCommand;

function parseCodexCommand(argv: string[]): ParsedCodexCommand {
  const [, command, workspacePath, ...rest] = argv;
  if (command !== "init" && command !== "doctor") {
    throw new Error("codex requires init or doctor");
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

export interface CliContext {}

async function handleCodexCommand(
  argv: string[],
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

  const result = await doctorCodexWorkspace({
    workspacePath: parsed.workspacePath,
    homePath: parsed.homePath,
    timeoutMs: parsed.timeoutMs,
  });
  printCodexDoctorResult(result, parsed.json);
  return result.ok ? 0 : 1;
}

export async function main(argv: string[], _context: CliContext = {}): Promise<number> {
  if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
    console.log(usage());
    return 0;
  }

  if (argv[0] === "init") {
    const parsed = await promptInitCommand(parseInitCommand(argv));
    const initResult = initNexusHome(parsed);
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
    await runDevNexusPharoMcpStdioServer();
    return 0;
  }

  if (argv[0] === "codex") {
    return handleCodexCommand(argv);
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
  return defaultNexusHomePath();
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
  const result = await startDevNexusPharo({
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
  const result = await getDevNexusPharoStatus(parseStatusCommand(argv));
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
  const result = await stopDevNexusPharo({
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
  generic?: boolean;
  json?: boolean;
}

interface ParsedProjectImportCommand {
  homePath: string;
  root: string;
  projectRoot?: string;
  name?: string;
  generic?: boolean;
  json?: boolean;
}

interface ParsedProjectSkillsCommand {
  homePath: string;
  action: "status" | "refresh";
  project: string;
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
      case "--generic":
        parsed.generic = true;
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
      case "--generic":
        parsed.generic = true;
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

  return parsed as ParsedProjectImportCommand;
}

function parseProjectSkillsCommand(argv: string[]): ParsedProjectSkillsCommand {
  const [, command, action, project, ...rest] = argv;
  if (command !== "skills") {
    throw new Error(
      "project requires create, import, skills, list, or status",
    );
  }

  if (action !== "status" && action !== "refresh") {
    throw new Error("project skills requires status or refresh");
  }

  if (!project || project.startsWith("--")) {
    throw new Error(`project skills ${action} requires a project id or path`);
  }

  const parsed: Partial<ParsedProjectSkillsCommand> = {
    homePath: defaultHomePath(),
    action,
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
        throw new Error(`Unknown project skills option: ${arg}`);
    }
  }

  return parsed as ParsedProjectSkillsCommand;
}

function parseProjectListCommand(argv: string[]): ParsedProjectListCommand {
  const [, command, ...rest] = argv;
  if (command !== "list") {
    throw new Error(
      "project requires create, import, list, or status",
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
      "project requires create, import, list, or status",
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
  result: CreateDevNexusPharoProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project created.");
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
  if (result.projectConfig.kanban?.projectId) {
    console.log(`  Vibe Kanban project: ${result.projectConfig.kanban.projectId}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectImportResult(
  result: ImportDevNexusPharoProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project imported.");
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
  if (result.projectConfig.kanban?.projectId) {
    console.log(`  Vibe Kanban project: ${result.projectConfig.kanban.projectId}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printNexusProjectCreateResult(
  result: CreateNexusProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus project created.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  console.log(`  Git: ${result.git.operation}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  if (result.projectConfig.kanban?.projectId) {
    console.log(`  Vibe Kanban project: ${result.projectConfig.kanban.projectId}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printNexusProjectImportResult(
  result: ImportNexusProjectResult,
  json: boolean | undefined,
): void {
  const payload = {
    ok: true,
    ...result,
  };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus project imported.");
  console.log(`  Name: ${result.projectConfig.name}`);
  console.log(`  Id: ${result.projectConfig.id}`);
  console.log(`  Root: ${result.projectRoot}`);
  console.log(`  Config: ${result.projectConfigPath}`);
  console.log(`  Worktrees: ${result.worktreesRoot}`);
  if (result.git.remoteUrl) {
    console.log(`  Remote: ${result.git.remoteUrl}`);
  }
  if (result.git.defaultBranch) {
    console.log(`  Default branch: ${result.git.defaultBranch}`);
  }
  if (result.projectConfig.kanban?.projectId) {
    console.log(`  Vibe Kanban project: ${result.projectConfig.kanban.projectId}`);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectStatus(project: NexusProjectStatus): void {
  console.log(`  ${project.id} (${project.name})`);
  console.log(`    Root: ${project.projectRoot}`);
  console.log(`    Repo origin: ${project.repo?.remoteUrl ?? "(none)"}`);
  console.log(
    `    Default branch: ${project.repo?.defaultBranch ?? "(unknown)"}`,
  );
  console.log(
    `    Work tracker: ${project.workTracking?.provider ?? "(not configured)"}`,
  );
  console.log(
    `    Vibe Kanban project: ${project.vibeKanbanProjectId ?? "(unlinked)"}`,
  );
  console.log(
    `    Vibe Kanban repo: ${project.vibeKanbanRepoId ?? "(unregistered)"}`,
  );
  console.log(`    PLexus config: ${project.plexusProjectConfigPath ?? "(not managed)"}`);
  console.log(`    Worktrees: ${project.worktreesRoot}`);
}

function printProjectListResult(
  result: ListNexusProjectsResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`DevNexus-Pharo projects: ${result.projects.length}`);
  for (const project of result.projects) {
    printProjectStatus(project);
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectStatusResult(
  result: GetNexusProjectStatusResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project status.");
  printProjectStatus(result.project);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function skillStatusSummaryLine(
  summary: ProjectSkillStatusResult["skillStatus"]["summary"],
): string {
  return [
    `expected ${summary.expected}`,
    `installed ${summary.installed}`,
    `missing ${summary.missing}`,
    `stale ${summary.stale}`,
    `unexpected ${summary.unexpected}`,
    `invalid ${summary.invalid}`,
  ].join(", ");
}

function printProjectSkillStatusResult(
  result: ProjectSkillStatusResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project skill status.");
  console.log(`  Project: ${result.project.id} (${result.project.name})`);
  console.log(`  Skills directory: ${result.skillStatus.skillsDirectory}`);
  console.log(`  Summary: ${skillStatusSummaryLine(result.skillStatus.summary)}`);
  for (const skill of result.skillStatus.skills) {
    if (skill.state === "installed") {
      continue;
    }

    console.log(`  ${skill.id}: ${skill.state}`);
    for (const reason of skill.reasons) {
      console.log(`    - ${reason}`);
    }
  }
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

function printProjectSkillRefreshResult(
  result: ProjectSkillRefreshResult,
  json: boolean | undefined,
): void {
  const payload = { ok: true, ...result };
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log("DevNexus-Pharo project skills refreshed.");
  console.log(`  Project: ${result.project.id} (${result.project.name})`);
  console.log(`  Before: ${skillStatusSummaryLine(result.refresh.before.summary)}`);
  console.log(`  After: ${skillStatusSummaryLine(result.refresh.after.summary)}`);
  console.log(`  Materialized: ${result.refresh.materialized.installed.length}`);
  console.log("");
  console.log("JSON:");
  console.log(JSON.stringify(payload, null, 2));
}

async function handleProjectCommand(argv: string[]): Promise<number> {
  const command = argv[1];
  if (command === "create") {
    const parsed = parseProjectCreateCommand(argv);
    if (parsed.generic) {
      const result = createNexusProject(parsed);
      printNexusProjectCreateResult(result, parsed.json);
      return 0;
    }

    const result = createDevNexusPharoProject(parsed);
    printProjectCreateResult(result, parsed.json);
    return 0;
  }

  if (command === "import") {
    const parsed = parseProjectImportCommand(argv);
    if (parsed.generic) {
      const result = importNexusProject(parsed);
      printNexusProjectImportResult(result, parsed.json);
      return 0;
    }

    const result = importDevNexusPharoProject(parsed);
    printProjectImportResult(result, parsed.json);
    return 0;
  }

  if (command === "skills") {
    const parsed = parseProjectSkillsCommand(argv);
    if (parsed.action === "status") {
      const result = getProjectSkillStatus(parsed);
      printProjectSkillStatusResult(result, parsed.json);
      return 0;
    }

    const result = refreshProjectSkills(parsed);
    printProjectSkillRefreshResult(result, parsed.json);
    return 0;
  }

  if (command === "list") {
    const parsed = parseProjectListCommand(argv);
    const result = listNexusProjects({ homePath: parsed.homePath });
    printProjectListResult(result, parsed.json);
    return 0;
  }

  if (command === "status") {
    const parsed = parseProjectStatusCommand(argv);
    const result = getNexusProjectStatus(parsed);
    printProjectStatusResult(result, parsed.json);
    return 0;
  }

  throw new Error(
    "project requires create, import, skills, list, or status",
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
  const result = await installDevNexusPharoAndPlexusMcpForExecutor({
    homePath: parsed.homePath,
    config,
    executor: parsed.executor,
    plexusServerName: parsed.serverName,
    nexusServerName: config.integrations.vibeKanban.nexusMcpServerName,
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
