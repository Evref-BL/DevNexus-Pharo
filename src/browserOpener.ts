import { spawn } from "node:child_process";

export interface BrowserOpenResult {
  url: string;
  opened: boolean;
  command?: string;
  args?: string[];
  error?: string;
}

export type BrowserOpener = (url: string) => Promise<BrowserOpenResult>;

function browserCommand(url: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return {
      command: process.env.COMSPEC ?? "cmd.exe",
      args: ["/d", "/s", "/c", "start", "", url],
    };
  }

  if (process.platform === "darwin") {
    return {
      command: "open",
      args: [url],
    };
  }

  return {
    command: "xdg-open",
    args: [url],
  };
}

export async function openBrowser(url: string): Promise<BrowserOpenResult> {
  const { command, args } = browserCommand(url);

  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });

    child.once("error", (error) => {
      resolve({
        url,
        opened: false,
        command,
        args,
        error: error.message,
      });
    });
    child.once("spawn", () => {
      child.unref();
      resolve({
        url,
        opened: true,
        command,
        args,
      });
    });
  });
}
