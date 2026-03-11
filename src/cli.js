#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";
import { buildRenderRequestFromCli, fetchHealth, renderViaDaemon, toJson } from "./client.js";
import {
  defaultStateFilePath,
  ensureDaemonRunning,
  readDaemonState,
  stopDaemon,
  writeDaemonState,
} from "./daemon_control.js";
import { startHttpServer } from "./http_server.js";
import { coerceInt, parseArgs } from "./utils.js";

function printUsage() {
  process.stdout.write(`render-loop

Commands:
  render-loop serve [--host 127.0.0.1] [--port 4217|0] [--concurrency 2] [--recycle-every 100]
  render-loop render [--host HOST] [--port PORT] (--url URL | --html-file FILE | --entry-file FILE | --html HTML)
                     [--out FILE] [--output screenshot|pdf|html] [--selector CSS]
                     [--width 1280] [--height 720] [--scale 1]
                     [--wait-for load|domcontentloaded|networkidle|commit]
                     [--wait-for-selector CSS] [--wait-for-timeout MS]
  render-loop health [--host HOST] [--port PORT]
  render-loop stop
`);
}

async function resolveDaemonTarget(options) {
  if (options.host || options.port) {
    return {
      host: options.host ?? "127.0.0.1",
      port: coerceInt(options.port, 4217),
    };
  }

  const state = await readDaemonState(defaultStateFilePath());
  if (state) {
    return {
      host: state.host,
      port: state.port,
    };
  }

  return {
    host: "127.0.0.1",
    port: 4217,
  };
}

async function main() {
  const { positionals, options } = parseArgs(process.argv.slice(2));
  const command = positionals[0];

  if (!command || command === "--help" || command === "help") {
    printUsage();
    process.exitCode = 0;
    return;
  }

  if (command === "serve") {
    const host = options.host ?? "127.0.0.1";
    const port = coerceInt(options.port, 4217);
    const concurrency = coerceInt(options.concurrency, 2);
    const recycleEvery = coerceInt(options["recycle-every"], 100);
    const stateFile = options["state-file"] ?? defaultStateFilePath();
    const quiet = options.quiet === true;
    const server = await startHttpServer({ host, port, concurrency, recycleEvery });
    const state = {
      host: server.host,
      port: server.port,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    await writeDaemonState(stateFile, state);

    const cleanupStateFile = () => {
      try {
        const raw = fs.readFileSync(stateFile, "utf8");
        const current = JSON.parse(raw);
        if (current.pid === process.pid) {
          fs.rmSync(stateFile, { force: true });
        }
      } catch {}
    };

    if (!quiet) {
      process.stdout.write(
        toJson({
          ok: true,
          host: server.host,
          port: server.port,
          stateFile,
          stats: server.service.stats(),
        }),
      );
    }

    const shutdown = async () => {
      cleanupStateFile();
      await server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("exit", cleanupStateFile);
    return;
  }

  if (command === "health") {
    const { host, port } = await resolveDaemonTarget(options);
    process.stdout.write(toJson(await fetchHealth({ host, port })));
    return;
  }

  if (command === "render") {
    const daemon = options.host || options.port
      ? await resolveDaemonTarget(options)
      : await ensureDaemonRunning({
          stateFile: defaultStateFilePath(),
          fetchHealth,
        });
    const request = await buildRenderRequestFromCli(options);
    const result = await renderViaDaemon({
      host: daemon.host,
      port: daemon.port,
      request,
      outFile: options.out,
    });
    process.stdout.write(toJson(result));
    return;
  }

  if (command === "stop") {
    process.stdout.write(
      toJson(await stopDaemon({ stateFile: defaultStateFilePath(), fetchHealth })),
    );
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
