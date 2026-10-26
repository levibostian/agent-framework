import { agentDirs, findConfigFiles, loadAgent } from "../config/load.ts";
import { EXIT_CONFIG, EXIT_OK } from "../errors.ts";
import type { Paths } from "../paths.ts";

export interface ListOptions {
  paths: Paths;
  json: boolean;
}

interface ListedAgent {
  name: string;
  description?: string;
  dir: string;
}

/**
 * Print the agents in the root. Read-only: parses config for `description` only and
 * never runs `system-cmd`, resolves models, or touches the network. A broken agent is
 * reported on stderr so it cannot hide the rest; any broken entry means exit 1.
 */
export async function listCommand(options: ListOptions): Promise<number> {
  const agents: ListedAgent[] = [];
  const broken: string[] = [];

  for (const entry of agentDirs(options.paths.home)) {
    if (findConfigFiles(entry.dir).length === 0) continue; // not an agent directory

    try {
      const { config } = loadAgent(options.paths, entry.name);
      const listed: ListedAgent = { name: entry.name, dir: entry.dir };
      if (config.description !== undefined) listed.description = config.description;
      agents.push(listed);
    } catch (error) {
      broken.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const message of broken) {
    process.stderr.write(`agent: broken agent: ${message}\n`);
  }

  if (options.json) {
    process.stdout.write(`${JSON.stringify(agents, null, 2)}\n`);
  } else if (agents.length === 0) {
    if (broken.length === 0) process.stdout.write(`no agents in ${options.paths.home}\n`);
  } else {
    // Names are sorted by `agentDirs`, so the table is stable between runs.
    const width = Math.max(...agents.map((agent) => agent.name.length)) + 3;
    for (const agent of agents) {
      process.stdout.write(`${agent.description === undefined ? agent.name : agent.name.padEnd(width) + agent.description}\n`);
    }
  }

  return broken.length > 0 ? EXIT_CONFIG : EXIT_OK;
}
