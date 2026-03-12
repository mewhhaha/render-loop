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

## Render a Focused Region

```bash
render-loop render \
  --entry-file ./preview/index.html \
  --out ./out/preview-hero.png \
  --selector .hero
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

## Inspect Aesthetics

```bash
render-loop render \
  --html-file ./fixtures/card.html \
  --output inspect \
  --out ./out/card-inspect.json
```

## Run A Responsive Inspect Sweep

```bash
render-loop render \
  --html-file ./fixtures/card.html \
  --output responsive \
  --responsive '{"includeScreenshots":false,"viewports":[{"name":"desktop","width":1440,"height":1100},{"name":"mobile","width":390,"height":844}]}' \
  --out ./out/card-responsive.json
```

## Return Screenshot Patches

```bash
render-loop render \
  --html-file ./fixtures/card.html \
  --output patches \
  --patch-width 512 \
  --patch-height 512 \
  --patch-include 0,3,4 \
  --out ./out/card-patches.json
```

## Compare Against A Baseline

```bash
render-loop render \
  --html-file ./fixtures/card.html \
  --output diff \
  --diff-base-image ./out/card-baseline.png \
  --diff-threshold 16 \
  --out ./out/card-diff.json
```

## Capture Hover And Focus States

```bash
render-loop render \
  --html-file ./fixtures/card.html \
  --output states \
  --states '{"includeBase":true,"actions":[{"name":"hover-cta","type":"hover","selector":".cta"},{"name":"focus-email","type":"focus","selector":"input[name=email]"}]}' \
  --out ./out/card-states.json
```

## Review Loop

1. Edit files.
2. Re-run the same render command to the same output path.
3. Open the updated image or read the updated JSON artifact and critique the result.
