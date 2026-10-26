import type { ChildProcess } from "node:child_process";
import { constants } from "node:os";
import { AgentError } from "./errors.ts";

/** Wait for a child, mapping a spawn failure or signal death to an AgentError. */
export function waitForExit(child: ChildProcess, failureMessage: string): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    child.once("error", (error) => {
      reject(new AgentError(`${failureMessage}: ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      // Shell convention: a signal death is reported as 128 + signal.
      resolvePromise(signal ? 128 + (constants.signals[signal] ?? 0) : (code ?? 0));
    });
  });
}

/** Quote one argv entry so the whole line can be pasted into a shell. */
export function shellQuote(arg: string): string {
  if (arg === "") return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replaceAll("'", "'\\''")}'`;
}
