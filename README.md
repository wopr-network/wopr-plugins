# wopr-plugins

Monorepo for all WOPR plugins. Contains 64 packages: 63 plugins covering channels, voice, AI providers, media, memory, utilities, and more, plus the shared [`plugin-types`](packages/plugin-types) package that defines the canonical type system.

Built with **pnpm workspaces** and **Turborepo**. Published to npm under the `@wopr-network` scope via **Changesets**.

## Packages

| Category | Count | Examples |
|----------|------:|---------|
| **channel** | 18 | discord, slack, telegram, msteams, whatsapp, irc, matrix, signal, twitter |
| **plugin** | 14 | acp, evangelist, mattermost, skills, soul, websearch, superpower-* |
| **voice** | 10 | voice-call, voice-cli, voice-elevenlabs-tts, voice-whisper-local, voice-deepgram-stt |
| **utility** | 6 | browser, cron, exec, http, tools, webhooks |
| **provider** | 5 | provider-anthropic, provider-openai, provider-codex, provider-kimi, provider-opencode |
| **media** | 3 | canvas, imagegen, videogen |
| **system** | 3 | router, setup, webui |
| **memory** | 2 | memory-obsidian, memory-semantic |
| **integration** | 1 | mcp |
| **network** | 1 | p2p |

All plugins are scoped as `@wopr-network/wopr-plugin-<name>`. The type definitions live in [`@wopr-network/wopr-plugin-types`](packages/plugin-types).

## Getting started

```bash
git clone https://github.com/wopr-network/wopr-plugins.git
cd wopr-plugins
pnpm install
pnpm turbo build
```

Requirements: Node 22+, pnpm 9+.

## Development workflow

1. Create a branch for your changes.
2. Edit plugin source under `packages/<plugin-name>/src/`.
3. Run lint and build locally:
   ```bash
   pnpm turbo lint build --filter=<plugin-name>
   ```
4. Run tests:
   ```bash
   pnpm turbo test --filter=<plugin-name>
   ```
5. Add a changeset describing your change:
   ```bash
   pnpm changeset
   ```
6. Commit everything and open a PR. Merge queue is enforced -- CI must pass before merge.

## Publishing (Changesets two-PR flow)

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

1. **Add a changeset** -- when your PR includes a user-facing change, run `pnpm changeset` and select the affected packages and semver bump type. Commit the generated `.changeset/*.md` file with your PR.

2. **Version PR** -- after changesets merge to `main`, the Release workflow automatically opens (or updates) a "chore: version packages" PR that bumps `package.json` versions and updates changelogs.

3. **Publish** -- merging the version PR triggers `changeset publish`, which publishes all bumped packages to npm with public access.

All packages are published with `"access": "public"` under the `@wopr-network` scope.

## CI pipeline

The **CI** workflow runs on every PR and push to `main` (self-hosted runners):

| Step | Command | What it checks |
|------|---------|----------------|
| Lint | `pnpm turbo lint --filter='...[origin/main]'` | Biome lint on affected packages |
| Build | `pnpm turbo build --filter='...[origin/main]'` | TypeScript compilation (tsc) |
| Test | `pnpm turbo test --filter='...[origin/main]'` | Vitest on affected packages |
| Registry | `pnpm run generate-registry --check` | Plugin registry is up to date |
| Validate | `pnpm turbo validate-package --filter='...[origin/main]'` | Package structure validation |

CI uses Turbo's `--filter='...[origin/main]'` to only lint, build, and test packages affected by the change.

Merge queue (`merge_group`) is enabled -- PRs enter the queue only after CI passes.

## Adding a new plugin

1. Create the package directory:
   ```bash
   mkdir -p packages/plugin-<name>/src
   ```

2. Add a `package.json`:
   ```json
   {
     "name": "@wopr-network/wopr-plugin-<name>",
     "version": "1.0.0",
     "type": "module",
     "main": "dist/index.js",
     "types": "dist/index.d.ts",
     "scripts": {
       "lint": "biome check src/",
       "build": "tsc",
       "test": "vitest run --passWithNoTests",
       "prepublishOnly": "npm run build"
     },
     "license": "MIT",
     "woprPlugin": {
       "category": "<category>",
       "tags": ["wopr", "wopr-plugin"],
       "maturity": "alpha"
     }
   }
   ```

3. Add a `tsconfig.json` extending the shared base:
   ```json
   {
     "extends": "../../tooling/tsconfig.base.json",
     "compilerOptions": { "outDir": "dist", "rootDir": "src" },
     "include": ["src"]
   }
   ```

4. Write your plugin entry point in `src/index.ts`.

5. Run `pnpm install` from the repo root to link the new workspace.

6. Regenerate the plugin registry:
   ```bash
   pnpm run generate-registry
   ```

7. Verify everything:
   ```bash
   pnpm turbo lint build test --filter=plugin-<name>
   ```

## Plugin registry

The file `plugin-registry.json` at the repo root is the machine-readable index of all 63 plugins. It records each plugin's name, version, description, category, tags, and maturity level.

Regenerate it after adding or modifying plugins:

```bash
pnpm run generate-registry
```

CI validates the registry is current via `pnpm run generate-registry --check`. If the check fails, regenerate and commit the updated file.

You can also validate all plugin manifests independently:

```bash
pnpm run validate-manifests
```

## License

MIT
