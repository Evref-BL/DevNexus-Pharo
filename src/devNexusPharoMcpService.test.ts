import process from "node:process";
import { describe, expect, it } from "vitest";
import { devNexusPharoCliEntrypointPath } from "./config.js";
import {
  buildDevNexusPharoMcpServiceArgs,
  resolveDevNexusPharoMcpServiceCommand,
} from "./devNexusPharoMcpService.js";

describe("DevNexus-Pharo MCP service", () => {
  it("uses explicit MCP mode for the DevNexus-Pharo CLI entrypoint", () => {
    const entrypoint = devNexusPharoCliEntrypointPath();

    expect(buildDevNexusPharoMcpServiceArgs(process.execPath, [entrypoint])).toEqual([
      entrypoint,
      "mcp",
    ]);
    expect(
      buildDevNexusPharoMcpServiceArgs(process.execPath, [entrypoint, "mcp"]),
    ).toEqual([entrypoint, "mcp"]);
  });

  it("resolves legacy bare dev-nexus-pharo commands to the current node entrypoint", () => {
    expect(resolveDevNexusPharoMcpServiceCommand("dev-nexus-pharo", [])).toEqual({
      command: process.execPath,
      args: [devNexusPharoCliEntrypointPath(), "mcp"],
    });
    expect(resolveDevNexusPharoMcpServiceCommand("dev-nexus-pharo", ["mcp"])).toEqual({
      command: process.execPath,
      args: [devNexusPharoCliEntrypointPath(), "mcp"],
    });
  });
});
