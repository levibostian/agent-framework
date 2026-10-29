#!/usr/bin/env bun
import { parseArgs, helpText } from "./cli.ts";
import { editCommand } from "./commands/edit.ts";
import { listCommand } from "./commands/list.ts";
import { runCommand } from "./commands/run.ts";
import { specCommand } from "./commands/spec.ts";
import { AgentError, EXIT_CONFIG, EXIT_OK } from "./errors.ts";
import { resolvePaths } from "./paths.ts";

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);

  if (args.help) {
    process.stdout.write(`${helpText(args.command)}\n`);
    return EXIT_OK;
  }

  if (args.command === "spec") return specCommand();

  const paths = resolvePaths({ home: args.home, models: args.models });

  switch (args.command) {
    case "run":
      return runCommand({ paths, name: args.positionals[0] as string, prompt: args.positionals[1], dryRun: args.dryRun });
    case "list":
      return listCommand({ paths, json: args.json });
    case "edit":
      return editCommand({ paths, name: args.positionals[0] as string });
    default:
      return EXIT_OK;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    if (error instanceof AgentError) {
      process.stderr.write(`agent: ${error.message}\n`);
      process.exitCode = error.exitCode;
    } else {
      process.stderr.write(`agent: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = EXIT_CONFIG;
    }
  }
}
