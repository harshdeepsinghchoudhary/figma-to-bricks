# GitHub transfer and the RTX 3050 laptop

The current compiler runs nonvisual validation only. Ollama and a browser are optional for AI normalization/manual layout debugging. A missing vision provider or local vision model never blocks deterministic generation. See [README.md](README.md) for the updated workflow.

The latest failure is a Groq token quota (HTTP 429), not a GPU error. Here, Ollama's CLI is missing and its local server refuses connections. That does not establish hardware incompatibility.

Your RTX 3050 6 GB and 16 GB DDR5 RAM are a reasonable starting point for a small vision model. Ollama [lists RTX 3050 as supported](https://docs.ollama.com/gpu). Install current NVIDIA drivers and [Ollama for Windows](https://docs.ollama.com/windows). Start by testing [Gemma 3 4B](https://ollama.com/library/gemma3:4b), a vision model whose current Q4 package is about 3.4 GB. Model size is not total runtime VRAM; context, images and other applications also consume memory. Actual speed, GPU residency and visual quality require testing on that laptop.

## Transfer

Use a private GitHub repository when including proprietary designs. Review and commit source, tests, schemas, configuration examples and documentation. To resume CasinoFX, also transfer `output/casinofx-homepage/`, including assets, screenshots, manifests, normalized sections, saved model parts, visual caches and each section's `bricks-id-namespace.json`. The namespace files preserve existing element IDs across device/directory changes.

Keep `.env` private and re-enter/copy credentials separately. It is ignored and is not tracked in the current repository. Do not copy `node_modules`; install fresh native dependencies on the new device. Global client skills and downloaded Ollama models are separate installations.

Example file selection; review it before committing:

```powershell
git status --short
git check-ignore .env
git add scripts tests tools schema config README.md MIGRATION.md package.json package-lock.json .env.example .gitignore
git add output/casinofx-homepage
git diff --cached --stat
git commit -m "Upgrade native compiler and preserve optional manual layout debugging"
# Push to your own private repository using your existing remote.
```

The existing `output.zip` was already tracked before these changes. New archives are ignored, but `.gitignore` does not remove old tracked files. Transfer current source/cache folders rather than relying on that old archive.

## On the GPU device

```powershell
git clone <your-private-repository-url>
cd figma-to-bricks
npm.cmd ci
Copy-Item .env.example .env  # only if .env does not already exist
ollama pull gemma3:4b
```

Start Ollama's application. If the server is not running, use `ollama serve` in a separate terminal. Open a new terminal after installation if `ollama` is not yet on PATH.

Merge [config/ollama-6gb.env.example](config/ollama-6gb.env.example) into `.env`, preserving your credentials, if you choose local AI normalization or manual debugging. It selects `gemma3:4b`, sets `OLLAMA_NUM_CTX=8192`, `VISUAL_MAX_TOKENS=2048`, `VISUAL_TIMEOUT_MS=600000`, and disables cloud throttling with `VISUAL_DELAY_MS=0`. Deterministic normalization uses no model.

The context is smaller than the old 32K default because [larger contexts use more memory](https://docs.ollama.com/context-length). This is a starting profile, not a guarantee of full GPU residency. `ollama ps` shows GPU/CPU offloading after a model is loaded. Check a small section before running the entire page.

```powershell
npm.cmd run doctor -- --offline
npm.cmd test
npm.cmd run pipeline -- --frame output/casinofx-homepage --deterministic --no-inject
# Optional setup checks only if you intend to use local AI or manual debugging.
npm.cmd run doctor -- --ollama
npm.cmd run check:vision
# Only after observing a specific layout problem on the frontend:
npm.cmd run visual -- output/casinofx-homepage --only=section-01 --problem="Header content overlaps" --page-url="https://your-staging-site/page/"
```

Changing provider/model starts a new visual cache identity; existing Groq reviews remain available if you switch back. Ollama avoids Groq's cloud quota but can still make incorrect judgments, so patches must pass validation and re-review.

## Current quota handling

HTTP 429 now creates a `waiting-for-provider` checkpoint with the server's suggested retry time and exit code 75. Completed reviews remain cached. Re-running before that time avoids another rate-limited request. A configured, available Ollama fallback can continue. This cannot increase your account quota or guarantee the next request will fit after the cooldown.

Your log suggested about 10 minutes 20 seconds at that request time. That does not mean the whole remaining page would then fit within the rolling daily quota. Groq's 65-second spacing also makes a full multi-round review slow.

## Verification still required

Automated nonvisual tests, saved-input compilation and read-only Bricks rendering can verify data/structure acceptance. The GPU laptop is not accessible now, so Ollama inference and memory use there remain unverified. Site fonts/global styles and interactive behavior require frontend inspection. Visual debugging is never a generation gate and an accepted JSON build must not be called a verified visual match.
