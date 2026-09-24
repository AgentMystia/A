import assert from "node:assert/strict";
import test from "node:test";

import { AcknowledgedRelayBatchQueue } from "./acknowledgedRelayQueue.js";

test("relay batch queue reports retained slots, live batches, and payload bytes", () => {
  const queue = new AcknowledgedRelayBatchQueue<{
    messageSeq: number;
    outerBytes: number;
    nextFrameIndex: number;
  }>();
  queue.append({ messageSeq: 1, outerBytes: 10, nextFrameIndex: 0 });
  queue.append({ messageSeq: 2, outerBytes: 15, nextFrameIndex: 0 });
  queue.releaseThrough(1);

  assert.equal(queue.activeCount, 1);
  assert.equal(queue.retainedStorageSlots, 2);
  assert.equal(queue.retainedBatchReferenceCount, 1);
  assert.equal(queue.retainedPayloadBytes, 15);
});
