import { AgentError } from "../errors.ts";
import { PiRunner } from "./pi.ts";
import type { Runner } from "./types.ts";

/** The runtime used when no other is requested. */
export const DEFAULT_RUNTIME = "pi";

/** Look up a runtime adapter by name. Adding a runtime means adding a case here. */
export function getRunner(name: string = DEFAULT_RUNTIME): Runner {
  switch (name) {
    case "pi":
      return new PiRunner();
    default:
      throw new AgentError(`unknown runtime "${name}" (available: ${DEFAULT_RUNTIME})`);
  }
}

export type { ResolvedAgent, RunRequest, Runner } from "./types.ts";
