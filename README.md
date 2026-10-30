# places.pick — Placard Pick module

Standalone [Placard](https://github.com/JobiJoba/Placard) Marketplace plugin. Spins one place from your library (any category, open tonight, near you, avoid recent).

## Install on a Placard instance

**From GitHub (recommended once you publish a Release):**

1. Settings → Module marketplace → **Install from GitHub**
2. Paste this repo URL (or `owner/repo`)
3. Placard installs the latest Release asset (`.placard-module` or `.zip`)

**From a local zip:**

1. `pnpm install && pnpm build`
2. Upload `dist/places.pick-0.1.1.zip` (or `.placard-module`) in Settings → Module marketplace

Then enable the module and show it in nav.

## Develop

```bash
pnpm install
pnpm build      # → pack/ + dist/*.zip + dist/*.placard-module
pnpm typecheck
```

Layout:

- `placard.module.json` — manifest
- `src/server` — `createModule()` HTTP + MCP
- `src/web` — `PickPage` (uses host React bridge shims)
- `scripts/build.mjs` — esbuild + zip

## Publishing a Release

1. Bump `version` in **both** `package.json` and `placard.module.json` (must match)
2. Commit and push to `main`
3. Tag and push: `git tag v0.1.1 && git push origin v0.1.1`
4. GitHub Actions **Release** builds the plugin and publishes a GitHub Release with:
   - `places.pick-<version>.placard-module` (preferred for Placard “Install from GitHub”)
   - `places.pick-<version>.zip`

CI on `main` / PRs runs typecheck + build.

## Notes

- Does **not** depend on the Placard monorepo. Host contracts are vendored in `src/placard-sdk.ts` (sdk major `0`).
- Web UI must not ship React — shims alias to `globalThis.__PLACARD_PLUGIN__`.
