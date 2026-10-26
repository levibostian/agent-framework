import { loadAgent } from "../config/load.ts";
import { resolveAgent } from "../config/resolve.ts";
import { EXIT_OK } from "../errors.ts";
import type { Paths } from "../paths.ts";
import { getRunner } from "../runtime/index.ts";

export interface RunOptions {
  paths: Paths;
  name: string;
  /** Absent means interactive. */
  prompt?: string;
  dryRun: boolean;
}

export async function runCommand(options: RunOptions): Promise<number> {
  const agent = resolveAgent(loadAgent(options.paths, options.name), options.paths);
  const runner = getRunner();
  const request = { agent, prompt: options.prompt };

  if (options.dryRun) {
    process.stdout.write(`${runner.describe(request)}\n`);
    return EXIT_OK;
  }
  return await runner.run(request);
}
