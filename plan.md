# pi-plan Feature Plan

## Goal

Extend `pi-plan` from basic read-only planning into a lightweight execution companion by adding:

1. Plan-progress visibility with `/todos`

## Added Capabilities

- `/todos` reports current plan step completion (`[DONE:n]` markers).
- Plan-mode next action menu includes:
  - `Continue from proposed plan` (iterative refinement)
  - `Regenerate plan` (fresh plan output)

## Out of Scope (moved outside `pi-plan` package)

The following are not implemented in `pi-plan` package code:

- `/handoff <goal>` command (user-local runtime asset under `~/.pi/agent/extensions`)
- `/tmux` status/widget command (provided by `pi-exec-plane` root extension)
- `tmux-helper` skill documentation (user-local skill under `~/.agents/skills`)

## Follow-ups

- Add package-level tests for `/todos` command paths.
- Consider plan-state persistence across session resume.
