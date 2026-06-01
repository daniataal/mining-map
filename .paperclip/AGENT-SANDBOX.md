# Agent sandbox (all Paperclip agents)

**Allowed**

- Read/write **`/workspace/repo`** (branch **`paperclip2`** unless issue says otherwise)
- `git` operations inside the repo when the issue asks (commit, branch, diff)
- Web fetch/search for public docs and APIs
- Paperclip API (`/api/*`) with run headers
- **`/paperclip/instances/**`** for agent homes and workspaces

**Not allowed**

- Reading or copying **`.env`**, API keys, or credentials from the repo mount
- Modifying the **host Mac** outside Docker (agents run as `node` in `paperclip-safe` only)
- `docker`, `sudo`, or system package installs on the host
- Scraping paid BOL portals or bypassing paywalls

**After fleet permission changes:** Resume agent → **New run** (not Retry).
