import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, runCli, tempDir, writeAgent, writeFile, writeModelMap, writeScript } from "./helpers.ts";

afterAll(cleanupTempDirs);

const HELLO = "description: Greets people.\nsystem: You are terse.\ntools: [bash, read]\nmodel: ':fast:'\n";

/**
 * A directory holding a fake `pi` that records its argv to `record` and exits with
 * `code`. Returned as a directory so it can be prepended to PATH, which keeps the
 * real runtime out of reach of the tests.
 */
function fakePi(record: string, code = 0): string {
  const dir = tempDir();
  writeScript(join(dir, "pi"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\nexit ${code}\n`);
  return dir;
}

function recorded(record: string): string[] {
  return readFileSync(record, "utf8").split("\n").slice(0, -1);
}

/** Put a fake-runtime directory ahead of PATH so no test can reach the real runtime. */
function sandboxedPath(binDir: string): string {
  return `${binDir}:${process.env.PATH ?? ""}`;
}

describe("agent run", () => {
  test("--dry-run prints the runtime command without spawning it", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", HELLO);
    const models = writeModelMap(root, { fast: "openrouter/google/gemini-2.5-flash" });
    const record = join(root, "record.txt");
    const binDir = tempDir();
    writeScript(join(binDir, "pi"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\n`);

    const result = runCli(["run", "--dry-run", "hello", "say hi"], {
      home: root,
      models,
      path: sandboxedPath(binDir),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "pi --print --model openrouter/google/gemini-2.5-flash --system-prompt 'You are terse.' --tools bash,read -- 'say hi'\n",
    );
    expect(existsSync(record)).toBe(false);
  });

  test("the spawned argv matches what --dry-run printed", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", HELLO);
    const models = writeModelMap(root, { fast: "openrouter/google/gemini-2.5-flash" });
    const record = join(root, "record.txt");
    const bin = fakePi(record);

    const result = runCli(["run", "hello", "say hi"], { home: root, models, path: sandboxedPath(bin) });

    expect(result.exitCode).toBe(0);
    expect(recorded(record)).toEqual([
      "--print",
      "--model",
      "openrouter/google/gemini-2.5-flash",
      "--system-prompt",
      "You are terse.",
      "--tools",
      "bash,read",
      "--",
      "say hi",
    ]);
  });

  test("the runtime's exit code is propagated", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const bin = fakePi(join(root, "record.txt"), 7);

    const result = runCli(["run", "hello", "hi"], { home: root, path: sandboxedPath(bin) });

    expect(result.exitCode).toBe(7);
  });

  test("no prompt means interactive: no --print and no trailing prompt", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\nsystem: Be terse.\n");
    const record = join(root, "record.txt");
    const bin = fakePi(record);

    runCli(["run", "hello"], { home: root, path: sandboxedPath(bin) });

    expect(recorded(record)).toEqual(["--model", "m", "--system-prompt", "Be terse."]);
  });

  test("a prompt starting with a dash is passed after --", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const record = join(root, "record.txt");
    const bin = fakePi(record);

    runCli(["run", "hello", "--", "--explain this"], { home: root, path: sandboxedPath(bin) });

    expect(recorded(record)).toEqual(["--print", "--model", "m", "--", "--explain this"]);
  });

  test("an empty tools list becomes --no-tools and skills become --skill flags", () => {
    const root = tempDir();
    const agentDir = writeAgent(root, "hello", "agent.yaml", "model: m\ntools: []\nskills: ['./skills/a', './skills/b']\n");
    for (const name of ["a", "b"]) {
      writeScript(join(agentDir, "skills", name, "SKILL.md"), "---\nname: x\n---\n");
    }
    const record = join(root, "record.txt");
    const bin = fakePi(record);

    runCli(["run", "hello", "hi"], { home: root, path: sandboxedPath(bin) });

    expect(recorded(record)).toEqual([
      "--print",
      "--model",
      "m",
      "--no-tools",
      "--skill",
      join(agentDir, "skills", "a"),
      "--skill",
      join(agentDir, "skills", "b"),
      "--",
      "hi",
    ]);
  });

  test("system-cmd runs in the caller's directory, not the agent directory", () => {
    const root = tempDir();
    const agentDir = writeAgent(root, "hello", "agent.yaml", "model: m\nsystem-cmd: cat marker.txt\n");
    writeFile(join(agentDir, "marker.txt"), "agent directory");
    const cwd = tempDir();
    writeFile(join(cwd, "marker.txt"), "caller directory");
    const record = join(root, "record.txt");
    const bin = fakePi(record);

    runCli(["run", "hello", "hi"], { home: root, path: sandboxedPath(bin), cwd });

    expect(recorded(record)).toEqual(["--print", "--model", "m", "--system-prompt", "caller directory", "--", "hi"]);
  });
});

describe("agent run failures", () => {
  test("an unknown agent exits 1 with an actionable message", () => {
    const root = tempDir();
    const result = runCli(["run", "ghost", "hi"], { home: root });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(`agent: agent "ghost" not found in ${root}\n`);
  });

  test("an invalid name exits 1 before touching the filesystem", () => {
    const result = runCli(["run", "../escape", "hi"], { home: "/nonexistent" });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("invalid agent name");
  });

  test("a config error exits 1 and names the config file", () => {
    const root = tempDir();
    const dir = writeAgent(root, "hello", "agent.yaml", "model: m\ncolour: red\n");
    const result = runCli(["run", "hello", "hi"], { home: root });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(join(dir, "agent.yaml"));
    expect(result.stderr).toContain("colour");
  });

  test("an unresolvable model template exits 1", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: ':fast:'\n");
    const result = runCli(["run", "hello", "hi"], { home: root, models: join(root, "models.json") });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(":fast:");
  });

  test("a failing system-cmd exits 1 with its stderr", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\nsystem-cmd: 'echo boom >&2; exit 4'\n");
    const result = runCli(["run", "hello", "hi"], { home: root });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("boom");
  });

  test("a missing skill path exits 1 and names the entry", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\nskills: ['./nope']\n");
    const result = runCli(["run", "hello", "hi"], { home: root });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("./nope");
  });

  test("a missing runtime binary exits 1 and names it", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const binDir = tempDir();

    const result = runCli(["run", "hello", "hi"], { home: root, path: binDir });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pi");
  });

  test("a usage error exits 2", () => {
    expect(runCli(["run"]).exitCode).toBe(2);
    expect(runCli(["run", "--nope", "a"]).exitCode).toBe(2);
    expect(runCli([]).exitCode).toBe(2);
    expect(runCli(["list", "--dry-run"]).exitCode).toBe(2);
  });

  test("--help exits 0 for every command", () => {
    for (const args of [["--help"], ["run", "--help"], ["list", "--help"], ["edit", "--help"]]) {
      const result = runCli(args);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Usage");
    }
  });
});
