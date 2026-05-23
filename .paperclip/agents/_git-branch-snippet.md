## Git branch (mandatory)

All repo work uses branch **`paperclip2`** only (`/workspace/repo` in Docker).

**First commands on every wake** (before edits):

```bash
git -C /workspace/repo fetch origin 2>/dev/null || true
git -C /workspace/repo checkout paperclip2 2>/dev/null || git -C /workspace/repo checkout -b paperclip2
git -C /workspace/repo branch --show-current
```

Do **not** use `main`, `Paperclip`, or other branches. Do **not** push unless the issue says so.
