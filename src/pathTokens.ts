export interface SafePathTokenOptions {
  allowDot?: boolean;
  fallback?: string;
  lowercase?: boolean;
}

export function safePathToken(
  value: string,
  options: SafePathTokenOptions = {},
): string {
  let safe = "";
  let previousWasSeparator = false;

  for (const rawChar of value.trim()) {
    const char = options.lowercase ? rawChar.toLowerCase() : rawChar;
    const allowed =
      (char >= "A" && char <= "Z") ||
      (char >= "a" && char <= "z") ||
      (char >= "0" && char <= "9") ||
      char === "_" ||
      char === "-" ||
      Boolean(options.allowDot && char === ".");
    if (allowed) {
      safe += char;
      previousWasSeparator = false;
      continue;
    }

    if (!previousWasSeparator) {
      safe += "-";
      previousWasSeparator = true;
    }
  }

  while (safe.startsWith("-")) {
    safe = safe.slice(1);
  }
  while (safe.endsWith("-")) {
    safe = safe.slice(0, -1);
  }

  return safe || options.fallback || "";
}
