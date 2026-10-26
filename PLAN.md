# PLAN

Temporary build plan for the `agent` CLI. It tells a building agent *what to build and how
to verify it*. The durable definition of an agent lives in [SPEC.md](./SPEC.md) — read that
first, then this file.

## Goal

A CLI named `agent` with three commands:

```
agent run <name> [prompt]
agent list
agent edit <name>
```

- `run <name>` (required): directory name under the agent root (`~/.agent/<name>/`).
  `[prompt]` (optional): one-shot request sent to the agent. When omitted, start an
  interactive session instead.
- `list`: enumerate the agent root and print every agent found.
- `edit <name>`: open the agent's directory in the user's editor.

`run` reads agent metadata, resolves it, and hands a normalized request to a **runtime
adapter**. The adapter is the only place that knows about Pi. Adding another runtime later
must not require touching the spec, the loader, or the CLI.

Success criteria:

1. `agent run <name> "..."` executes one request and exits with the runtime's exit code.
2. `agent run <name>` opens an interactive session with the configured agent.
3. `agent run --dry-run <name> "..."` prints the exact runtime invocation without executing.
4. `agent list` prints every agent with its name and description, and never executes an
   agent or its `system-cmd`.
5. `agent edit <name>` opens the agent's directory in the user's editor.
6. Misconfiguration fails fast with an actionable message and a non-zero exit code.
7. Nothing outside `src/runtime/` mentions Pi.

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
src/cli.ts            arg parsing per command; help text
src/errors.ts         AgentError class; exit codes
src/paths.ts          Paths object: agent root, model map, from env/flags
src/config/load.ts    locate agent dir + config file, parse JSON/YAML
src/config/schema.ts  shape + validation of raw config (unknown-key errors)
src/config/resolve.ts system/system-cmd, model templates, tools, skills -> ResolvedAgent
src/commands/run.ts   run command
src/commands/list.ts  list command
src/commands/edit.ts  edit command
src/editor.ts         resolve + spawn the user's editor
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
- Every command accepts `--home` / `--models`, including `list` and `edit`.

### Loading

1. Validate the name against `[A-Za-z0-9._-]+` (reject `.`, `..`, path separators) before
   touching the filesystem. Missing agent directory: `agent "foo" not found in ~/.agent`.
2. Require exactly one of `agent.json`, `agent.yaml`, `agent.yml` in the directory. Report
   which files were found when there is more than one.
3. Parse with `JSON.parse` or the `yaml` package. A parse error must include the file path
   and the parser's message.
4. Validate against the schema: `model` required and a string; `description`/`system`/
   `system-cmd` strings; `tools` and `skills` arrays of strings; unknown keys rejected;
   `system` and `system-cmd` mutually exclusive.

### Resolution

- `systemPrompt`: from `system` when present, else the trimmed stdout of `system-cmd` run
  via `spawnSync("/bin/sh", ["-c", cmd], { cwd: process.cwd(), encoding: "utf8" })`.
  Non-zero exit is an error that includes stderr. Otherwise `""` with source `"none"`.
- `model`: if the value matches `^:(.+):$`, look the key up in the model map. Missing file,
  missing key, or non-string value is an error naming the key and the map path. Otherwise
  the value is used literally.
- `tools`: `undefined` when omitted, `[]` when the array is empty, otherwise the array
  as given.
- `skills`: each entry expands a leading `~`, then is used as is when absolute, otherwise
  resolved against the agent directory. A resolved path that does not exist is an error
  naming the agent, the original entry, and the resolved path. Result is always an array
  of absolute paths, `[]` when unconfigured. Resolution must not read or parse the skill
  contents — only stat the path.

### Pi adapter

Build argv, then spawn with `stdio: "inherit"` so output streams through untouched:

```
one-shot:     pi --print --model <model> [--system-prompt <prompt>] [--tools a,b] [--skill <path> ...] -- <prompt>
interactive:  pi --model <model> [--system-prompt <prompt>] [--tools a,b] [--skill <path> ...]
```

- Omit `--system-prompt` when the prompt is `""` so Pi uses its own default.
- Omit `--tools` when `tools` is `undefined` (Pi default set). Pass `--tools ""` semantics
  are not wanted; for `[]`, use Pi's `--no-tools`.
- Emit one `--skill <path>` per resolved path. Pi's `--skill` is repeatable and accepts a
  file or a directory. Do not pass `--no-skills`: Pi must keep discovering skills in the
  run's working directory, which is how running an agent inside a repo picks up that repo's
  skills. Configured skills and working-directory skills are additive.
- Pass the user prompt after `--` so prompts starting with `-` are safe.
- Exit code: return the child's code; map a signal death to `128 + signal`.
- Interactive mode inherits the terminal, so Pi opens its TUI.

`--dry-run` prints the argv as a shell-escaped single line to stdout and exits 0 without
spawning. This is how the adapter is tested without network access.

### list

Enumerate the immediate subdirectories of the agent root. An entry counts as an agent when
it contains exactly one valid config file. For each one, print the name and, when present,
the description:

```
hello      Greets people.
reviewer   Reviews diffs for correctness.
quiet
```

- Align the name column to the longest name; keep the name alone when there is no
  description.
- Skip directories with no config file. Report a directory with a malformed config as an
  error line on stderr and continue, so one broken agent does not hide the rest. Exit `1`
  if any entry was reported broken, `0` otherwise.
- `list` is read-only: parse the config for `description` only, never run `system-cmd`,
  never resolve `model` or `skills`, never touch the network.
- Accept `--json` to print `[{ name, description, dir }]` for scripting.
- Print `no agents in <root>` on stdout and exit `0` when the root is missing or empty.

### edit

1. Load and validate the agent name the same way `run` does, so a bad name fails the same
   way. It is fine to skip config validation here — the point of `edit` is to fix a broken
   config.
2. Pick the editor: `$VISUAL`, then `$EDITOR`. Spawn it with the **agent directory** as the
   only argument, `stdio: "inherit"`, and wait for it to exit. Pass the directory, not the
   file, so a terminal editor opens its file browser and the config is one keystroke away.
3. When neither variable is set, fall back to the OS default opener on the **config file**:
   `open -t <config-file>` on macOS, `xdg-open <config-file>` on Linux. A config file is
   used here because the fallback must land on something editable.
4. Propagate the editor's exit code. A missing editor binary is an error naming the binary.

`edit` never parses, rewrites, or formats the config.

### Exit codes

`0` success, `1` config/lookup error, `2` usage error. Runtime and editor exit codes pass
through unchanged.

## Milestones

1. **Skeleton** — `package.json`, `tsconfig.json`, `src/paths.ts`, `src/index.ts` +
   `src/cli.ts` that dispatch `run` / `list` / `edit`. `agent --help` works.
2. **Load + validate** — `config/load.ts`, `config/schema.ts`, `errors.ts`, with tests.
3. **Resolve** — `config/resolve.ts` including `system-cmd`, `:model:` templates, and skill
   paths, with tests. `--dry-run` prints the fully resolved `ResolvedAgent` as JSON.
4. **Pi adapter** — `runtime/types.ts`, `runtime/pi.ts`, `runtime/index.ts`; wire both
   invocation modes and `--skill` passthrough; `--dry-run` prints the final argv instead of
   JSON.
5. **list** — `commands/list.ts` plus the `--json` form.
6. **edit** — `editor.ts` + `commands/edit.ts`.
7. **Docs** — `README.md` with install, the config example, all three commands, and how
   skills load.

## Tests

Use `bun test` with a temp directory as `AGENT_HOME` and `AGENT_MODELS` per test. Never
write to the real `~/.agent`.

- name validation: `..`, `a/b`, empty, and unknown names rejected.
- config discovery: json and yaml both load; zero files and two files both error; unknown
  key errors; missing `model` errors; `system` + `system-cmd` errors.
- resolution: `:key:` resolves from the map; missing key errors; literal model untouched;
  `system-cmd` output becomes the prompt; failing `system-cmd` errors with stderr; `tools`
  omitted vs `[]` vs populated.
- skills: relative path resolves against the agent dir; `~/x` expands; absolute path kept;
  a missing path errors and names the entry; `skills` omitted yields `[]`.
- adapter: `--dry-run` argv snapshots for one-shot and interactive, with and without
  `system` / `tools` / `skills`; two skills produce two `--skill` flags; `--no-skills` is
  never emitted.
- list: prints name and description aligned; a description-less agent prints the bare name;
  a directory without a config is skipped; a malformed config is reported on stderr without
  hiding valid agents; `--json` shape; a config with a `system-cmd` that writes to a file
  proves `list` never executed it; empty and missing roots print the empty message.
- edit: with `EDITOR` set to a script that records its argv, assert the agent directory was
  passed and the exit code propagated; unset `EDITOR`/`VISUAL` falls back to the opener.
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
  bun src/index.ts list
# expect: hello   Greets people.

AGENT_HOME=/tmp/agentdemo AGENT_MODELS=/tmp/agentdemo/models.json \
  bun src/index.ts edit hello
# expect: the editor opens on /tmp/agentdemo/hello

AGENT_HOME=/tmp/agentdemo AGENT_MODELS=/tmp/agentdemo/models.json \
  bun src/index.ts run hello
# expect: Pi TUI opens with the configured model and system prompt
```

Skills check: add `skills: ["./skills/demo"]` to the config and a `skills/demo/SKILL.md`
under the agent directory. `run --dry-run` must show `--skill /tmp/agentdemo/hello/skills/demo`.
Then run `agent run hello` from a repo that has its own `.agents/skills/` and confirm Pi
reports both the configured skill and the repo skill at startup.

Do not claim the interactive case works until the TUI actually opens. Do not claim the
one-shot case works until a real prompt returns real output. Do not claim skills load until
Pi's startup output lists them.

## Open decisions (defaults chosen — change only with a reason)

- Both `system` and `system-cmd` → hard error, not precedence.
- `description` is unused by `run`, but `list` prints it. Sub-agent discovery is left to a
  future command; `list` is the read-only catalog it will build on.
- Model map is a flat `key -> string` object. No nesting, no chaining.
- System prompt is passed as an argv value, not a temp file. Prompts larger than the OS
  argv limit are a known, accepted limitation.
- `skills` is additive and never disables runtime discovery, so working-directory skills
  always load.
- `edit` passes the agent **directory** to `$VISUAL`/`$EDITOR` but the **config file** to
  the OS opener fallback. Terminal editors get a file browser; the fallback lands on
  something editable.
- `list` reports a broken agent on stderr and continues instead of aborting.

## Out of scope

- `agent create`. Creating an agent is making a directory and a file; a command for it can
  wait.
- Multiple runtimes beyond Pi (the adapter seam exists; nothing else implements it).
- Sessions, streaming/JSON output modes, sub-agent invocation, packaging/publishing.
- Editing agent metadata from the CLI. `edit` delegates to an external editor and never
  writes config itself.
