import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { agentDirs, configFilePath, loadAgent, requireAgentDir, validateName } from "../src/config/load.ts";
import type { Paths } from "../src/paths.ts";
import { cleanupTempDirs, tempDir, writeAgent, writeFile } from "./helpers.ts";

afterAll(cleanupTempDirs);

function pathsFor(root: string): Paths {
  return { home: root, models: join(root, "models.json"), userHome: "/home/tester" };
}

function failure(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the call to throw");
}

describe("validateName", () => {
  test("accepts names made of letters, digits, dot, underscore, dash", () => {
    for (const name of ["hello", "a.b-c_1", "REVIEWER", "9"]) {
      expect(() => validateName(name)).not.toThrow();
    }
  });

  test("rejects path escapes, empty names and separators", () => {
    for (const name of ["", ".", "..", "a/b", "../x", "a b", "a\tb", "a\\b"]) {
      expect(() => validateName(name)).toThrow();
    }
  });
});

describe("loadAgent", () => {
  test("loads a json config", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.json", JSON.stringify({ model: "m", description: "d", tools: ["bash"], thinking: "high" }));

    const loaded = loadAgent(pathsFor(root), "hello");
    expect(loaded.name).toBe("hello");
    expect(loaded.dir).toBe(join(root, "hello"));
    expect(loaded.config.model).toBe("m");
    expect(loaded.config.description).toBe("d");
    expect(loaded.config.tools).toEqual(["bash"]);
    expect(loaded.config.thinking).toBe("high");
  });

  test("loads a yaml config and a yml config", () => {
    const root = tempDir();
    writeAgent(root, "a", "agent.yaml", "model: m\nsystem: be terse\n");
    writeAgent(root, "b", "agent.yml", "model: m\n");

    expect(loadAgent(pathsFor(root), "a").config.system).toBe("be terse");
    expect(loadAgent(pathsFor(root), "b").config.model).toBe("m");
  });

  test("reports an unknown name with the root", () => {
    const root = tempDir();
    expect(failure(() => loadAgent(pathsFor(root), "ghost"))).toBe(`agent "ghost" not found in ${root}`);
  });

  test("rejects an invalid name before touching the filesystem", () => {
    expect(failure(() => loadAgent(pathsFor("/nonexistent"), "../etc"))).toContain("invalid agent name");
  });

  test("a directory with no config file is an error", () => {
    const root = tempDir();
    writeAgent(root, "empty", "notes.md", "hi");
    expect(failure(() => loadAgent(pathsFor(root), "empty"))).toContain("no config file");
  });

  test("two config files is an error naming both", () => {
    const root = tempDir();
    writeAgent(root, "both", "agent.json", JSON.stringify({ model: "m" }));
    writeFile(join(root, "both", "agent.yaml"), "model: m\n");

    const message = failure(() => loadAgent(pathsFor(root), "both"));
    expect(message).toContain("multiple config files");
    expect(message).toContain("agent.json");
    expect(message).toContain("agent.yaml");
  });

  test("a parse error names the file", () => {
    const root = tempDir();
    writeAgent(root, "bad", "agent.json", "{ not json");
    expect(failure(() => loadAgent(pathsFor(root), "bad"))).toContain(join(root, "bad", "agent.json"));
  });

  test("unknown keys, missing model and bad types are rejected", () => {
    const cases: Array<[string, unknown]> = [
      ["unknown key", { model: "m", colour: "red" }],
      ["missing required key", { description: "d" }],
      ["must be a string", { model: 7 }],
      ["must not be empty", { model: "  " }],
      ["mutually exclusive", { model: "m", system: "a", "system-cmd": "b" }],
      ["must be an array", { model: "m", tools: "bash" }],
      ["must be an array", { model: "m", skills: [1] }],
      ["must be a string", { model: "m", thinking: 3 }],
    ];

    for (const [expected, config] of cases) {
      const root = tempDir();
      writeAgent(root, "a", "agent.json", JSON.stringify(config));
      expect(failure(() => loadAgent(pathsFor(root), "a"))).toContain(expected);
    }
  });

  test("a config that is not a mapping is rejected", () => {
    const root = tempDir();
    writeAgent(root, "a", "agent.yaml", "- one\n- two\n");
    expect(failure(() => loadAgent(pathsFor(root), "a"))).toContain("must be a mapping");
  });
});

describe("configFilePath", () => {
  test("is derivable from the directory alone", () => {
    const root = tempDir();
    const dir = writeAgent(root, "hello", "agent.yaml", "model: m\n");
    expect(configFilePath(dir)).toBe(join(dir, "agent.yaml"));
  });

  test("ignores a directory named like a config file", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.yaml", "model: m\n");
    writeFile(join(root, "hello", "agent.json", "nested.md"), "not a config");
    expect(configFilePath(join(root, "hello"))).toBe(join(root, "hello", "agent.yaml"));
  });
});

describe("agentDirs", () => {
  test("lists immediate subdirectories sorted by name", () => {
    const root = tempDir();
    writeAgent(root, "zeta", "agent.json", JSON.stringify({ model: "m" }));
    writeAgent(root, "alpha", "agent.json", JSON.stringify({ model: "m" }));
    writeFile(join(root, "loose.txt"), "not an agent");

    expect(agentDirs(root).map((entry) => entry.name)).toEqual(["alpha", "zeta"]);
  });

  test("an unreadable root yields no entries", () => {
    expect(agentDirs("/nonexistent/agent-root")).toEqual([]);
  });
});

describe("requireAgentDir", () => {
  test("returns the directory for a known agent and throws for an unknown one", () => {
    const root = tempDir();
    writeAgent(root, "hello", "agent.json", JSON.stringify({ model: "m" }));
    expect(requireAgentDir(pathsFor(root), "hello")).toBe(join(root, "hello"));
    expect(() => requireAgentDir(pathsFor(root), "ghost")).toThrow('agent "ghost" not found');
  });
});
