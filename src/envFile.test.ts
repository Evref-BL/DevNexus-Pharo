import { describe, expect, it } from "vitest";
import { readEnvValue, setEnvValue, stripUtf8Bom } from "./envFile.js";

describe("env file helpers", () => {
  it("reads simple CRLF env values after removing an optional UTF-8 BOM", () => {
    const content = stripUtf8Bom(
      "\uFEFFFIRST=value-1\r\nSECOND=value-2\r\n",
    );

    expect(readEnvValue(content, "FIRST")).toBe("value-1");
    expect(readEnvValue(content, "SECOND")).toBe("value-2");
    expect(readEnvValue(content, "MISSING")).toBeUndefined();
  });

  it("updates existing values and reports whether content changed", () => {
    expect(setEnvValue("NAME=old\n", "NAME", "new")).toEqual({
      content: "NAME=new\n",
      changed: true,
    });

    expect(setEnvValue("NAME=new\n", "NAME", "new")).toEqual({
      content: "NAME=new\n",
      changed: false,
    });
  });

  it("inserts missing values before a trailing empty line", () => {
    expect(setEnvValue("FIRST=value\n", "SECOND", "next")).toEqual({
      content: "FIRST=value\nSECOND=next\n",
      changed: true,
    });
  });
});
