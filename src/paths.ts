import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Where agents and the model map live. Resolved once, then passed down. */
export interface Paths {
  /** Agent root: one subdirectory per agent. */
  home: string;
  /** Model map file: flat JSON object of template key to model string. */
  models: string;
  /** The user's home directory, for expanding `~` in skill paths. */
  userHome: string;
}

/**
 * Resolve the agent root and model map from flags, then env, then defaults.
 * Only this module reads `AGENT_HOME` / `AGENT_MODELS` / the home directory.
 */
export function resolvePaths(
  overrides: { home?: string; models?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Paths {
  const userHome = homedir();
  const home = resolve(overrides.home ?? env.AGENT_HOME ?? join(userHome, ".agent"));
  const models = resolve(overrides.models ?? env.AGENT_MODELS ?? join(home, "models.json"));
  return { home, models, userHome };
}
