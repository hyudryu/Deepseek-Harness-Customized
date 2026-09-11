# Project System Prompt (`dsh-project-system-prompt`)

Replace the system prompt for every session in one project, from the project's
3-dots menu.

Each project row in the sidebar menu gains a **System prompt override…** item.
It opens an editor whose field holds that project's saved prompt. Saving
non-empty text makes it the *entire* system prompt for sessions whose working
directory is that project. An empty field removes the override.

**Restore DeepSeek default** copies the prompt the deployment would otherwise
assemble into the field, so an override can start from the shipped text instead
of a blank page. Prompt variables are already interpolated in that copy — it is
the literal text the model would receive.

## Storage

The override is a plain-text file in the project directory:

```
<project>/.dsh/system-prompt.md
```

Storing it in the project keeps it beside the code it applies to, so it can be
committed, reviewed, and diffed like any other project file. The plugin reads it
with an mtime/size stamp, so an unchanged file is not re-read on every model
step. Clearing the field deletes the file rather than leaving an empty one, so
"no override" has exactly one durable representation.

## Configuration

Patch entry (`cordis.patch.yml` by default):

| Field | Default | Meaning |
| --- | --- | --- |
| `promptFile` | `.dsh/system-prompt.md` | Override file, resolved against the project directory. An absolute path is used as-is. |
| `maxBytes` | `200000` | Maximum override size in UTF-8 bytes. Enforced on read and write. |
| `root` | `''` | Optional prefix for the project directory, for projects served from a different mount. |

## How the replacement works

The plugin registers one listener on the `system-prompt/assemble` waterfall. It
is registered on the plugin's own unscoped context, so scope filtering admits it
for every assembly; the assembly context carries the agent, and
`agent.session.header.cwd` names the project. When that project has an override,
the listener returns the assembly with its `sections` replaced by a single
`project:system-prompt-override` section. The waterfall's return value is
authoritative, which is what makes the replacement take effect on the next
model step — no session restart, and no change to the running agent.

Tool schemas, runtime contexts, and prompt variables still assemble normally.
Only the section list that renders the request's `system` field is replaced, so
the tool set the model is offered is unchanged.

Because the assembled prompt is written to the session log's `request/header`
events, the override is recorded in durable history exactly like the default
prompt, and the Chat transcript's system-prompt row shows the override text.

## Agent-facing effect

Nothing is added to the model's tool set; the plugin is a prompt and UI feature
only. A project with no override file behaves exactly as before.

## Known Limitations and Deferred Work

- **Replacing the prompt drops the deployment's own guidance.** The shipped
  persona and the per-tool usage sections are part of the assembled prompt, so
  an override that does not carry them over removes them. **Restore DeepSeek
  default** exists to make that recoverable; start from it and edit.
- **A `complete` prompt section still wins.** A composition that registers a
  section with `complete: true` (an agent preset persona, for example) is
  restored *after* the assembly waterfall, so an override does not apply to that
  scope. No shipped web-profile composition does this.
- **The override is per project directory, not per workspace record.** Two
  workspaces pointing at one directory share an override, and a session opened
  in a subdirectory reads that subdirectory's file, not its parent's.
- **Compaction does not interact with it.** Compaction replaces a span of the
  message surface (`user/message`, `assistant/message`, `tool/result`); the
  system prompt is re-assembled on every model step and is not part of that
  surface, so `/compact` leaves the override in force.
- **The editor does not show a diff from the default.** Restore overwrites the
  field; it does not merge.

## Tests

```sh
cd "Custom Plugins/project-system-prompt"
node --test test/project-system-prompt.test.mjs
```

Covers path resolution, the byte bound, the assembly listener against both a
context double and the real `@deepseek-ai/dsh-system-prompt` service, and every
browser route.
