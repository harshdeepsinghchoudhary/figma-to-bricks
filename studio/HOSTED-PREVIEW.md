# User-owned credentials and private multi-user preview

Implemented 2026-10-28. This is a local private-beta environment, not an internet-ready deployment. It deliberately binds only to 127.0.0.1. Do not expose it through a public tunnel or reverse proxy yet.

## Start

Requires Node 24, installed dependencies and a built Studio frontend:

```powershell
npm.cmd run studio:build
$env:STUDIO_INVITE_CODE = [guid]::NewGuid().ToString('N')
Write-Host $env:STUDIO_INVITE_CODE
npm.cmd run studio:accounts
```

Visit http://127.0.0.1:4318. Choose **Use an invite**, then create an account with that code. The invite is a registration secret; do not commit it. Accounts are stored in ignored `.studio-hosted/accounts.sqlite`. Passwords use salted scrypt, session identifiers are stored as hashes, and sessions expire after 12 hours. Registration/sign-in requests are rate-limited. There is no password recovery/email verification yet.

Each account gets a separate workspace and Node process. Operator `.env`, project output, local Codex login and site-specific runtime schemas are never copied into accounts. Subprocess environments allow only selected OS variables and the account's own credentials. A four-worker and 50-account cap is intentional for this private preview. Worker allocation lasts until restart; no distributed queue or idle-worker eviction yet.

## User connections

Under Integrations, choose a provider and enter your own key/model:

| Provider | Credential | Execution |
| --- | --- | --- |
| Codex SDK | OpenAI API key (`CODEX_API_KEY`) | Restricted Codex SDK reasoning |
| Claude API | Anthropic API key | Studio-controlled visual repair loop using Claude API |
| Gemini API | Gemini API key | Same bounded controller with Gemini vision |
| Groq API | Groq API key | Same bounded controller with compatible vision model |
| NVIDIA API | NVIDIA API key | Same bounded controller with compatible vision model |

Claude API support is not a Claude Agent SDK/Claude subscription-login integration. Other providers are not arbitrary user-installed executables. Only these explicit adapters are supported. API billing is associated with the key's provider account; hosting/storage costs still belong to the app operator.

Keys are kept in the account worker's memory unless the user saves them in the existing passphrase-encrypted vault. Unlock the vault after restarting. Remove selected API key removes the session value; re-save the vault to persist removal. No API key value is returned in state responses. Users separately provide their Figma token and WordPress MCP credentials.

The one-click draft workflow uses the selected provider. In account mode it first retrieves the connected site's Bricks schema using the existing read-only MCP sync. It never borrows another user's site schemas. Manual compile/review can fail until that site schema is available.

## Account-based agent sign-in

Hosted mode rejects the local Codex device-login endpoint. The local single-user Studio continues to offer it. A public account-login integration must use the provider's supported registration and OAuth product, not copied subscription sessions.

- OpenAI: https://learn.chatgpt.com/docs/app-server — describes the restrictions on hosted app-server authentication and links to Sign in with ChatGPT.
- Anthropic: https://code.claude.com/docs/en/agent-sdk/overview — third-party claude.ai login requires prior approval; API keys are supported.

No universal "connect any agent subscription" mechanism is implemented or promised.

## Tests actually run

- Production frontend build and 97 regression tests passed.
- `node tools/studio-accounts-smoke.mjs` starts real separate worker processes, creates two accounts, checks private credential flags/projects, sign-out and rejection of hosted device login. It also signs in through Playwright on a 390px viewport and checks provider controls and overflow.
- `node tools/studio-smoke.mjs` verifies the original local Studio interface remains usable.
- These account tests use fake credentials and do not make provider calls or WordPress writes. No live public service has been deployed.

## Required before internet launch

Container-level filesystem/process isolation and CPU/memory limits; outbound network policy covering redirects, private addresses and DNS rebinding for WordPress URLs/browser capture; HTTPS and secure cookie configuration; registered provider OAuth if desired; account recovery/email verification; durable queue and worker lifecycle; tenant storage quotas/retention; encrypted managed secrets/key rotation; backups, audit events and operational monitoring; end-to-end testing with separate real customer sites.

Current separate-process/workspace isolation is an application boundary, not an OS security boundary. The loopback gate is intentional until the remaining controls are implemented. No GitHub push or cloud deployment was performed.
