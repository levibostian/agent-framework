import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { loadAgent } from "../src/config/load.ts";
import { resolveAgent, resolveModel } from "../src/config/resolve.ts";
import type { Paths } from "../src/paths.ts";
import { cleanupTempDirs, tempDir, writeAgent, writeFile, writeModelMap } from "./helpers.ts";

afterAll(cleanupTempDirs);

function failure(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected the call to throw");
}

/** Build a paths object plus a loaded agent from inline yaml. */
function fixture(config: string, options: { models?: Record<string, unknown>; files?: Record<string, string> } = {}) {
  const root = tempDir();
  const dir = writeAgent(root, "hello", "agent.yaml", config);
  const paths: Paths = {
    home: root,
    models: options.models === undefined ? join(root, "models.json") : writeModelMap(root, options.models),
    userHome: root,
  };
  for (const [name, contents] of Object.entries(options.files ?? {})) {
    writeFile(join(dir, name), contents);
  }
  return { root, dir, paths, loaded: loadAgent(paths, "hello") };
}

describe("model resolution", () => {
  test("a literal model is used verbatim", () => {
    const { loaded, paths } = fixture("model: openrouter/anthropic/claude-sonnet-4\n");
    expect(resolveAgent(loaded, paths).model).toBe("openrouter/anthropic/claude-sonnet-4");
  });

  test("a :key: template resolves from the map", () => {
    const { loaded, paths } = fixture("model: ':fast:'\n", { models: { fast: "openrouter/google/gemini" } });
    expect(resolveAgent(loaded, paths).model).toBe("openrouter/google/gemini");
  });

  test("a template never chains", () => {
    const { loaded, paths } = fixture("model: ':a:'\n", { models: { a: ":b:", b: "deep" } });
    expect(resolveAgent(loaded, paths).model).toBe(":b:");
  });

  test("near-misses of the template form are literals", () => {
    const { paths } = fixture("model: x\n");
    expect(resolveModel(":fast", paths.models)).toBe(":fast");
    expect(resolveModel("fast:", paths.models)).toBe("fast:");
    expect(resolveModel("::", paths.models)).toBe("::");
  });

  test("a missing map file names the key and the path", () => {
    const { loaded, paths } = fixture("model: ':fast:'\n");
    const message = failure(() => resolveAgent(loaded, paths));
    expect(message).toContain(":fast:");
    expect(message).toContain(paths.models);
  });

  test("a missing key and a non-string value are errors", () => {
    const missing = fixture("model: ':fast:'\n", { models: { deep: "x" } });
    expect(failure(() => resolveAgent(missing.loaded, missing.paths))).toContain('"fast" not found');

    const notString = fixture("model: ':fast:'\n", { models: { fast: 3 } });
    expect(failure(() => resolveAgent(notString.loaded, notString.paths))).toContain("is not a string");
  });

  test("a model map that is not an object is an error", () => {
    const { root, loaded, paths } = fixture("model: ':fast:'\n");
    writeFile(join(root, "models.json"), "[1,2]");
    expect(failure(() => resolveAgent(loaded, paths))).toContain("must be a JSON object");
  });
});

describe("system prompt resolution", () => {
  test("no system and no system-cmd yields an empty prompt with source none", () => {
    const { loaded, paths } = fixture("model: m\n");
    const agent = resolveAgent(loaded, paths);
    expect(agent.systemPrompt).toBe("");
    expect(agent.systemPromptSource).toBe("none");
  });

  test("system is used as written", () => {
    const { loaded, paths } = fixture("model: m\nsystem: '  keep spacing  '\n");
    const agent = resolveAgent(loaded, paths);
    expect(agent.systemPrompt).toBe("  keep spacing  ");
    expect(agent.systemPromptSource).toBe("config");
  });

  test("system-cmd stdout becomes the prompt, trimmed", () => {
    const { loaded, paths } = fixture("model: m\nsystem-cmd: printf '  from command  '\n");
    const agent = resolveAgent(loaded, paths);
    expect(agent.systemPrompt).toBe("from command");
    expect(agent.systemPromptSource).toBe("command");
  });

  test("system-cmd runs in the given working directory", () => {
    const cwd = tempDir();
    writeFile(join(cwd, "prompt.txt"), "from a file");
    const { loaded, paths } = fixture("model: m\nsystem-cmd: cat prompt.txt\n");
    expect(resolveAgent(loaded, paths, { cwd }).systemPrompt).toBe("from a file");
  });

  test("a failing system-cmd errors with its stderr", () => {
    const { loaded, paths } = fixture("model: m\nsystem-cmd: 'echo boom >&2; exit 3'\n");
    const message = failure(() => resolveAgent(loaded, paths));
    expect(message).toContain("status 3");
    expect(message).toContain("boom");
  });
});

describe("tools resolution", () => {
  test("omitted stays undefined, empty stays empty, populated is copied", () => {
    const omitted = fixture("model: m\n");
    expect(resolveAgent(omitted.loaded, omitted.paths).tools).toBeUndefined();

    const empty = fixture("model: m\ntools: []\n");
    expect(resolveAgent(empty.loaded, empty.paths).tools).toEqual([]);

    const populated = fixture("model: m\ntools: [bash, read]\n");
    const agent = resolveAgent(populated.loaded, populated.paths);
    expect(agent.tools).toEqual(["bash", "read"]);
    expect(agent.tools).not.toBe(populated.loaded.config.tools);
  });
});

describe("skill resolution", () => {
  test("omitted skills yield an empty list", () => {
    const { loaded, paths } = fixture("model: m\n");
    expect(resolveAgent(loaded, paths).skills).toEqual([]);
  });

  test("a relative path resolves against the agent directory", () => {
    const { dir, loaded, paths } = fixture("model: m\nskills: ['./skills/demo']\n", {
      files: { "skills/demo/SKILL.md": "---\nname: demo\n---\n" },
    });
    expect(resolveAgent(loaded, paths).skills).toEqual([join(dir, "skills/demo")]);
  });

  test("a leading ~ expands to the user home", () => {
    const { root, loaded, paths } = fixture("model: m\nskills: ['~/shared']\n");
    writeFile(join(root, "shared", "SKILL.md"), "---\nname: shared\n---\n");
    expect(resolveAgent(loaded, paths).skills).toEqual([join(root, "shared")]);
  });

  test("an absolute path is kept and a plain file is allowed", () => {
    const root = tempDir();
    const dir = writeAgent(root, "hello", "agent.yaml", "model: m\n");
    const absolute = writeFile(join(root, "elsewhere", "skill.md"), "# skill\n");
    writeFile(join(dir, "local.md"), "# local\n");
    writeFile(join(dir, "agent.yaml"), `model: m\nskills:\n  - ${absolute}\n  - ./local.md\n`);

    const paths: Paths = { home: root, models: join(root, "models.json"), userHome: root };
    const loaded = loadAgent(paths, "hello");
    expect(resolveAgent(loaded, paths).skills).toEqual([absolute, join(dir, "local.md")]);
  });

  test("a missing path errors naming the agent, the entry and the resolved path", () => {
    const { dir, loaded, paths } = fixture("model: m\nskills: ['./nope']\n");
    const message = failure(() => resolveAgent(loaded, paths));
    expect(message).toContain('agent "hello"');
    expect(message).toContain("./nope");
    expect(message).toContain(join(dir, "nope"));
  });
});

describe("description", () => {
  test("is carried through only when present", () => {
    const withDescription = fixture("model: m\ndescription: Greets people.\n");
    expect(resolveAgent(withDescription.loaded, withDescription.paths).description).toBe("Greets people.");

    const without = fixture("model: m\n");
    expect(resolveAgent(without.loaded, without.paths).description).toBeUndefined();
  });

  test("name and dir come from the loaded agent", () => {
    const { dir, loaded, paths } = fixture("model: m\n");
    const agent = resolveAgent(loaded, paths);
    expect(agent.name).toBe("hello");
    expect(agent.dir).toBe(dir);
  });
});
