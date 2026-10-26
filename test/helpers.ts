import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const tempDirs: string[] = [];

/** A fresh temp directory, removed by `cleanupTempDirs`. */
export function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "agent-test-"));
  tempDirs.push(dir);
  return dir;
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
  tempDirs.length = 0;
}

export function writeFile(path: string, contents: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

/** Create an agent directory under `root` holding one config file. */
export function writeAgent(root: string, name: string, file: string, contents: string): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFile(join(dir, file), contents);
  return dir;
}

export function writeModelMap(root: string, map: Record<string, unknown>): string {
  return writeFile(join(root, "models.json"), JSON.stringify(map));
}

/** An executable shell script, for standing in as `pi` or as an editor. */
export function writeScript(path: string, contents: string): string {
  writeFile(path, contents);
  chmodSync(path, 0o755);
  return path;
}

export interface CliOptions {
  home?: string;
  models?: string;
  cwd?: string;
  /** Replaces `PATH`, for standing in a fake runtime binary. */
  path?: string;
  env?: Record<string, string | undefined>;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Run the real CLI in a child process. Agent env vars and editor vars are cleared
 * first, so a test never touches the user's real agents or opens their editor.
 */
export function runCli(args: string[], options: CliOptions = {}): CliResult {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  delete env.AGENT_HOME;
  delete env.AGENT_MODELS;
  delete env.VISUAL;
  delete env.EDITOR;

  if (options.home !== undefined) env.AGENT_HOME = options.home;
  if (options.models !== undefined) env.AGENT_MODELS = options.models;
  if (options.path !== undefined) env.PATH = options.path;
  for (const [key, value] of Object.entries(options.env ?? {})) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }

  const result = Bun.spawnSync({
    cmd: [process.execPath, join(import.meta.dir, "..", "src", "index.ts"), ...args],
    env,
    cwd: options.cwd ?? process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}
