import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, runCli, tempDir, writeAgent, writeFile } from "./helpers.ts";

afterAll(cleanupTempDirs);

const HELLO = "description: Greets people.\nmodel: m\n";
const QUIET = "model: m\n";

describe("agent list", () => {
  test("prints names aligned to the longest name, with descriptions", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", HELLO);
    writeAgent(root, "reviewer", "agent.yaml", "description: Reviews diffs for correctness.\nmodel: m\n");
    writeAgent(root, "quiet", "agent.yaml", QUIET);

    const result = runCli(["list"], { home: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello      Greets people.\nquiet\nreviewer   Reviews diffs for correctness.\n");
  });

  test("a description-less agent prints its bare name with no trailing spaces", () => {
    const root = tempDir();
    writeAgent(root, "solo", "agent.yaml", QUIET);

    const result = runCli(["list"], { home: root });
    expect(result.stdout).toBe("solo\n");
  });

  test("a directory without a config file is skipped silently", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.json", JSON.stringify({ model: "m", description: "d" }));
    writeFile(join(root, "not-an-agent", "notes.md"), "hi");

    const result = runCli(["list"], { home: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello   d\n");
    expect(result.stderr).toBe("");
  });

  test("a broken agent is reported on stderr without hiding the rest", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", HELLO);
    writeAgent(root, "broken", "agent.yaml", "model: m\ncolour: red\n");

    const result = runCli(["list"], { home: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("hello   Greets people.\n");
    expect(result.stderr).toContain("broken");
    expect(result.stderr).toContain("colour");
  });

  test("--json prints [{ name, description, dir }] and stays parseable when an agent is broken", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", HELLO);
    writeAgent(root, "quiet", "agent.yaml", QUIET);
    writeAgent(root, "broken", "agent.yaml", "nope: true\n");

    const result = runCli(["list", "--json"], { home: root });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual([
      { name: "hello", dir: join(root, "hello"), description: "Greets people." },
      { name: "quiet", dir: join(root, "quiet") },
    ]);
  });

  test("never runs system-cmd and never resolves the model map or skills", () => {
    const root = tempDir();
    const marker = join(root, "system-cmd-ran");
    writeAgent(
      root,
      "hello",
      "agent.yaml",
      `description: Dynamic.\nmodel: ":fast:"\nskills: ["./nope"]\nsystem-cmd: touch ${marker}\n`,
    );

    // No models.json exists and the skill path is missing: list must not care.
    const result = runCli(["list"], { home: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello   Dynamic.\n");
    expect(existsSync(marker)).toBe(false);
  });

  test("an empty root prints the empty message and exits 0", () => {
    const root = tempDir();
    writeFile(join(root, "readme.md"), "no agents here");

    const result = runCli(["list"], { home: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`no agents in ${root}\n`);
  });

  test("a missing root prints the empty message and exits 0", () => {
    const root = join(tempDir(), "does-not-exist");
    const result = runCli(["list"], { home: root });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`no agents in ${root}\n`);
  });

  test("--json on an empty root prints an empty array", () => {
    const root = tempDir();
    expect(runCli(["list", "--json"], { home: root }).stdout).toBe("[]\n");
  });

  test("--home overrides the environment", () => {
    const fromEnv = tempDir();
    const fromFlag = tempDir();
    writeAgent(fromEnv, "env-agent", "agent.yaml", "model: m\n");
    writeAgent(fromFlag, "flag-agent", "agent.yaml", "model: m\n");

    const result = runCli(["list", "--home", fromFlag], { home: fromEnv });
    expect(result.stdout).toBe("flag-agent\n");
  });

  test("a symlinked agent directory is followed", () => {
    const root = tempDir();
    writeAgent(root, "real", "agent.yaml", "description: Real.\nmodel: m\n");
    symlinkSync(join(root, "real"), join(root, "linked"));

    expect(runCli(["list"], { home: root }).stdout).toBe("linked   Real.\nreal     Real.\n");
  });
});

describe("list config file handling", () => {
  test("a directory with two config files is broken, not listed twice", () => {
    const root = tempDir();
    writeAgent(root, "both", "agent.json", JSON.stringify({ model: "m", description: "d" }));
    writeFile(join(root, "both", "agent.yaml"), "model: m\n");

    const result = runCli(["list"], { home: root });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("multiple config files");
  });

  test("a folded yaml description prints on one line", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\ndescription: >-\n  one\n  two\n");
    expect(runCli(["list"], { home: root }).stdout).toBe("hello   one two\n");
  });
});
