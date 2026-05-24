import process from "node:process";
import { defaultNexusHomePath, loadHomeConfig } from "./config.js";
import {
  getDevNexusPharoStatus,
  startDevNexusPharo,
  stopDevNexusPharo,
} from "./devNexusPharoRuntime.js";
import {
  runDevNexusPharoMcpServer,
  runDevNexusPharoMcpStdioServer,
} from "./mcpServer.js";
import {
  getPlexusGatewayStatus,
  startPlexusGateway,
  stopPlexusGateway,
} from "./plexusGatewayService.js";

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

export async function handleMcpCommand(argv: string[]): Promise<number> {
  const parsed = parseMcpCommand(argv);
  const config = loadHomeConfig(parsed.homePath);
  process.env.DEV_NEXUS_PHARO_HOME = parsed.homePath;
  await runDevNexusPharoMcpServer({
    host: parsed.host ?? config.mcp.host,
    port: parsed.port ?? config.ports.devNexusPharoMcp,
  });
  return 0;
}
export async function handleMcpStdioCommand(): Promise<number> {
  await runDevNexusPharoMcpStdioServer();
  return 0;
}
interface ParsedStartCommand {
  homePath: string;
  force?: boolean;
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

export async function handleStartCommand(argv: string[]): Promise<number> {
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

export async function handleStatusCommand(argv: string[]): Promise<number> {
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

export async function handleStopCommand(argv: string[]): Promise<number> {
  const result = await stopDevNexusPharo({
    ...parseStopCommand(argv),
    progress: printProgress,
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  return 0;
}

export async function handlePlexusGatewayCommand(argv: string[]): Promise<number> {
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
