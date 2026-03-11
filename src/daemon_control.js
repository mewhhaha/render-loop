import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function resolveStateHome(env) {
  if (env.RENDER_LOOP_STATE_HOME) {
    return env.RENDER_LOOP_STATE_HOME;
  }
  if (env.XDG_STATE_HOME) {
    return env.XDG_STATE_HOME;
  }
  return path.join(os.homedir(), ".local", "state");
}

export function defaultStateFilePath(env = process.env) {
  if (env.RENDER_LOOP_STATE_FILE) {
    return env.RENDER_LOOP_STATE_FILE;
  }
  return path.join(resolveStateHome(env), "render-loop", "daemon.json");
}

export async function readDaemonState(stateFile = defaultStateFilePath()) {
  try {
    const raw = await fs.readFile(stateFile, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed.host !== "string" || typeof parsed.port !== "number") {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeDaemonState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function clearDaemonState(stateFile, expectedPid) {
  const current = await readDaemonState(stateFile);
  if (!current) {
    return;
  }
  if (expectedPid !== undefined && current.pid !== expectedPid) {
    return;
  }
  await fs.rm(stateFile, { force: true });
}

export async function waitForDaemonReady({
  stateFile,
  fetchHealth,
  timeoutMs = 10_000,
  pollMs = 100,
}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    const state = await readDaemonState(stateFile);
    if (state) {
      try {
        await fetchHealth({ host: state.host, port: state.port });
        return state;
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw lastError ?? new Error(`timed out waiting for daemon state at ${stateFile}`);
}

export function spawnDetachedDaemon({ stateFile, host = "127.0.0.1", port = 0 }) {
  const cliPath = fileURLToPath(new URL("./cli.js", import.meta.url));
  const child = spawn(
    process.execPath,
    [cliPath, "serve", "--host", host, "--port", String(port), "--state-file", stateFile, "--quiet"],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  return child.pid;
}

export async function ensureDaemonRunning({
  stateFile = defaultStateFilePath(),
  fetchHealth,
  spawnDaemon = spawnDetachedDaemon,
  host = "127.0.0.1",
  port = 0,
}) {
  const current = await readDaemonState(stateFile);
  if (current) {
    try {
      await fetchHealth({ host: current.host, port: current.port });
      return current;
    } catch {
      await clearDaemonState(stateFile);
    }
  }

  await spawnDaemon({ stateFile, host, port });
  return waitForDaemonReady({ stateFile, fetchHealth });
}

export async function stopDaemon({
  stateFile = defaultStateFilePath(),
  fetchHealth,
  timeoutMs = 5_000,
}) {
  const state = await readDaemonState(stateFile);
  if (!state) {
    return { ok: true, stopped: false };
  }

  if (fetchHealth) {
    try {
      await fetchHealth({ host: state.host, port: state.port });
    } catch {
      await clearDaemonState(stateFile);
      return { ok: true, stopped: false, staleState: true };
    }
  }

  if (typeof state.pid === "number") {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
        throw error;
      }
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (typeof state.pid === "number") {
        process.kill(state.pid, 0);
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
        await clearDaemonState(stateFile);
        return { ok: true, stopped: true };
      }
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`timed out waiting for daemon pid ${state.pid} to stop`);
}
