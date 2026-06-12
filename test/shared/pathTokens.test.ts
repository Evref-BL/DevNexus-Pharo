import { describe, expect, it } from "vitest";

import { safePathToken } from "../../src/pathTokens.js";

describe("safePathToken", () => {
  it("collapses unsafe path characters and trims generated separators", () => {
    expect(safePathToken(" repo path / main ", { fallback: "fallback" })).toBe(
      "repo-path-main",
    );
  });

  it("supports dots when requested", () => {
    expect(
      safePathToken(" Project.Root / main ", {
        allowDot: true,
        fallback: "fallback",
      }),
    ).toBe("Project.Root-main");
  });

  it("lowercases tokens when requested", () => {
    expect(
      safePathToken(" Project Root ", {
        fallback: "fallback",
        lowercase: true,
      }),
    ).toBe("project-root");
  });

  it("uses the fallback when no safe path characters remain", () => {
    expect(safePathToken(" /  ", { fallback: "fallback" })).toBe("fallback");
  });
});
