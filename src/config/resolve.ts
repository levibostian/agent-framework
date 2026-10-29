import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { AgentError } from "../errors.ts";
import type { Paths } from "../paths.ts";
import type { ResolvedAgent } from "../runtime/types.ts";
import type { LoadedAgent } from "./load.ts";

export interface ResolveOptions {
  /** Working directory for `system-cmd`. Defaults to the caller's directory. */
  cwd?: string;
}

/** Turn a validated config into a fully concrete agent. */
export function resolveAgent(loaded: LoadedAgent, paths: Paths, options: ResolveOptions = {}): ResolvedAgent {
  const { config } = loaded;
  const system = resolveSystemPrompt(config, options.cwd ?? process.cwd());

  const agent: ResolvedAgent = {
    name: loaded.name,
    dir: loaded.dir,
    systemPrompt: system.prompt,
    systemPromptSource: system.source,
    skills: resolveSkills(config.skills, loaded, paths),
    model: resolveModel(config.model, paths.models),
  };
  if (config.description !== undefined) agent.description = config.description;
  if (config.tools !== undefined) agent.tools = [...config.tools];
  if (config.thinking !== undefined) agent.thinking = config.thinking;
  return agent;
}

function resolveSystemPrompt(
  config: LoadedAgent["config"],
  cwd: string,
): { prompt: string; source: ResolvedAgent["systemPromptSource"] } {
  if (config.system !== undefined) return { prompt: config.system, source: "config" };

  const command = config["system-cmd"];
  if (command === undefined) return { prompt: "", source: "none" };

  const result = spawnSync("/bin/sh", ["-c", command], { cwd, encoding: "utf8" });
  if (result.error) {
    throw new AgentError(`system-cmd failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new AgentError(`system-cmd exited with status ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }
  return { prompt: (result.stdout ?? "").trim(), source: "command" };
}

/** Resolve `:key:` against the model map. Anything else is a literal. */
export function resolveModel(model: string, mapPath: string): string {
  // A model value is a template reference only when it is exactly `:key:`.
  const match = /^:(.+):$/.exec(model);
  if (match === null) return model;
  const key = match[1] as string;

  let text: string;
  try {
    text = readFileSync(mapPath, "utf8");
  } catch {
    throw new AgentError(`cannot resolve model ":${key}:": model map not found at ${mapPath}`);
  }

  let map: unknown;
  try {
    map = JSON.parse(text);
  } catch (error) {
    throw new AgentError(
      `failed to parse model map ${mapPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    throw new AgentError(`model map ${mapPath} must be a JSON object of key to model string`);
  }

  const value = (map as Record<string, unknown>)[key];
  if (value === undefined) throw new AgentError(`model key "${key}" not found in ${mapPath}`);
  if (typeof value !== "string") throw new AgentError(`model key "${key}" in ${mapPath} is not a string`);
  return value;
}

function expandHome(entry: string, userHome: string): string {
  if (entry === "~") return userHome;
  if (entry.startsWith("~/")) return join(userHome, entry.slice(2));
  return entry;
}

/** Absolute paths only. Stats each path; never reads or parses skill contents. */
function resolveSkills(entries: string[] | undefined, loaded: LoadedAgent, paths: Paths): string[] {
  return (entries ?? []).map((entry) => {
    const expanded = expandHome(entry, paths.userHome);
    const full = isAbsolute(expanded) ? expanded : resolve(loaded.dir, expanded);
    if (!existsSync(full)) {
      throw new AgentError(`agent "${loaded.name}": skill "${entry}" not found (resolved to ${full})`);
    }
    return full;
  });
}
