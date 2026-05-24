export interface CodexMcpServerConfig {
  type?: string;
  enabled?: boolean;
  required?: boolean;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  defaultToolsApprovalMode?: string;
}

function tomlString(value: string): string {
  return `"${value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")}"`;
}

function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlString).join(", ")}]`;
}

function renderServerBlock(name: string, server: CodexMcpServerConfig): string {
  const lines = [`[mcp_servers.${name}]`];
  if (server.type) {
    lines.push(`type = ${tomlString(server.type)}`);
  }
  if (server.enabled !== undefined) {
    lines.push(`enabled = ${server.enabled ? "true" : "false"}`);
  }
  if (server.required !== undefined) {
    lines.push(`required = ${server.required ? "true" : "false"}`);
  }
  if (server.url) {
    lines.push(`url = ${tomlString(server.url)}`);
  }
  if (server.command) {
    lines.push(`command = ${tomlString(server.command)}`);
  }
  if (server.args) {
    lines.push(`args = ${tomlStringArray(server.args)}`);
  }
  if (server.defaultToolsApprovalMode) {
    lines.push(
      `default_tools_approval_mode = ${tomlString(server.defaultToolsApprovalMode)}`,
    );
  }
  if (server.env && Object.keys(server.env).length > 0) {
    lines.push("", `[mcp_servers.${name}.env]`);
    for (const [key, value] of Object.entries(server.env)) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function isManagedMcpHeader(line: string, managedServerNames: Set<string>): boolean {
  const match = line.match(/^\s*\[(?<name>[^\]]+)\]\s*(?:#.*)?$/u);
  const tableName = match?.groups?.name;
  if (!tableName) {
    return false;
  }

  for (const serverName of managedServerNames) {
    if (
      tableName === `mcp_servers.${serverName}` ||
      tableName.startsWith(`mcp_servers.${serverName}.`)
    ) {
      return true;
    }
  }

  return false;
}

function isTomlHeader(line: string): boolean {
  return /^\s*\[[^\]]+\]\s*(?:#.*)?$/u.test(line);
}

export function mergeCodexMcpServersIntoToml(
  existingToml: string,
  servers: Record<string, CodexMcpServerConfig>,
  extraManagedServerNames: string[] = [],
): string {
  const managedServerNames = new Set([
    ...Object.keys(servers),
    ...extraManagedServerNames,
  ]);
  const keptLines: string[] = [];
  let skippingManagedBlock = false;

  for (const line of existingToml.split(/\r?\n/u)) {
    if (isManagedMcpHeader(line, managedServerNames)) {
      skippingManagedBlock = true;
      continue;
    }

    if (isTomlHeader(line)) {
      skippingManagedBlock = false;
    }

    if (!skippingManagedBlock) {
      keptLines.push(line);
    }
  }

  const preserved = keptLines.join("\n").trimEnd();
  const renderedServers = Object.entries(servers)
    .map(([name, server]) => renderServerBlock(name, server).trimEnd())
    .join("\n\n");

  return `${preserved ? `${preserved}\n\n` : ""}${renderedServers}\n`;
}

export function hasManagedServerSection(toml: string, serverName: string): boolean {
  return toml.split(/\r?\n/u).some((line) => {
    const match = line.match(/^\s*\[(?<name>[^\]]+)\]\s*(?:#.*)?$/u);
    return match?.groups?.name === `mcp_servers.${serverName}`;
  });
}
