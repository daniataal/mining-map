# Paperclip agents — git branch

All Paperclip agent work on the Meridian repo (`/workspace/repo` in Docker) uses **one branch**:

## `paperclip2`

| Rule | Detail |
|------|--------|
| **Branch** | `paperclip2` only — never commit on `main`, `Paperclip`, or feature branches |
| **On wake** | `git -C /workspace/repo checkout paperclip2` (create with `-b` if missing) |
| **Push** | Only when the issue explicitly requests it |
| **PRs** | Target `main` / default branch from `paperclip2` when ready |

Host Mac repo (`TARGET_REPO` in `~/ai-agent-stack/.env`) should also be on `paperclip2` before agent runs:

```bash
bash scripts/paperclip-branch-paperclip2.sh
```
