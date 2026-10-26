import type { ChildProcess } from "node:child_process";
import { constants } from "node:os";
import { AgentError } from "./errors.ts";

/** Translate a child's exit status into the shell convention: signals become 128 + n. */
export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (signal) return 128 + (constants.signals[signal] ?? 0);
  return code ?? 0;
}

/** Wait for a child, mapping a spawn failure or signal death to an AgentError. */
export function waitForExit(child: ChildProcess, failureMessage: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", (error) => {
      reject(new AgentError(`${failureMessage}: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      resolvePromise(exitCodeOf(code, signal));
    });
  });
}

/** Quote one argv entry so the whole line can be pasted into a shell. */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}
