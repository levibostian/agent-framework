import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { AgentError } from "../errors.ts";
import type { Paths } from "../paths.ts";
import { validateConfig, type AgentConfig } from "./schema.ts";

/** Config file names, in the order they are reported when more than one exists. */
export const CONFIG_FILES = ["agent.json", "agent.yaml", "agent.yml"] as const;

const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

/** Reject anything that could escape the agent root, before touching the filesystem. */
export function validateName(name: string): void {
  if (!NAME_PATTERN.test(name) || name === "." || name === "..") {
    throw new AgentError(
      `invalid agent name "${name}": use letters, digits, ".", "_" and "-" only`,
    );
  }
}

export function agentDir(paths: Paths, name: string): string {
  return join(paths.home, name);
}

function isDirectory(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** Validate the name and return the agent directory, or throw the standard not-found error. */
export function requireAgentDir(paths: Paths, name: string): string {
  validateName(name);
  const dir = agentDir(paths, name);
  if (!isDirectory(dir)) {
    throw new AgentError(`agent "${name}" not found in ${paths.home}`);
  }
  return dir;
}

/** The config files present in a directory. Empty when the directory is not an agent. */
export function findConfigFiles(dir: string): string[] {
  return CONFIG_FILES.map((file) => join(dir, file)).filter((path) => {
    return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;
  });
}

/** The one config file in an agent directory. Errors on zero or more than one. */
export function configFilePath(dir: string): string {
  const found = findConfigFiles(dir);
  if (found.length === 0) {
    throw new AgentError(`no config file in ${dir} (expected one of ${CONFIG_FILES.join(", ")})`);
  }
  if (found.length > 1) {
    const names = found.map((path) => basename(path)).join(", ");
    throw new AgentError(`multiple config files in ${dir}: ${names} (keep exactly one)`);
  }
  return found[0] as string;
}

function parseConfigFile(path: string): unknown {
  const text = readFileSync(path, "utf8");
  try {
    return path.endsWith(".json") ? JSON.parse(text) : parseYaml(text);
  } catch (error) {
    throw new AgentError(`failed to parse ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface LoadedAgent {
  name: string;
  dir: string;
  configPath: string;
  config: AgentConfig;
}

/** Locate, parse and validate one agent by name. Does not resolve symbolic values. */
export function loadAgent(paths: Paths, name: string): LoadedAgent {
  const dir = requireAgentDir(paths, name);
  const configPath = configFilePath(dir);
  const config = validateConfig(parseConfigFile(configPath), configPath);
  return { name, dir, configPath, config };
}

export interface AgentDirEntry {
  name: string;
  dir: string;
}

/** Immediate subdirectories of the agent root, sorted by name. Empty when unreadable. */
export function agentDirs(root: string): AgentDirEntry[] {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => {
      if (entry.isDirectory()) return true;
      // Follow symlinks, so an agent can be linked into the root.
      return entry.isSymbolicLink() && isDirectory(join(root, entry.name));
    })
    .map((entry) => ({ name: entry.name, dir: join(root, entry.name) }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
