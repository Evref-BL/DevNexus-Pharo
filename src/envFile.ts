export interface SetEnvValueResult {
  content: string;
  changed: boolean;
}

export function stripUtf8Bom(content: string): string {
  return content.replace(/^\uFEFF/u, "");
}

export function readEnvValue(content: string, key: string): string | undefined {
  const prefix = `${key}=`;
  const line = content
    .split(/\r?\n/u)
    .find((entry) => entry.startsWith(prefix));

  return line?.slice(prefix.length);
}

export function setEnvValue(
  content: string,
  key: string,
  value: string,
): SetEnvValueResult {
  const lines = content.split(/\r?\n/u);
  const prefix = `${key}=`;
  let changed = false;
  let found = false;

  const updatedLines = lines.map((line) => {
    if (!line.startsWith(prefix)) {
      return line;
    }

    found = true;
    const nextLine = `${prefix}${value}`;
    if (line !== nextLine) {
      changed = true;
    }

    return nextLine;
  });

  if (!found) {
    const insertAt =
      updatedLines.at(-1) === "" ? updatedLines.length - 1 : updatedLines.length;
    updatedLines.splice(insertAt, 0, `${prefix}${value}`);
    changed = true;
  }

  return {
    content: updatedLines.join("\n"),
    changed,
  };
}
