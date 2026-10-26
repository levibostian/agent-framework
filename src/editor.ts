import { spawn } from "node:child_process";
import { waitForExit } from "./process.ts";

/** A command line to run: program plus arguments. */
export interface Launch {
  command: string;
  args: string[];
}

/**
 * The user's editor: `$VISUAL`, then `$EDITOR`. The value is split on whitespace so
 * a configured command such as `code --wait` works. Undefined when neither is set.
 */
export function editorFromEnv(env: NodeJS.ProcessEnv): Launch | undefined {
  const value = env.VISUAL?.trim() || env.EDITOR?.trim();
  if (!value) return undefined;
  const [command, ...args] = value.split(/\s+/);
  return { command: command as string, args };
}

/**
 * OS default opener for a file. Used only when no editor is configured, and given the
 * config file rather than the directory so it lands on something editable.
 */
export function openerFor(platform: NodeJS.Platform, target: string): Launch {
  return platform === "darwin"
    ? { command: "open", args: ["-t", target] }
    : { command: "xdg-open", args: [target] };
}

/** Spawn and wait. stdio is inherited so a terminal editor owns the screen. */
export async function spawnEditor(launch: Launch): Promise<number> {
  const child = spawn(launch.command, launch.args, { stdio: "inherit" });
  return await waitForExit(child, `failed to launch "${launch.command}"`);
}
