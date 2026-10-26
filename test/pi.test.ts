import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PiRunner } from "../src/runtime/pi.ts";
import { getRunner } from "../src/runtime/index.ts";
import type { ResolvedAgent } from "../src/runtime/types.ts";
import { cleanupTempDirs, tempDir, writeScript } from "./helpers.ts";

afterAll(cleanupTempDirs);

const runner = new PiRunner();

function agent(overrides: Partial<ResolvedAgent> = {}): ResolvedAgent {
  return {
    name: "hello",
    dir: "/agents/hello",
    systemPrompt: "",
    systemPromptSource: "none",
    skills: [],
    model: "openrouter/google/gemini-2.5-flash",
    ...overrides,
  };
}

describe("PiRunner.buildArgv", () => {
  test("one-shot with a system prompt, tools and skills", () => {
    const argv = runner.buildArgv({
      agent: agent({
        systemPrompt: "You are terse.",
        systemPromptSource: "config",
        tools: ["bash", "read"],
        skills: ["/agents/hello/skills/demo"],
      }),
      prompt: "say hi",
    });

    expect(argv).toEqual([
      "--print",
      "--model",
      "openrouter/google/gemini-2.5-flash",
      "--system-prompt",
      "You are terse.",
      "--tools",
      "bash,read",
      "--skill",
      "/agents/hello/skills/demo",
      "--",
      "say hi",
    ]);
  });

  test("one-shot with nothing configured but a model and prompt", () => {
    expect(runner.buildArgv({ agent: agent(), prompt: "hi" })).toEqual([
      "--print",
      "--model",
      "openrouter/google/gemini-2.5-flash",
      "--",
      "hi",
    ]);
  });

  test("interactive mode omits --print and the prompt", () => {
    expect(runner.buildArgv({ agent: agent() })).toEqual(["--model", "openrouter/google/gemini-2.5-flash"]);
  });

  test("interactive mode still carries the system prompt, tools and skills", () => {
    const argv = runner.buildArgv({
      agent: agent({ systemPrompt: "Be terse.", systemPromptSource: "config", tools: ["bash"], skills: ["/a"] }),
    });

    expect(argv).toEqual([
      "--model",
      "openrouter/google/gemini-2.5-flash",
      "--system-prompt",
      "Be terse.",
      "--tools",
      "bash",
      "--skill",
      "/a",
    ]);
  });

  test("one-shot with skills but no system prompt or tools", () => {
    expect(runner.buildArgv({ agent: agent({ skills: ["/a"] }), prompt: "hi" })).toEqual([
      "--print",
      "--model",
      "openrouter/google/gemini-2.5-flash",
      "--skill",
      "/a",
      "--",
      "hi",
    ]);
  });

  test("an empty system prompt is omitted so the runtime default applies", () => {
    expect(runner.buildArgv({ agent: agent({ systemPrompt: "" }), prompt: "hi" })).not.toContain("--system-prompt");
  });

  test("omitted tools use the runtime default, an empty array disables them", () => {
    const omitted = runner.buildArgv({ agent: agent(), prompt: "hi" });
    expect(omitted).not.toContain("--tools");
    expect(omitted).not.toContain("--no-tools");

    const empty = runner.buildArgv({ agent: agent({ tools: [] }), prompt: "hi" });
    expect(empty).toContain("--no-tools");
    expect(empty).not.toContain("--tools");
  });

  test("one --skill per resolved path, and discovery is never disabled", () => {
    const argv = runner.buildArgv({ agent: agent({ skills: ["/a", "/b"] }), prompt: "hi" });
    expect(argv.filter((arg) => arg === "--skill")).toHaveLength(2);
    expect(argv).toContain("/a");
    expect(argv).toContain("/b");
    expect(argv).not.toContain("--no-skills");
  });

  test("the prompt follows -- so a leading dash is safe", () => {
    const argv = runner.buildArgv({ agent: agent(), prompt: "--help me" });
    expect(argv.at(-2)).toBe("--");
    expect(argv.at(-1)).toBe("--help me");
  });
});

describe("PiRunner.describe", () => {
  test("prints one shell-escaped line", () => {
    const line = runner.describe({
      agent: agent({
        systemPrompt: "You are terse.",
        systemPromptSource: "config",
        tools: ["bash", "read"],
      }),
      prompt: "say hi",
    });

    expect(line).toBe(
      "pi --print --model openrouter/google/gemini-2.5-flash --system-prompt 'You are terse.' --tools bash,read -- 'say hi'",
    );
  });

  test("escapes quotes and empty arguments", () => {
    expect(runner.describe({ agent: agent({ systemPrompt: "it's" }), prompt: "" })).toContain(`--system-prompt 'it'\\''s'`);
    expect(runner.describe({ agent: agent(), prompt: "" }).endsWith("-- ''")).toBe(true);
  });
});

describe("PiRunner.run", () => {
  test("returns the child's exit code", async () => {
    const bin = writeScript(join(tempDir(), "pi"), "#!/bin/sh\nexit 7\n");
    expect(await new PiRunner(bin).run({ agent: agent() })).toBe(7);
  });

  test("maps a signal death to 128 + signal", async () => {
    const bin = writeScript(join(tempDir(), "pi"), "#!/bin/sh\nkill -TERM $$\n");
    expect(await new PiRunner(bin).run({ agent: agent() })).toBe(143);
  });

  test("a missing runtime binary is an actionable error", async () => {
    await expect(new PiRunner("/nonexistent/pi").run({ agent: agent() })).rejects.toThrow("/nonexistent/pi");
  });
});

describe("getRunner", () => {
  test("pi is the default and unknown runtimes are rejected", () => {
    expect(getRunner()).toBeInstanceOf(PiRunner);
    expect(getRunner("pi")).toBeInstanceOf(PiRunner);
    expect(() => getRunner("claude")).toThrow('unknown runtime "claude"');
  });
});
