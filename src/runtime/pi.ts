import { spawn } from "node:child_process";
import { AgentError } from "../errors.ts";
import { shellQuote, waitForExit } from "../process.ts";
import type { RunRequest, Runner } from "./types.ts";

/** Pi's thinking levels. Pi silently ignores an unknown level, so the adapter checks it. */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

/**
 * Runs an agent on Pi by spawning `pi` as a subprocess. All Pi-specific knowledge
 * lives here: the spec layer hands over a ResolvedAgent and knows nothing else.
 */
export class PiRunner implements Runner {
  constructor(private readonly command: string = "pi") {}

  buildArgv(request: RunRequest): string[] {
    const { agent, prompt } = request;
    const argv: string[] = [];

    if (prompt !== undefined) argv.push("--print");
    argv.push("--model", agent.model);
    if (agent.thinking !== undefined) argv.push("--thinking", checkThinkingLevel(agent.thinking, agent.name));
    if (agent.systemPrompt !== "") argv.push("--system-prompt", agent.systemPrompt);
    if (agent.tools !== undefined) {
      // An empty list means no tools; an absent field means the runtime's default set.
      if (agent.tools.length === 0) argv.push("--no-tools");
      else argv.push("--tools", agent.tools.join(","));
    }
    for (const skill of agent.skills) argv.push("--skill", skill);
    if (prompt !== undefined) argv.push("--", prompt);

    return argv;
  }

  describe(request: RunRequest): string {
    return [this.command, ...this.buildArgv(request)].map(shellQuote).join(" ");
  }

  async run(request: RunRequest): Promise<number> {
    const argv = this.buildArgv(request);
    const child = spawn(this.command, argv, { stdio: "inherit" });
    return await waitForExit(child, `failed to run "${this.command}"`);
  }
}

/**
 * Reject a level Pi would only warn about. Pi exits 0 on an unknown level and falls back
 * to its default, which would turn a typo into a silently different agent.
 */
function checkThinkingLevel(level: string, agentName: string): string {
  if (!(THINKING_LEVELS as readonly string[]).includes(level)) {
    throw new AgentError(
      `agent "${agentName}": unknown thinking level "${level}" (valid: ${THINKING_LEVELS.join(", ")})`,
    );
  }
  return level;
}
