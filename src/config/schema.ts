import { AgentError } from "../errors.ts";

/** A validated agent config, straight from disk. Symbolic values are not yet resolved. */
export interface AgentConfig {
  description?: string;
  system?: string;
  "system-cmd"?: string;
  tools?: string[];
  skills?: string[];
  model: string;
}

const KNOWN_KEYS = ["description", "system", "system-cmd", "tools", "skills", "model"] as const;

function fail(source: string, message: string): never {
  throw new AgentError(`${source}: ${message}`);
}

function optionalString(value: unknown, key: string, source: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") fail(source, `"${key}" must be a string`);
  return value;
}

function optionalStringArray(value: unknown, key: string, source: string): string[] | undefined {
  if (value === undefined) return undefined;
  const notStrings = `"${key}" must be an array of strings`;
  if (!Array.isArray(value)) fail(source, notStrings);
  return value.map((item) => {
    if (typeof item !== "string") fail(source, notStrings);
    return item;
  });
}

/**
 * Validate raw parsed config. Unknown keys are an error: a typo must not silently
 * produce a different agent. `source` is the config file path, used in messages.
 */
export function validateConfig(raw: unknown, source: string): AgentConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    fail(source, "config must be a mapping of keys to values");
  }
  const record = raw as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(KNOWN_KEYS as readonly string[]).includes(key)) {
      fail(source, `unknown key "${key}" (known keys: ${KNOWN_KEYS.join(", ")})`);
    }
  }

  const model = record.model;
  if (model === undefined) fail(source, `missing required key "model"`);
  if (typeof model !== "string") fail(source, `"model" must be a string`);
  if (model.trim() === "") fail(source, `"model" must not be empty`);

  const system = optionalString(record.system, "system", source);
  const systemCmd = optionalString(record["system-cmd"], "system-cmd", source);
  if (system !== undefined && systemCmd !== undefined) {
    fail(source, `"system" and "system-cmd" are mutually exclusive`);
  }

  const config: AgentConfig = { model };
  const description = optionalString(record.description, "description", source);
  if (description !== undefined) config.description = description;
  if (system !== undefined) config.system = system;
  if (systemCmd !== undefined) config["system-cmd"] = systemCmd;
  const tools = optionalStringArray(record.tools, "tools", source);
  if (tools !== undefined) config.tools = tools;
  const skills = optionalStringArray(record.skills, "skills", source);
  if (skills !== undefined) config.skills = skills;
  return config;
}
