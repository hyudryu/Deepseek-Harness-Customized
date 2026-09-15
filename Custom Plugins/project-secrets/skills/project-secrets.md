# Project Secrets

Use this skill when you need a project-specific value that the repository does
not carry — credentials, API keys, server hostnames, SSH targets, usernames,
passwords, tokens, and other per-project connection details.

The block is stored for the project's working directory and is viewable and
editable in the web GUI from the project's 3-dots menu → **Project Secrets**.

## Rules

1. **Read before you answer.** When a question asks for a project-specific
   value, call `project_secrets` with `action: "read"` **before** replying that
   you do not know it. Never answer "I don't have that" about this project
   without having read the block in this session. When the block is not empty,
   the session context lists its key names — if one of them matches the
   question, read the block.
2. **Never echo secrets back** into the conversation, tool output, commits, or
   logs unless the user explicitly asks. Prefer to reference the values by name
   rather than printing them.
3. **Write authoritatively.** `action: "write"` replaces the whole block. Only
   call it when the user asks you to save or update the secrets.
4. **Respect the project boundary.** These secrets are for the current project
   directory only; do not use them in a different project.
5. Keep the block short and structured — one `Key: value` line each — so future
   reads and the key-name list in context stay unambiguous.
