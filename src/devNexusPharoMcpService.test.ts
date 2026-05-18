import process from "node:process";
import { describe, expect, it } from "vitest";
import { devNexusPharoCliEntrypointPath } from "./config.js";
import {
  buildDevNexusPharoMcpServiceArgs,
  DevNexusPharoMcpServiceError,
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

  it("rejects bare dev-nexus-pharo commands with a regeneration error", () => {
    expect(() => resolveDevNexusPharoMcpServiceCommand("dev-nexus-pharo", []))
      .toThrow(DevNexusPharoMcpServiceError);
    expect(() => resolveDevNexusPharoMcpServiceCommand("dev-nexus-pharo", []))
      .toThrow(/obsolete bare command.*Regenerate/);
  });
});
