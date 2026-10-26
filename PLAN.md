# PLAN

Temporary build plan for the `agent` CLI. It tells a building agent *what to build and how
to verify it*. The durable definition of an agent lives in [SPEC.md](./SPEC.md) — read that
first, then this file.

## Goal

A CLI named `agent` with one working command:

```
agent run <name> [prompt]
```

- `<name>` (required): directory name under the agent root (`~/.agent/<name>/`).
- `[prompt]` (optional): one-shot request sent to the agent. When omitted, start an
  interactive session instead.

`run` reads agent metadata, resolves it, and hands a normalized request to a **runtime
adapter**. The adapter is the only place that knows about Pi. Adding another runtime later
must not require touching the spec, the loader, or the CLI.

Success criteria:

1. `agent run <name> "..."` executes one request and exits with the runtime's exit code.
2. `agent run <name>` opens an interactive session with the configured agent.
3. `agent run --dry-run <name> "..."` prints the exact runtime invocation without executing.
4. Misconfiguration fails fast with an actionable message and a non-zero exit code.
5. Nothing outside `src/runtime/` mentions Pi.

## Stack and conventions

- **Runtime:** Bun 1.2.12 (`/Users/levi/.local/share/mise/installs/bun/1.2.12/bin/bun`).
  TypeScript, ESM, no build step. Run sources directly with `bun`.
- **Deps:** `yaml` only (Bun 1.2.12 has no `Bun.YAML`). Everything else from the standard
  library. Do not add a CLI framework — argument parsing here is ~40 lines.
- **Tests:** `bun test`.
- Keep files small and single-purpose. No classes unless they carry state.

## Layout

```
package.json          name "agent", bin { "agent": "./src/index.ts" }, type module
tsconfig.json         strict, moduleResolution bundler, noEmit
src/index.ts          shebang entry; parse argv, dispatch, set process.exitCode
src/cli.ts            arg parsing for `run`; help text
src/errors.ts         AgentError class; exit codes
src/config/load.ts    locate agent dir + config file, parse JSON/YAML
src/config/schema.ts  shape + validation of raw config (unknown-key errors)
src/config/resolve.ts system/system-cmd, model templates, tools -> ResolvedAgent
src/runtime/types.ts  ResolvedAgent + Runner interface (runtime-agnostic)
src/runtime/pi.ts     PiRunner: ResolvedAgent -> `pi` subprocess
src/runtime/index.ts  runtime registry; "pi" is the default
test/*.test.ts        fixtures + tests (see below)
README.md             user-facing usage
```

`ResolvedAgent` and `Runner` mirror the "Normalized run request" and "Adapter contract"
sections of SPEC.md. Do not add fields the spec does not define.

## Behavior details

### Paths

- Agent root: `$AGENT_HOME` if set, else `~/.agent`. Also accept `--home <dir>` on the CLI.
- Model map: `$AGENT_MODELS` if set, else `<agent root>/models.json`. Accept `--models <file>`.
- Resolve these once at startup and pass them down as an explicit `Paths` object. No module
  reads `process.env` or `os.homedir()` on its own.

### Loading

1. Validate the name against `[A-Za-z0-9._-]+` (reject `.`, `..`, path separators) before
   touching the filesystem. Missing agent directory: `agent "foo" not found in ~/.agent`.
2. Require exactly one of `agent.json`, `agent.yaml`, `agent.yml` in the directory. Report
   which files were found when there is more than one.
3. Parse with `JSON.parse` or the `yaml` package. A parse error must include the file path
   and the parser's message.
4. Validate against the schema: `model` required and a string; `description`/`system`/
   `system-cmd` strings; `tools` an array of strings; unknown keys rejected; `system` and
   `system-cmd` mutually exclusive.

### Resolution

- `systemPrompt`: from `system` when present, else the trimmed stdout of `system-cmd` run
  via `spawnSync("/bin/sh", ["-c", cmd], { cwd: process.cwd(), encoding: "utf8" })`.
  Non-zero exit is an error that includes stderr. Otherwise `""` with source `"none"`.
- `model`: if the value matches `^:(.+):$`, look the key up in the model map. Missing file,
  missing key, or non-string value is an error naming the key and the map path. Otherwise
  the value is used literally.
- `tools`: `undefined` when omitted, `[]` when the array is empty, otherwise the array
  as given.

### Pi adapter

Build argv, then spawn with `stdio: "inherit"` so output streams through untouched:

```
one-shot:     pi --print --model <model> [--system-prompt <prompt>] [--tools a,b] -- <prompt>
interactive:  pi --model <model> [--system-prompt <prompt>] [--tools a,b]
```

- Omit `--system-prompt` when the prompt is `""` so Pi uses its own default.
- Omit `--tools` when `tools` is `undefined` (Pi default set). Pass `--tools ""` semantics
  are not wanted; for `[]`, use Pi's `--no-tools`.
- Pass the user prompt after `--` so prompts starting with `-` are safe.
- Exit code: return the child's code; map a signal death to `128 + signal`.
- Interactive mode inherits the terminal, so Pi opens its TUI.

`--dry-run` prints the argv as a shell-escaped single line to stdout and exits 0 without
spawning. This is how the adapter is tested without network access.

### Exit codes

`0` success, `1` config/lookup error, `2` usage error. Runtime exit codes pass through
unchanged.

## Milestones

1. **Skeleton** — `package.json`, `tsconfig.json`, `src/index.ts` + `src/cli.ts` that parse
   `run <name> [prompt]` and print a resolved-but-unused placeholder. `agent --help` works.
2. **Load + validate** — `config/load.ts`, `config/schema.ts`, `errors.ts`, with tests.
3. **Resolve** — `config/resolve.ts` including `system-cmd` and `:model:` templates, with
   tests. `--dry-run` prints the fully resolved `ResolvedAgent` as JSON.
4. **Pi adapter** — `runtime/types.ts`, `runtime/pi.ts`, `runtime/index.ts`; wire both
   invocation modes; `--dry-run` prints the final argv instead of JSON.
5. **Docs** — `README.md` with install, the config example, and both invocation modes.

## Tests

Use `bun test` with a temp directory as `AGENT_HOME` and `AGENT_MODELS` per test. Never
write to the real `~/.agent`.

- name validation: `..`, `a/b`, empty, and unknown names rejected.
- config discovery: json and yaml both load; zero files and two files both error; unknown
  key errors; missing `model` errors; `system` + `system-cmd` errors.
- resolution: `:key:` resolves from the map; missing key errors; literal model untouched;
  `system-cmd` output becomes the prompt; failing `system-cmd` errors with stderr; `tools`
  omitted vs `[]` vs populated.
- adapter: `--dry-run` argv snapshots for one-shot and interactive, with and without
  `system`/`tools`.
- exit code: a fake runtime (`pi` replaced by a script on `PATH`) that exits `7` makes
  `agent run` exit `7`.

## Verification

```sh
bun test
mkdir -p /tmp/agentdemo/hello
cat > /tmp/agentdemo/hello/agent.yaml <<'YAML'
description: Greets people.
system: You are terse.
tools: [bash, read]
model: ":fast:"
YAML
echo '{"fast":"openrouter/google/gemini-2.5-flash"}' > /tmp/agentdemo/models.json

AGENT_HOME=/tmp/agentdemo AGENT_MODELS=/tmp/agentdemo/models.json \
  bun src/index.ts run --dry-run hello "say hi"
# expect: pi --print --model openrouter/google/gemini-2.5-flash \
#         --system-prompt 'You are terse.' --tools bash,read -- 'say hi'

AGENT_HOME=/tmp/agentdemo AGENT_MODELS=/tmp/agentdemo/models.json \
  bun src/index.ts run hello
# expect: Pi TUI opens with the configured model and system prompt
```

Do not claim the interactive case works until the TUI actually opens. Do not claim the
one-shot case works until a real prompt returns real output.

## Open decisions (defaults chosen — change only with a reason)

- Both `system` and `system-cmd` → hard error, not precedence.
- `description` is stored and validated but unused by `run`. Sub-agent discovery is a
  future command (`agent list`), not part of this plan.
- Model map is a flat `key -> string` object. No nesting, no chaining.
- System prompt is passed as an argv value, not a temp file. Prompts larger than the OS
  argv limit are a known, accepted limitation.

## Out of scope

- `agent list`, `agent create`, `agent edit`.
- Multiple runtimes beyond Pi (the adapter seam exists; nothing else implements it).
- Sessions, streaming/JSON output modes, sub-agent invocation, packaging/publishing.
