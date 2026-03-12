---
name: render-loop-screenshot-iteration
description: "Use this skill when a Codex CLI run needs fast webpage rendering or inspection through the local render-loop daemon instead of launching Playwright for every pass. Best for HTML/CSS/JS preview loops, `entryFile` or `htmlFile` renders, viewport checks, screenshot-driven refinement, aesthetic inspection, clipped captures, screenshot patch extraction, visual diffs, responsive sweeps, and state captures. Skip when no render artifact is needed or when a Playwright test harness is the real target."
---

# Render Loop Iteration

Use this skill to keep render iteration tight: edit files, render through the installed `render-loop` command, inspect the resulting artifact, and repeat. Favor the shared user-level daemon and deterministic output paths over ad hoc Playwright scripts.

## Model Contract

- Assume the goal is render/inspection iteration from Codex CLI, not browser-test authoring.
- Prefer `render-loop` over writing a new Playwright harness when the user wants a screenshot, preview, inspect report, screenshot patches, a responsive sweep, a visual diff, or quick state captures.
- Assume `render-loop` is installed on `PATH` and works from any repo.
- Reuse an existing daemon when available. Do not stop a shared daemon unless the user asks.
- Render to a stable path so later turns can overwrite and compare the same artifact.
- Choose the lightest useful output:
  - `screenshot` for normal visual review
  - `inspect` for aesthetic heuristics, contrast, overflow, tap target, asset, and accessibility spot checks
  - `patches` when a tall screenshot should be reviewed in selected regions
  - `responsive` when the same page should be audited across a viewport matrix
  - `diff` when the new render should be compared against a saved baseline
  - `states` when hover, focus, or click states should be captured without writing custom browser code
- Use `selector` or `clip` when the user only wants a focused region, instead of over-producing a full-page image.
- Review the produced artifact before claiming the page is done.

## Workflow

1. Decide the render target.
   Prefer `--entry-file` for a local HTML entry with relative assets, `--html-file` for a static file, and `--url` only when the target is already served elsewhere.
2. Let the CLI handle the daemon.
   `render-loop render` should auto-connect to the shared daemon or start it if needed. Use `render-loop health` only when debugging daemon state.
3. Pick the output mode.
   Use `screenshot` for ordinary image review, `inspect` for heuristic analysis, `patches` when only selected regions of a large screenshot should be returned, `responsive` for breakpoint sweeps, `diff` for baseline comparison, and `states` for interactive snapshots.
4. Render the current state.
   Use `render-loop render ... --out <stable-path>` with explicit viewport and wait controls when needed. For first-pass UI work, render one desktop shot and one mobile shot unless the user only asked for inspection data.
5. Inspect the artifact.
   Open image artifacts with the image tool. Read JSON artifacts for `inspect`, `patches`, `responsive`, `diff`, and `states`, and only decode the regions or metrics that matter.
6. Iterate.
   Change the files, rerender to the same path, and re-inspect. Keep the cycle edit -> render -> inspect until the page is acceptable.

Read [references/commands.md](./references/commands.md) for concrete command patterns.

## Fallback Rules

- If `render-loop render` cannot connect or auto-start the daemon, say so explicitly and explain the blocker.
- If a render depends on JS boot or async content, use `--wait-for-selector` or `--wait-for-timeout` instead of assuming `load` is enough.
- If screenshot review tooling is unavailable, say that the visual verification step was skipped and do a static code review only as a fallback.
- If the user wants only one region of the page and already knows the coordinates, prefer `clip` over `patches`.
- If the user wants breakpoint coverage and a single artifact is not enough, prefer `responsive` over manually issuing a series of separate `inspect` commands.
- If the user wants to compare against a previous render, prefer `diff` over asking the model to eyeball two screenshots separately.
- If the user asks for browser-test behavior, richer accessibility automation, or interaction scripts, switch out of this skill and use the proper test harness instead.

## Done

The task is done when:

- the target page renders through `render-loop`,
- the final artifact path is reported clearly,
- the chosen artifact has been inspected,
- and any daemon lifecycle action taken by the agent is explained.
