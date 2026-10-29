# agent

Your agents, as directories you can version. One name on the command line, no flag soup.

## Why

Running an agent today means retyping the same invocation: a model id you keep looking
up, a system prompt you paste from somewhere, the tools and skills that particular job
needs. It works, once. Then you want a second agent with a different model, and the
prompt lives in your shell history.

`agent` moves all of that into a directory:

| Before | With `agent` |
| --- | --- |
| `pi --print --model openrouter/google/gemini-2.5-flash --system-prompt '...' --tools bash,read -- "review this diff"` | `agent run reviewer "review this diff"` |
| Model ids scattered across shell history | One `models.json`, referenced as `:fast:` |
| Prompts pasted from notes | `system:` in the config, or `system-cmd:` to generate it |
| No idea which agents you have | `agent list` |

## Features

- **One directory per agent.** Metadata only, no code. Commit it, symlink it, share it.
- **Model templates.** Write `:fast:` in the config and keep the real model id in one
  file you can change once.
- **Static or generated prompts.** `system:` for a fixed prompt, `system-cmd:` to run a
  command and use its stdout.
- **Per-agent tools and skills.** Configured skills are added on top of whatever the
  runtime discovers in your working directory, never instead of it.
- **Per-agent thinking level.** `thinking:` picks how hard the model reasons for this
  agent; a bad value fails loudly instead of silently falling back.
- **See before you run.** `--dry-run` prints the exact command, shell-escaped.
- **Fails loudly.** Unknown config keys, missing model keys, and missing skill paths are
  errors with the file and the path in the message.
- **Editor in one keystroke.** `agent edit <name>` opens the agent directory.

## Prerequisites

- [Bun](https://bun.sh) 1.2.12 or newer.
- [Pi](https://github.com/badlogic/pi-mono) on your `PATH` — the runtime `agent` invokes.

## Quick start

```sh
bun install -g github:you/agent-framework   # or: bun link

mkdir -p ~/.agent/hello
cat > ~/.agent/hello/agent.yaml <<'YAML'
description: Greets people, tersely.
system: You are terse.
tools: [bash, read]
model: ":fast:"
YAML

cat > ~/.agent/models.json <<'JSON'
{ "fast": "openrouter/google/gemini-2.5-flash" }
JSON

agent run hello "say hi"
```

## Usage

### `agent run <name> [prompt]`

Resolves the agent and hands it to the runtime. With a prompt it runs one request and
exits with the runtime's exit code; without one it opens an interactive session.

```
$ agent run reviewer "review the diff on my branch"
The diff adds a retry loop without a backoff cap. ...
```

```
$ agent run reviewer
# Pi's interactive TUI opens with the agent's model, prompt, tools and skills.
```

```
$ agent run --dry-run reviewer "review the diff"
pi --print --model openrouter/anthropic/claude-sonnet-4 --system-prompt 'Review diffs for correctness.' --tools bash,read -- 'review the diff'
```

### `agent list`

Lists every agent in the root with its description. Read-only: it never runs an agent's
`system-cmd`, never resolves models, never touches the network.

```
$ agent list
hello      Greets people, tersely.
reviewer   Reviews diffs for correctness.
quiet
```

`agent list --json` prints `[{ name, description, dir }]` for scripting.

A broken agent is reported on stderr and skipped, so one bad config does not hide the
rest. `list` exits `1` if anything was broken.

### `agent edit <name>`

Opens the agent's directory in `$VISUAL`, then `$EDITOR`. With neither set it falls back
to the OS opener on the config file. It passes the directory rather than the file, so a
terminal editor opens its file browser and the config is one keystroke away.

`edit` never parses the config, so it works on a config that is too broken to run.

### `agent spec`

Prints the agent spec: naming, the config schema and its rules, model and skill resolution,
and the normalized run request. It is the same [SPEC.md](SPEC.md) the repo ships, embedded at
build time, so the command and the document cannot drift. Read-only and offline: it never
reads the agent root or the model map.

```sh
agent spec
```

### Common options

| Option | Meaning |
| --- | --- |
| `--home <dir>` | Agent root. Default `$AGENT_HOME`, else `~/.agent`. |
| `--models <file>` | Model map. Default `$AGENT_MODELS`, else `<home>/models.json`. |

## Configuration

An agent is a directory under the agent root containing exactly one of `agent.json`,
`agent.yaml` or `agent.yml`. The directory name is the agent name
(`[A-Za-z0-9._-]+`).

```yaml
# ~/.agent/reviewer/agent.yaml
description: Reviews diffs for correctness.   # shown by `agent list`
system: Review diffs for correctness.         # static system prompt
tools: [bash, read, grep]                     # runtime tools to enable
skills: ["./skills/diff-style", "~/shared"]   # extra skills, additive
model: ":deep:"                               # or a literal model id
thinking: high                                # runtime thinking level
```

| Field | Required | Meaning |
| --- | --- | --- |
| `model` | yes | Literal model id, or `:key:` looked up in the model map. |
| `description` | no | Summary shown by `agent list`. |
| `system` | no | Static system prompt. |
| `system-cmd` | no | Command whose trimmed stdout becomes the system prompt. Runs through `/bin/sh -c` in your current directory. |
| `tools` | no | Tools to enable. Omit for the runtime's default set; `[]` means no tools. |
| `skills` | no | Extra skill files or directories. |
| `thinking` | no | Runtime thinking level. Omit for the runtime's default. With Pi, one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`. |

Unknown fields are an error, and so is setting both `system` and `system-cmd`. An unknown
`thinking` level is an error too, rather than a silent fall back to the default.

**Skills** are additive. Configured paths are resolved relative to the agent directory
(a leading `~` means your home), and the runtime still discovers skills in your working
directory. Running an agent inside a repo picks up that repo's skills as well as the
agent's own. A configured path that does not exist is an error.

Skills discovered from the working directory are project-local, so Pi only loads them
once you trust the project (`pi -a`, or a trust setting). `agent` never passes `-a` for
you — trusting a repo is your call. Configured `skills` are always loaded.

**Model map** is a flat JSON object:

```json
{
  "fast": "openrouter/google/gemini-2.5-flash",
  "deep": "openrouter/anthropic/claude-sonnet-4"
}
```

A value is a template reference only when it is exactly `:key:`. Anything else is passed
to the runtime verbatim, and a missing file, missing key or non-string value is an error.

## Development

```sh
bun install
bun test          # unit + end-to-end tests
bun run typecheck
```

See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) for the architecture and design decisions.
[SPEC.md](SPEC.md) is the runtime-agnostic definition of an agent; [PLAN.md](PLAN.md) is
the build plan.
