---
name: agent-framework
description: Create or change an agent for the `agent` CLI, then verify `agent run` returns the expected output. Use when the user wants a new agent, to edit or debug an agent config (agent.yaml/agent.json), or to confirm an agent works.
compatibility: Requires the agent CLI on PATH.
---

# agent-framework

An agent is a directory under the agent root (`$AGENT_HOME`, else `~/.agent`) holding one
config file. This skill creates or edits that config, then proves `agent run` returns the
output you expect.

`agent spec` is the schema and the rules. Read it before adding a field; do not guess fields.

## Create or edit an agent

1. Create or edit `<agent root>/<name>/agent.yaml` (or `agent.json`/`agent.yml`). The directory
   name is the agent name, and `model` is the only required field.
   *Done when:* exactly one config file exists in that directory.
2. Run `agent spec` and set the fields this agent needs.
   *Done when:* every field you wrote is one `agent spec` documents.

```yaml
# ~/.agent/hello/agent.yaml
description: Greets people, tersely.
system: You are terse.
model: ":fast:"
```

If `model` is `:key:`, add the key to `<agent root>/models.json`:

```json
{ "fast": "openrouter/google/gemini-2.5-flash" }
```

## Validate

Run the agent with a prompt that proves its purpose, then read stdout:

```sh
agent run hello "say hi"
```

*Done when:* stdout is the result you expected. If the run errors or prints something else,
fix the config and run again.

## Spec

`agent spec` prints the authoritative spec: naming, the config schema, model and skill
resolution, and the normalized run request. It is read-only and offline.
