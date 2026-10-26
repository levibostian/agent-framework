import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { editorFromEnv, openerFor } from "../src/editor.ts";
import { cleanupTempDirs, runCli, tempDir, writeAgent, writeFile, writeScript } from "./helpers.ts";

afterAll(cleanupTempDirs);

/** A fake editor that records its argv, then exits with `code`. */
function recordingEditor(dir: string, code: number): { bin: string; record: string } {
  const record = join(dir, "record.txt");
  const bin = writeScript(join(dir, "editor"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\nexit ${code}\n`);
  return { bin, record };
}

function recorded(record: string): string[] {
  return readFileSync(record, "utf8").split("\n").slice(0, -1);
}

describe("agent edit", () => {
  test("passes the agent directory to $EDITOR and propagates its exit code", () => {
    const root = tempDir();
    const agentDir = writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const { bin, record } = recordingEditor(tempDir(), 3);

    const result = runCli(["edit", "hello"], { home: root, env: { EDITOR: bin } });

    expect(result.exitCode).toBe(3);
    expect(recorded(record)).toEqual([agentDir]);
  });

  test("$VISUAL wins over $EDITOR", () => {
    const root = tempDir();
    const agentDir = writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const visual = recordingEditor(tempDir(), 0);
    const editor = recordingEditor(tempDir(), 0);

    const result = runCli(["edit", "hello"], { home: root, env: { VISUAL: visual.bin, EDITOR: editor.bin } });

    expect(result.exitCode).toBe(0);
    expect(recorded(visual.record)).toEqual([agentDir]);
  });

  test("an editor command may carry flags", () => {
    const root = tempDir();
    const agentDir = writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const { bin, record } = recordingEditor(tempDir(), 0);

    runCli(["edit", "hello"], { home: root, env: { EDITOR: `${bin} --wait` } });

    expect(recorded(record)).toEqual(["--wait", agentDir]);
  });

  test("a missing editor binary errors naming the binary", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\n");

    const result = runCli(["edit", "hello"], { home: root, env: { EDITOR: "/nonexistent/editor" } });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("/nonexistent/editor");
  });

  test("with no editor configured it falls back to the OS opener on the config file", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const binDir = tempDir();
    const record = join(binDir, "record.txt");
    const script = `#!/bin/sh\nprintf '%s\\n' "$@" > ${record}\nexit 0\n`;
    writeScript(join(binDir, "open"), script);
    writeScript(join(binDir, "xdg-open"), script);

    const result = runCli(["edit", "hello"], {
      home: root,
      path: `${binDir}:${process.env.PATH}`,
      env: { EDITOR: undefined, VISUAL: undefined },
    });

    expect(result.exitCode).toBe(0);
    const args = recorded(record);
    const configPath = join(root, "hello", "agent.yaml");
    expect(args.at(-1)).toBe(configPath);
    expect(args.slice(0, -1)).toEqual(process.platform === "darwin" ? ["-t"] : []);
  });

  test("a broken config does not stop edit, because editing is how you fix it", () => {
    const root = tempDir();
    const agentDir = writeAgent(root, "hello", "agent.yaml", "model: m\ncolour: red\n");
    const { bin, record } = recordingEditor(tempDir(), 0);

    const result = runCli(["edit", "hello"], { home: root, env: { EDITOR: bin } });

    expect(result.exitCode).toBe(0);
    expect(recorded(record)).toEqual([agentDir]);
  });

  test("an invalid name and an unknown agent fail the same way as run", () => {
    const root = tempDir();
    expect(runCli(["edit", "../escape"], { home: root }).stderr).toContain("invalid agent name");
    expect(runCli(["edit", "ghost"], { home: root }).stderr).toContain(`agent "ghost" not found in ${root}`);
  });

  test("edit never writes to the config", () => {
    const root = tempDir();
    const config = "model: m\n";
    const agentDir = writeAgent(root, "hello", "agent.yaml", config);
    const { bin } = recordingEditor(tempDir(), 0);

    runCli(["edit", "hello"], { home: root, env: { EDITOR: bin } });

    expect(readFileSync(join(agentDir, "agent.yaml"), "utf8")).toBe(config);
  });
});

describe("editorFromEnv", () => {
  test("prefers VISUAL, falls back to EDITOR, and returns undefined when unset", () => {
    expect(editorFromEnv({ VISUAL: "vi", EDITOR: "nano" })).toEqual({ command: "vi", args: [] });
    expect(editorFromEnv({ EDITOR: "nano" })).toEqual({ command: "nano", args: [] });
    expect(editorFromEnv({ VISUAL: "   ", EDITOR: "nano" })).toEqual({ command: "nano", args: [] });
    expect(editorFromEnv({})).toBeUndefined();
  });
});

describe("openerFor", () => {
  test("uses open -t on macOS and xdg-open elsewhere, on the given file", () => {
    expect(openerFor("darwin", "/agents/hello/agent.json")).toEqual({
      command: "open",
      args: ["-t", "/agents/hello/agent.json"],
    });
    expect(openerFor("linux", "/agents/hello/agent.json")).toEqual({
      command: "xdg-open",
      args: ["/agents/hello/agent.json"],
    });
  });
});

describe("edit argument handling", () => {
  test("--home selects the agent root", () => {
    const fromEnv = tempDir();
    const fromFlag = tempDir();
    const agentDir = writeAgent(fromFlag, "hello", "agent.yaml", "model: m\n");
    writeFile(join(fromEnv, "hello", "agent.yaml"), "model: m\n");
    const { bin, record } = recordingEditor(tempDir(), 0);

    runCli(["edit", "--home", fromFlag, "hello"], { home: fromEnv, env: { EDITOR: bin } });

    expect(recorded(record)).toEqual([agentDir]);
  });
});
