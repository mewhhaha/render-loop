import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultStateFilePath,
  ensureDaemonRunning,
  readDaemonState,
  waitForDaemonReady,
} from "../src/daemon_control.js";

test("defaultStateFilePath respects explicit env override", () => {
  assert.equal(
    defaultStateFilePath({ RENDER_LOOP_STATE_FILE: "/tmp/custom-daemon.json" }),
    "/tmp/custom-daemon.json",
  );
});

test("defaultStateFilePath falls back to XDG state home", () => {
  assert.equal(
    defaultStateFilePath({ XDG_STATE_HOME: "/tmp/state-home" }),
    "/tmp/state-home/render-loop/daemon.json",
  );
});

test("waitForDaemonReady resolves once state is readable and healthy", async () => {
  const stateFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "render-loop-state-")), "daemon.json");

  const pending = waitForDaemonReady({
    stateFile,
    fetchHealth: async ({ host, port }) => {
      assert.equal(host, "127.0.0.1");
      assert.equal(port, 4317);
      return { ok: true };
    },
    timeoutMs: 1_000,
    pollMs: 10,
  });

  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(
    stateFile,
    `${JSON.stringify({ host: "127.0.0.1", port: 4317, pid: 99 })}\n`,
    "utf8",
  );

  const state = await pending;
  assert.equal(state.port, 4317);
});

test("ensureDaemonRunning reuses a healthy daemon from state", async () => {
  const stateFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "render-loop-state-")), "daemon.json");
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(
    stateFile,
    `${JSON.stringify({ host: "127.0.0.1", port: 7777, pid: 10 })}\n`,
    "utf8",
  );

  let spawnCount = 0;
  const state = await ensureDaemonRunning({
    stateFile,
    fetchHealth: async ({ host, port }) => {
      assert.equal(host, "127.0.0.1");
      assert.equal(port, 7777);
      return { ok: true };
    },
    spawnDaemon: () => {
      spawnCount += 1;
    },
  });

  assert.equal(state.port, 7777);
  assert.equal(spawnCount, 0);
});

test("ensureDaemonRunning spawns and waits when state is stale", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "render-loop-state-"));
  const stateFile = path.join(dir, "daemon.json");
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(
    stateFile,
    `${JSON.stringify({ host: "127.0.0.1", port: 7000, pid: 11 })}\n`,
    "utf8",
  );

  let healthCalls = 0;
  const state = await ensureDaemonRunning({
    stateFile,
    fetchHealth: async ({ port }) => {
      healthCalls += 1;
      if (port === 7000) {
        throw new Error("stale");
      }
      return { ok: true };
    },
    spawnDaemon: async () => {
      await fs.writeFile(
        stateFile,
        `${JSON.stringify({ host: "127.0.0.1", port: 7001, pid: 12 })}\n`,
        "utf8",
      );
    },
  });

  const stored = await readDaemonState(stateFile);
  assert.equal(state.port, 7001);
  assert.equal(stored.port, 7001);
  assert.equal(healthCalls >= 2, true);
});
