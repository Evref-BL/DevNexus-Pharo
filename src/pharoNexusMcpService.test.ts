import process from "node:process";
import { describe, expect, it } from "vitest";
import { pharoNexusCliEntrypointPath } from "./config.js";
import {
  buildPharoNexusMcpServiceArgs,
  resolvePharoNexusMcpServiceCommand,
} from "./pharoNexusMcpService.js";

describe("PharoNexus MCP service", () => {
  it("uses explicit MCP mode for the PharoNexus CLI entrypoint", () => {
    const entrypoint = pharoNexusCliEntrypointPath();

    expect(buildPharoNexusMcpServiceArgs(process.execPath, [entrypoint])).toEqual([
      entrypoint,
      "mcp",
    ]);
    expect(
      buildPharoNexusMcpServiceArgs(process.execPath, [entrypoint, "mcp"]),
    ).toEqual([entrypoint, "mcp"]);
  });

  it("resolves legacy bare pharo-nexus commands to the current node entrypoint", () => {
    expect(resolvePharoNexusMcpServiceCommand("pharo-nexus", [])).toEqual({
      command: process.execPath,
      args: [pharoNexusCliEntrypointPath(), "mcp"],
    });
    expect(resolvePharoNexusMcpServiceCommand("pharo-nexus", ["mcp"])).toEqual({
      command: process.execPath,
      args: [pharoNexusCliEntrypointPath(), "mcp"],
    });
  });
});
