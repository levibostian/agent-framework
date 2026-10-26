# Agent Spec

The abstract definition of an agent. This document is stable and runtime-agnostic: it says
what an agent *is*, not how any particular tool runs one. The `agent` CLI is one consumer;
the adapter layer (see [Adapter contract](#adapter-contract)) is what translates this spec
into a concrete runtime such as Pi.

## Purpose and layer boundary

An agent is **metadata on disk**. It is not code, not a process, and not tied to a vendor.
The spec defines:

- where agent metadata lives and how an agent is named,
- the fields that metadata may contain,
- how those fields are resolved into a concrete, fully-specified run request,
- the boundary a runtime adapter must implement.

Anything specific to Pi — flags, tool names, session files, model syntax — belongs in an
adapter, never in this spec.

## Responsibilities

1. Define the on-disk layout and the naming rule.
2. Define the config schema, field semantics, and validation rules.
3. Define resolution: turning symbolic values (model templates, command-generated system
   prompts) into concrete values.
4. Define the normalized run request handed to an adapter.

## Non-goals

- Choosing a model provider, credentials, or session storage.
- Defining the agent loop, tool execution, or context management. The runtime owns those.
- Defining how an agent is invoked as a sub-agent by another agent. `description` is
  recorded for that purpose; the mechanism is out of scope here.
- Versioning or migrating agent configs. A config is read at run time as written.

## Discovery and naming

Agents live in a single root directory:

```
~/.agent/
  <agent-name>/
    agent.json | agent.yaml | agent.yml
```

- The **agent name** is the directory name. It is the only identifier a caller uses.
- Exactly one config file must exist in the directory. Zero or more than one is an error.
- `~/.agent` is the default root. The root must be overridable (env var and/or CLI flag) so
  tests and alternate setups do not touch the user's real agents.
- The agent directory holds metadata only. It is never the working directory of a run.
  A run uses the caller's current working directory.

### Name rules

A name is valid when it is non-empty and matches `[A-Za-z0-9._-]+`. Names must not be
`.`, `..`, or contain a path separator. This keeps name lookup from escaping the root.

## Config schema

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `description` | string | no | Human/agent-readable summary of what this agent does. When present, another agent can treat this agent as a skill: the description is the trigger text that tells the caller when to delegate here. |
| `system` | string | no | Static system prompt. |
| `system-cmd` | string | no | A command whose stdout becomes the system prompt. Runs at invocation time, so the prompt can be dynamic. |
| `tools` | string[] | no | Names of runtime built-in tools to enable (for example `bash`, `read`, `write`, `grep`). Omitted means "runtime default tool set". |
| `model` | string | yes | Model identifier, either literal or a template reference. See [Model resolution](#model-resolution). |

Unknown fields are an error. Silently ignoring a typo turns a config bug into a silently
different agent.

`system` and `system-cmd` are mutually exclusive. Supplying both is an error: there is no
sensible precedence, and guessing hides intent. Both may be absent, in which case the run
uses the runtime's own default system prompt.

### Field notes

- `description` has no effect on a single `run`. It exists so a caller can build a catalog
  of available agents and decide when to delegate. Any catalog format is a consumer
  concern.
- `system-cmd` runs through the shell (`/bin/sh -c`) so both an inline pipeline and a path
  to an executable script with a shebang work. It runs with the caller's working directory
  and environment. A non-zero exit is an error; its stderr is surfaced.
- `tools` is an ordered list of runtime tool names. The spec does not define the universe of
  names; the adapter maps them to its runtime and reports unknown names as errors where the
  runtime can tell.
- An empty `tools` array means "no tools", which is distinct from an omitted `tools` field
  meaning "runtime default".

## Model resolution

`model` is one of two forms:

1. **Literal.** A string the runtime understands as-is, for example
   `openrouter/anthropic/claude-sonnet-4`.
2. **Template reference.** The string `:key:`, resolved against the model map at
   `~/.agent/models.json`.

The model map is a flat JSON object of `key` to model string:

```json
{
  "fast": "openrouter/google/gemini-2.5-flash",
  "deep": "openrouter/anthropic/claude-sonnet-4"
}
```

With that file, `"model": ":deep:"` resolves to `openrouter/anthropic/claude-sonnet-4`.

Rules:

- A value is a template reference only when it is exactly `:key:` — a leading colon, a key
  body, and a trailing colon. Anything else is a literal.
- A missing model map file, a missing key, or a non-string value is an error. Model
  resolution never silently falls back.
- A template reference must resolve to a single string. Chained references are not
  supported; a resolved value is used verbatim.
- The map path is overridable the same way the agent root is, for tests.

## Normalized run request

Resolution produces one runtime-agnostic value. This is the entire interface between the
spec layer and a runtime:

```
ResolvedAgent {
  name:         string
  dir:          string          // absolute path to the agent directory
  description?: string
  systemPrompt: string          // "" when neither system nor system-cmd was given
  systemPromptSource: "config" | "command" | "none"
  tools?:       string[]        // undefined means runtime default; [] means none
  model:        string          // literal, templates already resolved
}
```

Every field is concrete. An adapter never reads agent config, the model map, or the
filesystem layout.

## Invocation modes

`agent run <name> [prompt]` has two modes, both expressed as the same normalized request
plus an optional prompt:

- **One-shot.** A prompt is given. The runtime executes one request, prints the result to
  stdout, and exits.
- **Interactive.** No prompt. The runtime opens its interactive session so the user can
  converse with the agent.

The choice of mode is a caller concern; the adapter decides how to realize it.

## Adapter contract

An adapter binds this spec to a runtime. It must:

- accept a `ResolvedAgent` and an optional prompt,
- realize both invocation modes,
- stream runtime output to the caller's stdout and diagnostics to stderr,
- propagate the runtime's exit status,
- never mutate agent metadata.

The adapter is the only place runtime names appear. Adding a runtime means adding an
adapter, not editing this spec. The default adapter today is Pi; it maps `system` to the
runtime's system-prompt flag, `tools` to its tool-selection flag, and `model` to its model
flag, and it invokes the runtime as a subprocess so the CLI stays decoupled from it.

## Maintenance note

Change this document only when the *meaning* of an agent changes. Adding a runtime flag or
a Pi-specific default belongs in the adapter. Adding a config field is a spec change: it
must be added to the schema table, given resolution rules, and reflected in the normalized
request if an adapter needs it.
