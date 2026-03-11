# Command Patterns

Use these from the repo you are editing. The `render-loop` command itself is expected to be installed on `PATH`.

## Health Check

```bash
render-loop health
```

If this succeeds, reuse the existing daemon.

## Start the Daemon

```bash
render-loop serve
```

Run this in a long-lived PTY session. Do not stop it if it is acting as the shared daemon for other Codex runs.

## Render a Local Entry File

```bash
render-loop render \
  --entry-file ./preview/index.html \
  --out ./out/preview-desktop.png \
  --width 1440 \
  --height 1100 \
  --wait-for-selector .ready
```

## Render a Mobile Variant

```bash
render-loop render \
  --entry-file ./preview/index.html \
  --out ./out/preview-mobile.png \
  --width 390 \
  --height 844 \
  --wait-for-selector .ready
```

## Render a Static HTML File

```bash
render-loop render \
  --html-file ./fixtures/card.html \
  --out ./out/card.png
```

## Render a Served URL

```bash
render-loop render \
  --url http://127.0.0.1:3000 \
  --out ./out/page.png \
  --wait-for networkidle
```

## Review Loop

1. Edit files.
2. Re-run the same render command to the same output path.
3. Open the updated image and critique the result.
