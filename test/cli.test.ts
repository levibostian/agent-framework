import { describe, expect, test } from "bun:test";
import { helpText, parseArgs } from "../src/cli.ts";
import { AgentError, EXIT_USAGE } from "../src/errors.ts";

function usageError(...argv: string[]): AgentError {
  try {
    parseArgs(argv);
  } catch (error) {
    if (error instanceof AgentError) return error;
    throw error;
  }
  throw new Error(`expected a usage error for: ${argv.join(" ")}`);
}

describe("parseArgs", () => {
  test("run takes a name and an optional prompt", () => {
    const args = parseArgs(["run", "hello", "say hi"]);
    expect(args.command).toBe("run");
    expect(args.positionals).toEqual(["hello", "say hi"]);
    expect(args.dryRun).toBe(false);
  });

  test("flags may come before the command", () => {
    const args = parseArgs(["--home", "/tmp/a", "--models", "/tmp/m.json", "list", "--json"]);
    expect(args.command).toBe("list");
    expect(args.home).toBe("/tmp/a");
    expect(args.models).toBe("/tmp/m.json");
    expect(args.json).toBe(true);
  });

  test("-- ends flag parsing, so a prompt may start with a dash", () => {
    const args = parseArgs(["run", "hello", "--", "--weird prompt"]);
    expect(args.positionals).toEqual(["hello", "--weird prompt"]);
  });

  test("a single dash is a positional", () => {
    expect(parseArgs(["run", "hello", "-"]).positionals).toEqual(["hello", "-"]);
  });

  test("--help with no command reports no command", () => {
    const args = parseArgs(["--help"]);
    expect(args.help).toBe(true);
    expect(args.command).toBeUndefined();
  });

  test("--help after a command keeps the command", () => {
    expect(parseArgs(["run", "--help"]).command).toBe("run");
  });

  test("every command help is non-empty and names its command", () => {
    for (const command of ["run", "list", "edit", "spec"] as const) {
      expect(helpText(command)).toContain(`agent ${command}`);
    }
  });

  test("unknown command, unknown option and a missing value are usage errors", () => {
    expect(usageError("frobnicate").exitCode).toBe(EXIT_USAGE);
    expect(usageError("run", "--nope", "hello").message).toContain("--nope");
    expect(usageError("run", "--home").message).toContain("--home requires a value");
  });

  test("missing and extra arguments are usage errors", () => {
    expect(usageError().message).toContain("no command given");
    expect(usageError("run").message).toContain("requires an agent name");
    expect(usageError("run", "a", "b", "c").message).toContain("too many arguments");
    expect(usageError("list", "hello").message).toContain("takes no arguments");
    expect(usageError("spec", "hello").message).toContain("takes no arguments");
    expect(usageError("edit").message).toContain("requires an agent name");
    expect(usageError("edit", "a", "b").message).toContain("too many arguments");
  });

  test("command-specific flags are rejected elsewhere", () => {
    expect(usageError("list", "--dry-run").message).toContain("--dry-run is only valid for run");
    expect(usageError("run", "--json", "a").message).toContain("--json is only valid for list");
    expect(usageError("spec", "--dry-run").message).toContain("--dry-run is only valid for run");
    expect(usageError("spec", "--json").message).toContain("--json is only valid for list");
  });
});
