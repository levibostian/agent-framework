import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDirs, runCli } from "./helpers.ts";

afterAll(cleanupTempDirs);

const SPEC = readFileSync(join(import.meta.dir, "..", "SPEC.md"), "utf8");

describe("agent spec", () => {
  test("prints SPEC.md verbatim", () => {
    const result = runCli(["spec"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(SPEC);
    expect(result.stderr).toBe("");
  });

  test("is offline: it never needs the agent root or model map", () => {
    const result = runCli(["spec"], { env: { AGENT_HOME: undefined, AGENT_MODELS: undefined } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(SPEC);
  });
});
