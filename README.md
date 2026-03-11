# render-loop

`render-loop` is a small Node program for fast repeated webpage renders. Instead
of launching Playwright and a fresh Node process for every screenshot, you start
one daemon, keep a browser hot, and send render jobs to it over localhost HTTP.

## Why this exists

The expensive part of repeated render automation is process startup:

- booting Node
- importing Playwright
- launching Chromium
- rebuilding page state from scratch

This tool keeps the expensive boundary warm:

- one long-lived daemon process
- one long-lived browser instance
- one fresh incognito browser context per render job

That gives you reuse without leaking cookies, storage, timers, or DOM state
between unrelated renders.

## Install

```bash
pnpm install
pnpm exec playwright install chromium
```

For a user-level install that works from any repo:

```bash
pnpm add -g /absolute/path/to/render-loop
pnpm exec playwright install chromium
```

Once this package is published, the install becomes:

```bash
pnpm add -g render-loop
pnpm exec playwright install chromium
```

During local development you can also use:

```bash
npm link
pnpm exec playwright install chromium
```

## Start the daemon

```bash
render-loop render --html-file ./page.html --out ./out/page.png
```

The first render will auto-start a shared user-level daemon if one is not
already running. `render-loop serve` is still available for debugging or when
you want to pin the daemon in a dedicated terminal.

Health and stats:

```bash
render-loop health
```

## Render examples

Render a URL:

```bash
render-loop render \
  --url https://example.com \
  --out ./out/example.png
```

Render a local HTML file with relative assets preserved:

```bash
render-loop render \
  --html-file ./fixtures/card.html \
  --out ./out/card.png \
  --wait-for-selector .ready
```

Render an inline HTML fragment:

```bash
render-loop render \
  --html '<!doctype html><html><body><h1>Hello</h1></body></html>' \
  --out ./out/inline.png
```

## API

`POST /render`

Request body:

```json
{
  "url": "https://example.com",
  "output": "screenshot",
  "viewport": {
    "width": 1280,
    "height": 720,
    "deviceScaleFactor": 1
  },
  "waitFor": "load",
  "selector": "main",
  "timeoutMs": 30000,
  "outputPath": "/absolute/path/to/out.png"
}
```

Supported source fields:

- `url`
- `html`
- `htmlFile`
- `entryFile`

Supported outputs:

- `screenshot`
- `pdf`
- `html`

Server behavior:

- reuses one browser across many jobs
- creates a fresh browser context for each job
- captures console messages, page errors, and failed network requests
- exposes `GET /health` and `GET /stats`
- recycles the browser after `--recycle-every` jobs

## Notes

- The client is intentionally thin. It just posts JSON to the daemon.
- Local HTML files are served through the daemon's temporary asset server so
  relative CSS, JS, and images resolve without relying on `file://`.
- Default concurrency is `2`. Increase it only if your render workload and
  pages are known to behave well under parallel browser contexts.
- `render-loop stop` stops the shared daemon and clears its user-scoped state
  file.

## Codex Skill

A local Codex skill for screenshot iteration lives at
[`skills/render-loop-screenshot-iteration`](./skills/render-loop-screenshot-iteration).
It tells agents to prefer `render-loop` over ad hoc Playwright harnesses for
edit -> render -> inspect loops, reuse a shared daemon when available, and keep
artifact paths stable between iterations.
