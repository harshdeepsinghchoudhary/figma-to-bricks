# Codex replaces the API normalization provider

Implemented extraction -> Codex normalization -> existing validation/postprocessing -> Bricks compiler. CLI selects `--provider codex`; MCP `compile_design` defaults to codex, with explicit `mode: deterministic` preserving the previous no-model path. Restart the MCP client connection to refresh tools.

```powershell
npm.cmd run pipeline -- "<Figma URL with node-id>" --provider codex --force --no-inject --no-visual
```

Uses existing local Codex authentication, optional CODEX_HOME or CODEX_API_KEY, optional CODEX_MODEL. No Groq key required. The SDK runs in an isolated temporary configuration with shell, patch tools, apps and inherited MCP configuration unavailable. Credentials and temporary screenshots are removed afterwards. The normalizer receives the existing prompt, cropped screenshot, manifest, schema, and validation-repair conversation. Source measurements still reconcile model output as in the existing API workflow. Codex sections use a 24000-token split budget instead of Groq's 4600-token default; explicit --split overrides it. Failed validation cannot silently fall back to deterministic leaf output in Codex mode.

Verified: 101 tests pass. A REAL authenticated SDK normalization of source node 11:4084 (section-01x) in recreate-attached-design-e3902415 succeeded with network access, produced schema-validated normalized.json and compiled successfully. The initial sandboxed attempt failed workspace routing; approved network-enabled retry succeeded. Log: `.review-work/codex-live-normalization.log`. Only this section was regenerated with Codex; other sections remain prior outputs. This is not full-page visual acceptance. No WordPress injection or GitHub push.

Adapter regression tests use a fake runtime explicitly to check prompt/image forwarding, restricted settings and cleanup. Those tests are separate from the real one-section run. Existing MCP smoke compile now explicitly uses deterministic mode to avoid unexpected model usage.

Next: run all sections with the command above (or saved --frame), then compare with source screenshot and actual WordPress frontend. Keep --force when replacing prior cached deterministic normalization. Do not claim exact design matching from successful compilation.

SDK reference verified: https://learn.chatgpt.com/docs/codex-sdk and installed @openai/codex-sdk README.
