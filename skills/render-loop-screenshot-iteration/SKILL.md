---
name: render-loop-screenshot-iteration
description: "Use this skill when a Codex CLI run needs to iterate on webpage screenshots through the local render-loop daemon instead of launching Playwright for every render. Best for HTML/CSS/JS preview loops, `entryFile` or `htmlFile` renders, viewport checks, and screenshot-driven refinement. Skip when no visual render is needed or when a Playwright test harness is the real target."
---

# Render Loop Screenshot Iteration

Use this skill to keep screenshot iteration tight: edit files, render through the installed `render-loop` command, inspect the image, and repeat. Favor the shared user-level daemon and deterministic output paths over ad hoc Playwright scripts.

## Model Contract

- Assume the goal is visual iteration from Codex CLI, not browser-test authoring.
- Prefer `render-loop` over writing a new Playwright harness when the user wants a screenshot or preview quickly.
- Assume `render-loop` is installed on `PATH` and works from any repo.
- Reuse an existing daemon when available. Do not stop a shared daemon unless the user asks.
- Render to a stable path so later turns can overwrite and compare the same artifact.
- Review the produced image before claiming the page is done.

## Workflow

1. Decide the render target.
   Prefer `--entry-file` for a local HTML entry with relative assets, `--html-file` for a static file, and `--url` only when the target is already served elsewhere.
2. Let the CLI handle the daemon.
   `render-loop render` should auto-connect to the shared daemon or start it if needed. Use `render-loop health` only when debugging daemon state.
3. Render the current state.
   Use `render-loop render ... --out <stable-path>` with explicit viewport and wait controls when needed. For first-pass UI work, render one desktop shot and one mobile shot.
4. Inspect the screenshot.
   Open the written image artifact with the image tool and critique the actual render, not the code alone.
5. Iterate.
   Change the files, rerender to the same path, and re-inspect. Keep the cycle edit -> render -> inspect until the page is acceptable.

Read [references/commands.md](./references/commands.md) for concrete command patterns.

## Fallback Rules

- If `render-loop render` cannot connect or auto-start the daemon, say so explicitly and explain the blocker.
- If a render depends on JS boot or async content, use `--wait-for-selector` or `--wait-for-timeout` instead of assuming `load` is enough.
- If screenshot review tooling is unavailable, say that the visual verification step was skipped and do a static code review only as a fallback.
- If the user asks for browser-test behavior, accessibility automation, or interaction scripts, switch out of this skill and use the proper test harness instead.

## Done

The task is done when:

- the target page renders through `render-loop`,
- the final artifact path is reported clearly,
- the screenshot has been inspected,
- and any daemon lifecycle action taken by the agent is explained.
