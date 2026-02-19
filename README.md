# Pi Plan Extension (`@devkade/pi-plan`)

An extension for the [Pi coding agent](https://github.com/badlogic/pi-mono/) that adds an opt-in `/plan` mode:

- **Default mode:** execute directly (YOLO)
- **Plan mode:** read-only investigation + concrete execution plan
- **Execution starts only after approval** from the plan-mode UI prompt

```txt
/plan on
/plan Refactor command parser to support aliases
```

---

## Why

Sometimes you want speed, sometimes you want safety.

This extension gives both:

- **No global slowdown** in normal workflows (default remains execution-first)
- **Structured planning mode** only when you request it
- **Read-only guardrails** while planning (tool + shell protections)
- **Explicit approval handoff** before implementation begins

---

## Install

### From npm

```bash
pi install npm:@devkade/pi-plan
```

### From git

```bash
pi install git:github.com/devkade/pi-plan@main
# or pin a tag
pi install git:github.com/devkade/pi-plan@v0.1.1
```

### Local development run

```bash
pi -e ./src/index.ts
```

---

## Quick Start

### 1) Start planning mode

```txt
/plan on
```

Then ask your task in the same session:

```txt
Implement release-note generator with changelog validation
```

### 2) One-shot plan command

```txt
/plan Implement release-note generator with changelog validation
```

This enables plan mode (if needed) and immediately sends the task.

### 3) Approve or continue planning

After each response in UI mode, you’ll get:

- **Approve and execute now**
- **Keep planning (read-only)**
- **Exit plan mode**

Choosing **Approve and execute now** automatically:
1. exits plan mode,
2. restores normal tools,
3. triggers implementation.

---

## Modes

| Mode | Behavior | Safety policy |
|---|---|---|
| Default (YOLO) | Executes directly unless you explicitly request planning | No extra restrictions |
| Plan (`/plan`) | Gathers evidence and returns an execution plan | Read-only tools + mutating action blocks |

---

## Plan-Mode Guardrails

### Tool restrictions

In plan mode:

- Mutating tools are blocked: `edit`, `write`, `ast_rewrite`
- Active tools are switched to a read-only subset when available

### Bash restrictions

`bash` commands are filtered through a read-only policy:

- ✅ inspection commands (examples): `ls`, `cat`, `grep`, `find`, `git status`, `git log`
- ❌ mutating commands (examples): `rm`, `mv`, `npm install`, `git commit`, redirection writes (`>`, `>>`)

---

## Plan Output Contract

In plan mode, the system prompt enforces this structure:

1. Goal understanding
2. Evidence gathered (files/symbols/docs checked)
3. Uncertainties / assumptions
4. Plan (step objective, target files/components, validation)
5. Risks and rollback notes
6. End with: `Ready to execute when approved.`

---

## Commands

- `/plan` — toggle plan mode on/off
- `/plan on` — enable plan mode
- `/plan off` — disable plan mode
- `/plan status` — show current status
- `/plan <task>` — enable mode if needed and start planning for `<task>`

---

## Development

```bash
npm install
npm run check
```

`npm run check` runs TypeScript type-checking (`tsc --noEmit`).

---

## Project Structure

- `src/index.ts` - command handling, mode switching, approval loop, prompt injection
- `src/utils.ts` - read-only bash allow/deny pattern checks
- `.github/workflows/ci.yml` - CI checks
- `.github/workflows/release.yml` - tag-triggered npm publish + GitHub Release

---

## Release

The release workflow runs on tags matching `v*.*.*` and performs:

1. `npm ci`
2. `npm run check`
3. tag/version consistency check
4. `npm publish --access public --provenance`
5. GitHub Release creation

Example:

```bash
npm version patch
git push origin main --tags
```
