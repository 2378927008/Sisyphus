import assert from "node:assert/strict";
import test from "node:test";

async function loadWavRecorder() {
  try {
    return await import("../src/renderer/wav-recorder.js");
  } catch (error) {
    assert.fail(`WAV recorder module is unavailable: ${error?.code || error?.message}`);
  }
}

test("recording duration limit releases every audio resource before reporting the limit", async () => {
  const { WavRecorder } = await loadWavRecorder();
  const harness = createRecorderHarness(WavRecorder, {
    maxDurationMs: 25,
    maxSampleBytes: 1024
  });

  await harness.recorder.start();
  harness.runDurationTimer();
  const reason = await harness.limitReached;

  assert.equal(reason, "recording_too_long");
  assert.equal(harness.trackStops, 1);
  assert.equal(harness.sourceDisconnects, 1);
  assert.equal(harness.processorDisconnects, 1);
  assert.equal(harness.portCloses, 1);
  assert.equal(harness.contextCloses, 1);
});

test("recording byte limit rejects the overflowing chunk and releases audio resources", async () => {
  const { WavRecorder } = await loadWavRecorder();
  const harness = createRecorderHarness(WavRecorder, {
    maxDurationMs: 1000,
    maxSampleBytes: 16
  });

  await harness.recorder.start();
  harness.sendSamples(new Float32Array(5));
  const reason = await harness.limitReached;

  assert.equal(reason, "recording_too_large");
  assert.equal(harness.recorder.getBufferedSampleBytes(), 0);
  assert.equal(harness.trackStops, 1);
  assert.equal(harness.contextCloses, 1);
});

test("normal stop returns a bounded WAV and closes resources exactly once", async () => {
  const { WavRecorder } = await loadWavRecorder();
  const harness = createRecorderHarness(WavRecorder, {
    maxDurationMs: 1000,
    maxSampleBytes: 1024
  });

  await harness.recorder.start();
  harness.sendSamples(new Float32Array([0, 0.25, -0.25, 0.5]));
  const wav = await harness.recorder.stop();
  await harness.recorder.dispose();

  assert.equal(new TextDecoder().decode(new Uint8Array(wav, 0, 4)), "RIFF");
  assert.equal(new TextDecoder().decode(new Uint8Array(wav, 8, 4)), "WAVE");
  assert.equal(harness.trackStops, 1);
  assert.equal(harness.contextCloses, 1);
  assert.equal(harness.pendingTimerCount, 0);
});

function createRecorderHarness(WavRecorder, {
  maxDurationMs,
  maxSampleBytes
}) {
  let trackStops = 0;
  let sourceDisconnects = 0;
  let processorDisconnects = 0;
  let portCloses = 0;
  let contextCloses = 0;
  let nextTimerId = 1;
  const timers = new Map();
  let resolveLimit;
  const limitReached = new Promise((resolve) => {
    resolveLimit = resolve;
  });
  const stream = {
    getTracks: () => [{
      stop() {
        trackStops += 1;
      }
    }]
  };
  const source = {
    connect() {},
    disconnect() {
      sourceDisconnects += 1;
    }
  };
  const port = {
    onmessage: null,
    close() {
      portCloses += 1;
    }
  };
  const processor = {
    port,
    connect() {},
    disconnect() {
      processorDisconnects += 1;
    }
  };

  class FakeAudioContext {
    constructor() {
      this.sampleRate = 16000;
      this.destination = {};
      this.audioWorklet = {
        addModule: async () => {}
      };
    }

    createMediaStreamSource() {
      return source;
    }

    async close() {
      contextCloses += 1;
    }
  }

  const recorder = new WavRecorder({
    mediaDevices: {
      getUserMedia: async () => stream
    },
    AudioContextClass: FakeAudioContext,
    AudioWorkletNodeClass: class {
      constructor() {
        return processor;
      }
    },
    workletUrl: "file:///audio-recorder-worklet.js",
    maxDurationMs,
    maxSampleBytes,
    setTimeoutImpl(callback, delay) {
      const id = nextTimerId;
      nextTimerId += 1;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeoutImpl(id) {
      timers.delete(id);
    },
    onLimit(reason) {
      assert.equal(trackStops, 1, "track must stop before the limit is reported");
      assert.equal(contextCloses, 1, "AudioContext must close before the limit is reported");
      resolveLimit(reason);
    }
  });

  return {
    recorder,
    limitReached,
    sendSamples(samples) {
      assert.equal(typeof port.onmessage, "function");
      port.onmessage({ data: samples });
    },
    runDurationTimer() {
      const timer = [...timers.values()][0];
      assert.ok(timer);
      timer.callback();
    },
    get trackStops() {
      return trackStops;
    },
    get sourceDisconnects() {
      return sourceDisconnects;
    },
    get processorDisconnects() {
      return processorDisconnects;
    },
    get portCloses() {
      return portCloses;
    },
    get contextCloses() {
      return contextCloses;
    },
    get pendingTimerCount() {
      return timers.size;
    }
  };
}
