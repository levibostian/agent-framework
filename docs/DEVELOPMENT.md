# Development

Contributor notes. What the source cannot say about itself.

## Architecture

```
argv ──► src/index.ts ──► src/cli.ts            parse, dispatch, exit code
              │
              ▼
        src/commands/{run,list,edit}.ts          one command each
              │
              ├─► src/config/load.ts ──► src/config/schema.ts      disk → AgentConfig
              │        │
              │        ▼
              │   src/config/resolve.ts        AgentConfig → ResolvedAgent
              │                                (system-cmd, :model:, skill paths)
              │
              ├─► src/runtime/index.ts ──► src/runtime/pi.ts       ResolvedAgent → pi argv
              │                                                     ══ the only Pi-aware file
              │
              └─► src/editor.ts                launch $VISUAL / $EDITOR / OS opener
```

`ResolvedAgent` and `Runner` (`src/runtime/types.ts`) are the seam. Everything left of
them is runtime-agnostic; everything right of them is one adapter.

## Data flow

`agent run <name> [prompt]`:

1. `src/index.ts` → `parseArgs`, then `resolvePaths` reads `--home`/`--models`, env, defaults once.
2. `runCommand` → `loadAgent`: validate the name, find the directory, pick the one config file, parse, `validateConfig`.
3. `resolveAgent`: `system` or `system-cmd` → system prompt; `:key:` → model map; each skill → absolute path; `tools` copied as-is.
4. `getRunner()` → `PiRunner.buildArgv` → `pi` argv, or `describe()` when `--dry-run`.
5. `PiRunner.run` spawns `pi` with `stdio: "inherit"` and returns its exit code.

`agent list` stops at step 2 and reads only `description`. `agent edit` stops after the
name check and never parses the config.

## Key design decisions

### `system-cmd` runs at invocation time, in the caller's directory

The spec says the prompt can be dynamic, so it has to run per invocation rather than at
load time. It runs in `process.cwd()` because the agent directory is metadata only — a
run always happens where the user is, which is what makes working-directory skills load.

### `system` and `system-cmd` are mutually exclusive

There is no sensible precedence and guessing hides intent. The schema rejects the pair
rather than picking one, so a config that means two things never runs as one of them.

### `tools` has three states, not two

`undefined` (field absent) means the runtime's default set, `[]` means no tools, and a
populated array means exactly those. Collapsing `[]` into "absent" would silently give
an agent tools it was explicitly denied, so the adapter maps `[]` to `--no-tools` and
omits `--tools` entirely when the field is absent.

### Skills are additive and never disable discovery

The adapter emits one `--skill` per configured path and never `--no-skills`. Running an
agent inside a repo is how that repo supplies its own skills, so the configured set has
to layer on top of discovery rather than replace it. Reintroducing `--no-skills` here
would break that silently.

### Skill paths are resolved against the agent directory, and only stat'ed

Relative paths resolve against the agent directory so an agent can ship its own skills
next to its config and stay portable. Resolution calls `existsSync` and nothing else:
reading or parsing skill contents is the runtime's job, and doing it here would make the
loader depend on skill format.

### `list` reports broken agents on stderr and continues

One malformed config must not hide the other nine agents. `list` therefore catches per
directory, prints the failure on stderr, keeps stdout valid (including under `--json`),
and exits `1` so scripts can still detect a problem.

### The editor gets the directory; the OS opener gets the config file

A terminal editor given a directory opens its file browser, which is one keystroke from
the config. `open -t`/`xdg-open` have no such behaviour, so the fallback is handed the
config file directly — the only thing worth opening there.

### Exit codes are three-valued, and everything else passes through

`0` success, `1` config or lookup failure, `2` usage. The runtime's and the editor's exit
codes are returned unchanged rather than normalised, so `agent run` is a transparent
wrapper in scripts and CI.

### No CLI framework, and no module reads the environment on its own

Argument parsing is about forty lines and a dependency would be larger than it. For the
same reason `src/paths.ts` is the only module that reads `AGENT_HOME`, `AGENT_MODELS` and
the home directory: `Paths` is resolved once and passed down, which is what makes the
tests able to point at a temp directory without touching the user's real agents.

## Maintenance

- **Runtime pin.** `bun` 1.2.12, and `yaml` is the only runtime dependency (Bun 1.2.12
  has no `Bun.YAML`). Anything else would need a reason.
- **The test suite never touches the real runtime.** `test/helpers.ts` clears
  `AGENT_HOME`, `AGENT_MODELS`, `VISUAL` and `EDITOR`, and runtime tests prepend a fake
  `pi` directory to `PATH`. A test that reaches the real `pi` is a bug in the test.
- **`list` order is alphabetical by directory name.** The spec does not define an order;
  sorting keeps the table stable between runs.
- **The system prompt is passed as an argv value**, not a temp file. Prompts larger than
  the OS argv limit are a known, accepted limitation.
- **Pi's flags are the adapter's whole surface.** `--print`, `--model`,
  `--system-prompt`, `--tools`, `--no-tools`, `--skill`. Changing them means editing
  `src/runtime/pi.ts` and nothing else.
- **Adding a runtime** means adding a case to `getRunner` in `src/runtime/index.ts`. If
  it needs a field `ResolvedAgent` does not carry, that is a spec change: update
  [SPEC.md](../SPEC.md) first.
