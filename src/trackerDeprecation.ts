export type LegacyTrackerWrapperCommand =
  | "configure-tracker"
  | "link-tracker"
  | "sync-tracker";

export interface LegacyTrackerWrapperDeprecation {
  id: "dev-nexus-pharo-legacy-tracker-wrapper";
  status: "deprecated";
  command: string;
  message: string;
  replacement: string;
}

const trackerWrapperGuidance: Record<
  LegacyTrackerWrapperCommand,
  { message: string; replacement: string }
> = {
  "configure-tracker": {
    message:
      "Generic project tracker configuration belongs to DevNexus core; DevNexus-Pharo keeps this wrapper for compatibility only.",
    replacement: "dev-nexus project tracker configure",
  },
  "link-tracker": {
    message:
      "Generic project tracker linking belongs to DevNexus core; DevNexus-Pharo keeps this wrapper for legacy Vibe Kanban project id compatibility only.",
    replacement: "dev-nexus project tracker link",
  },
  "sync-tracker": {
    message:
      "Generic project work tracking belongs to DevNexus core; DevNexus-Pharo keeps this wrapper only for legacy Vibe Kanban repo/board registration.",
    replacement: "dev-nexus project tracker configure/link for generic tracking",
  },
};

export function legacyTrackerWrapperDeprecation(
  command: LegacyTrackerWrapperCommand,
): LegacyTrackerWrapperDeprecation {
  const guidance = trackerWrapperGuidance[command];

  return {
    id: "dev-nexus-pharo-legacy-tracker-wrapper",
    status: "deprecated",
    command: `dev-nexus-pharo project ${command}`,
    message: guidance.message,
    replacement: guidance.replacement,
  };
}

export function legacyTrackerWrapperNotice(
  command: LegacyTrackerWrapperCommand,
): string {
  const deprecation = legacyTrackerWrapperDeprecation(command);

  return [
    `Deprecated: ${deprecation.command} is a legacy compatibility wrapper.`,
    deprecation.message,
    `Use ${deprecation.replacement}.`,
  ].join(" ");
}

export function legacyTrackerWrapperToolDescription(
  command: LegacyTrackerWrapperCommand,
): string {
  const deprecation = legacyTrackerWrapperDeprecation(command);

  return [
    `Legacy compatibility wrapper for ${deprecation.command}.`,
    deprecation.message,
    `Use ${deprecation.replacement}.`,
  ].join(" ");
}
