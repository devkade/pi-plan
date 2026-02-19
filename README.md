# @devkade/pi-plan

Opt-in **read-only planning mode** for Pi via `/plan`, while keeping default behavior execution-first (YOLO).

## Quick Start

### Local development

```bash
npm install
npm run check
pi -e ./src/index.ts
```

## How It Works

### Default mode (YOLO)

- Normal execution mode.
- The extension does not enforce plan/approval unless you explicitly use `/plan`.

### Plan mode (`/plan`)

- Switches active tools to a read-only subset when available.
- Blocks mutating tools: `edit`, `write`, `ast_rewrite`.
- Filters `bash` through a read-only allowlist.
- Injects a planning system prompt that requires:
  1. Goal understanding
  2. Evidence gathered
  3. Uncertainties/assumptions
  4. Execution plan (steps, targets, validation)
  5. Risks/rollback
  6. `Ready to execute when approved.`

### Approval loop

After each plan-mode response (UI sessions), you can choose:
- Approve and execute now
- Keep planning (read-only)
- Exit plan mode

On approval, plan mode is disabled and execution starts immediately.

## Commands

- `/plan` — toggle plan mode on/off
- `/plan on` — enable plan mode
- `/plan off` — disable plan mode
- `/plan status` — show current mode
- `/plan <task>` — enable plan mode (if needed) and start planning for `<task>`

## Documentation Map

- Extension behavior and command handling: [`src/index.ts`](src/index.ts)
- Read-only bash safety rules: [`src/utils.ts`](src/utils.ts)
- CI workflow: [`.github/workflows/ci.yml`](.github/workflows/ci.yml)
- Release and npm publish workflow: [`.github/workflows/release.yml`](.github/workflows/release.yml)

## Package & Release

- npm package: `@devkade/pi-plan`
- Scope policy: `@devkade/*`
- `publishConfig.access`: `public`

Release workflow is tag-driven (`v*.*.*`) and runs:
1. `npm ci`
2. `npm run check`
3. Tag/version consistency validation
4. `npm publish --access public --provenance`
5. GitHub Release creation

Example:

```bash
npm version patch
git push origin main --tags
```

For Trusted Publishing, connect this repository in npm package settings.
