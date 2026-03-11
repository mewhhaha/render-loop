import test from "node:test";
import assert from "node:assert/strict";
import { JobQueue } from "../src/queue.js";

test("JobQueue respects concurrency", async () => {
  const queue = new JobQueue(1);
  const events = [];

  const first = queue.enqueue(async () => {
    events.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 25));
    events.push("first:end");
    return "first";
  });

  const second = queue.enqueue(async () => {
    events.push("second:start");
    events.push("second:end");
    return "second";
  });

  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
});
