import { UsageError } from "./errors.ts";

export type Command = "run" | "list" | "edit";

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

const COMMANDS: readonly string[] = ["run", "list", "edit"];

const VALUE_FLAGS: Record<string, "home" | "models"> = {
  "--home": "home",
  "--models": "models",
};

const USAGE = `Usage:
  agent run <name> [prompt]    Run an agent: one-shot with a prompt, interactive without.
  agent list [--json]          List the agents in the agent root.
  agent edit <name>            Open an agent's directory in your editor.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)
  --dry-run        Print the runtime command instead of running it (run)
  --json           Print machine-readable output (list)
  -h, --help       Show this help`;

const RUN_USAGE = `Usage: agent run [--home <dir>] [--models <file>] [--dry-run] <name> [prompt]`;
const LIST_USAGE = `Usage: agent list [--home <dir>] [--models <file>] [--json]`;
const EDIT_USAGE = `Usage: agent edit [--home <dir>] [--models <file>] <name>`;

/** Top-level help, or help for one command. */
export function helpText(command?: Command): string {
  switch (command) {
    case "run":
      return `${RUN_USAGE}

Run an agent by name. With a prompt the runtime executes one request and exits;
without one it opens an interactive session.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)
  --dry-run        Print the runtime command instead of running it`;
    case "list":
      return `${LIST_USAGE}

List every agent in the agent root with its description. Read-only: never runs an
agent or its system-cmd.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)
  --json           Print [{ name, description, dir }]`;
    case "edit":
      return `${EDIT_USAGE}

Open an agent's directory in $VISUAL or $EDITOR, falling back to the OS opener on
the config file. The config is never parsed or rewritten.

Options:
  --home <dir>     Agent root (default: $AGENT_HOME, else ~/.agent)
  --models <file>  Model map (default: $AGENT_MODELS, else <home>/models.json)`;
    default:
      return USAGE;
  }
}

export function parseArgs(argv: string[]): Args {
  const args: Args = { positionals: [], dryRun: false, json: false, help: false };

  const takeCommand = (token: string): void => {
    if (!COMMANDS.includes(token)) {
      throw new UsageError(`unknown command: ${token}\n\n${USAGE}`);
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
      const valueFlag = VALUE_FLAGS[token];
      if (valueFlag) {
        const value = argv[++i];
        if (value === undefined) throw new UsageError(`${token} requires a value`);
        args[valueFlag] = value;
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
          throw new UsageError(`unknown option: ${token}\n\n${USAGE}`);
      }
    }

    if (args.command === undefined) takeCommand(token);
    else args.positionals.push(token);
  }

  if (args.help) return args;
  if (args.command === undefined) throw new UsageError(`no command given\n\n${USAGE}`);
  validate(args);
  return args;
}

function validate(args: Args): void {
  const command = args.command as Command;

  if (command !== "run" && args.dryRun) {
    throw new UsageError(`--dry-run is only valid for run\n\n${helpText(command)}`);
  }
  if (command !== "list" && args.json) {
    throw new UsageError(`--json is only valid for list\n\n${helpText(command)}`);
  }

  const extra = args.positionals.length;
  if (command === "list") {
    if (extra > 0) throw new UsageError(`list takes no arguments\n\n${LIST_USAGE}`);
    return;
  }
  if (extra === 0) throw new UsageError(`${command} requires an agent name\n\n${helpText(command)}`);
  if (extra > (command === "run" ? 2 : 1)) {
    throw new UsageError(`too many arguments\n\n${helpText(command)}`);
  }
}
