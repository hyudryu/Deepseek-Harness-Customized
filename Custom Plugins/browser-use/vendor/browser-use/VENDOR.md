# Vendored browser-use

Pinned source copy of the [browser-use](https://github.com/browser-use/browser-use) Python library (MIT license; upstream `LICENSE` preserved in this directory). Copied so the plugin carries the library itself and no separate `pip install browser-use` is needed.

| Field | Value |
| --- | --- |
| Upstream repository | https://github.com/browser-use/browser-use |
| Upstream commit | `2b1f9d377999a59fe7627c1a5aa88c12aa42e11f` |
| Upstream version | 0.13.10 (`browser_use/pyproject.toml`) |
| Copied on | 2026-09-07 (upstream commit date) |
| Copied paths | `browser_use/`, `pyproject.toml`, `LICENSE`, `README.md` |
| Local modifications | Trailing whitespace stripped (8 files) to satisfy the repository pre-commit gate; semantically insignificant, no other changes |

## Sync procedure

1. Replace the contents of this directory with the four copied paths from the desired upstream commit.
2. Update the table above with the new commit, version, and date.
3. Delete the host-side runtime marker (`<venvRoot>/.ready`, default `~/.dsh/browser-use/.ready`) or bump the marker format so the next tool call rebuilds the virtual environment from the new source.
4. Run `node --test "Custom Plugins/browser-use/test/*.test.mjs"` and exercise one real `browser_use` run against a live Chrome.

The Python dependencies pinned in the vendored `pyproject.toml` are installed into the plugin-managed virtual environment on first use (see `../../README.md`); they are not vendored.
