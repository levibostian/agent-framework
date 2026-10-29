import { AgentError, EXIT_USAGE } from "./errors.ts";

export type Command = "run" | "list" | "edit" | "spec";

/** Parsed command line. Flags may appear before or after the command and its arguments. */
export interface Args {
  command?: Command;
  positionals: string[];
  home?: string;
  models?: string;
  dryRun: boolean;
  json: boolean;
  help: boolean;
}

const COMMANDS: readonly Command[] = ["run", "list", "edit", "spec"];

const USAGE = `Usage:
  agent run <name> [prompt]    Run an agent: one-shot with a prompt, interactive without.
  agent list [--json]          List the agents in the agent root.
  agent edit <name>            Open an agent's directory in your editor.
  agent spec                   Print the agent spec: what an agent is and how it resolves.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)
  --dry-run        Print the runtime command instead of running it (run)
  --json           Print machine-readable output (list)
  -h, --help       Show this help`;

/** Top-level help, or help for one command. */
export function helpText(command?: Command): string {
  switch (command) {
    case "run":
      return `Usage: agent run [--home <dir>] [--models <file>] [--dry-run] <name> [prompt]

Run an agent by name. With a prompt the runtime executes one request and exits;
without one it opens an interactive session.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)
  --dry-run        Print the runtime command instead of running it`;
    case "list":
      return `Usage: agent list [--home <dir>] [--models <file>] [--json]

List every agent in the agent root with its description. Read-only: never runs an
agent or its system-cmd.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)
  --json           Print [{ name, description, dir }]`;
    case "edit":
      return `Usage: agent edit [--home <dir>] [--models <file>] <name>

Open an agent's directory in $VISUAL or $EDITOR, falling back to the OS opener on
the config file. The config is never parsed or rewritten.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)`;
    case "spec":
      return `Usage: agent spec

Print the agent spec: naming, the config schema and its rules, model and skill
resolution, and the normalized run request. Read-only and offline.`;
    default:
      return USAGE;
  }
}

function usageError(message: string, command?: Command): AgentError {
  return new AgentError(`${message}\n\n${helpText(command)}`, EXIT_USAGE);
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { positionals: [], dryRun: false, json: false, help: false };

  const takeCommand = (token: string): void => {
    if (!COMMANDS.includes(token as Command)) {
      throw usageError(`unknown command: ${token}`);
    }
    args.command = token as Command;
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;

    if (token === "--") {
      for (const rest of argv.slice(i + 1)) {
        if (args.command === undefined) takeCommand(rest);
        else args.positionals.push(rest);
      }
      break;
    }

    if (token.startsWith("-") && token !== "-") {
      if (token === "--home" || token === "--models") {
        const value = argv[++i];
        if (value === undefined) throw usageError(`${token} requires a value`, args.command);
        if (token === "--home") args.home = value;
        else args.models = value;
        continue;
      }
      switch (token) {
        case "--dry-run":
          args.dryRun = true;
          continue;
        case "--json":
          args.json = true;
          continue;
        case "-h":
        case "--help":
          args.help = true;
          continue;
        default:
          throw usageError(`unknown option: ${token}`, args.command);
      }
    }

    if (args.command === undefined) takeCommand(token);
    else args.positionals.push(token);
  }

  if (args.help) return args;
  if (args.command === undefined) throw usageError("no command given");
  validate(args);
  return args;
}

function validate(args: Args): void {
  const command = args.command as Command;

  if (command !== "run" && args.dryRun) {
    throw usageError("--dry-run is only valid for run", command);
  }
  if (command !== "list" && args.json) {
    throw usageError("--json is only valid for list", command);
  }

  const extra = args.positionals.length;
  if (command === "list" || command === "spec") {
    if (extra > 0) throw usageError(`${command} takes no arguments`, command);
    return;
  }
  if (extra === 0) throw usageError(`${command} requires an agent name`, command);
  if (extra > (command === "run" ? 2 : 1)) throw usageError("too many arguments", command);
}
