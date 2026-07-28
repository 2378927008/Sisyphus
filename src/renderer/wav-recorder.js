export const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000;
export const MAX_RECORDING_SAMPLE_BYTES = 64 * 1024 * 1024;

export class WavRecorder {
  constructor({
    mediaDevices = globalThis.navigator?.mediaDevices,
    AudioContextClass = globalThis.AudioContext,
    AudioWorkletNodeClass = globalThis.AudioWorkletNode,
    workletUrl = new URL("./audio-recorder-worklet.js", import.meta.url).href,
    maxDurationMs = MAX_RECORDING_DURATION_MS,
    maxSampleBytes = MAX_RECORDING_SAMPLE_BYTES,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout,
    onLimit = () => {}
  } = {}) {
    this.mediaDevices = mediaDevices;
    this.AudioContextClass = AudioContextClass;
    this.AudioWorkletNodeClass = AudioWorkletNodeClass;
    this.workletUrl = workletUrl;
    this.maxDurationMs = maxDurationMs;
    this.maxSampleBytes = maxSampleBytes;
    this.setTimeoutImpl = setTimeoutImpl;
    this.clearTimeoutImpl = clearTimeoutImpl;
    this.onLimit = onLimit;
    this.chunks = [];
    this.bufferedSampleBytes = 0;
    this.durationTimer = null;
    this.releasePromise = null;
    this.startPromise = null;
    this.releaseRequested = false;
    this.limitReason = "";
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.performStart();
    return this.startPromise;
  }

  async performStart() {
    if (!this.mediaDevices?.getUserMedia) {
      throw new Error("microphone_unavailable");
    }
    if (typeof this.AudioContextClass !== "function" || typeof this.AudioWorkletNodeClass !== "function") {
      throw new Error("audio_runtime_unavailable");
    }

    try {
      this.stream = await this.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });
      this.throwIfReleaseRequested();
      this.audioContext = new this.AudioContextClass();
      this.sampleRate = this.audioContext.sampleRate;
      this.source = this.audioContext.createMediaStreamSource(this.stream);
      await this.audioContext.audioWorklet.addModule(this.workletUrl);
      this.throwIfReleaseRequested();
      this.processor = new this.AudioWorkletNodeClass(
        this.audioContext,
        "wav-recorder-processor",
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1]
        }
      );
      this.processor.port.onmessage = (event) => {
        this.acceptChunk(event?.data);
      };
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      this.durationTimer = this.setTimeoutImpl.call(
        globalThis,
        () => {
          void this.reachLimit("recording_too_long");
        },
        this.maxDurationMs
      );
      this.durationTimer?.unref?.();
    } catch (error) {
      await this.releaseResources();
      throw error;
    }
  }

  throwIfReleaseRequested() {
    if (this.releaseRequested) {
      throw new Error("recording_cancelled");
    }
  }

  getBufferedSampleBytes() {
    return this.bufferedSampleBytes;
  }

  acceptChunk(data) {
    if (this.releaseRequested || this.releasePromise || this.limitReason) {
      return false;
    }

    const chunk = data instanceof Float32Array
      ? new Float32Array(data)
      : new Float32Array(data || []);
    const nextBytes = this.bufferedSampleBytes + chunk.byteLength;
    if (nextBytes > this.maxSampleBytes) {
      void this.reachLimit("recording_too_large");
      return false;
    }

    this.chunks.push(chunk);
    this.bufferedSampleBytes = nextBytes;
    return true;
  }

  async reachLimit(reason) {
    if (this.limitReason || this.releasePromise) {
      return;
    }

    this.limitReason = reason;
    this.chunks = [];
    this.bufferedSampleBytes = 0;
    await this.releaseResources();
    await this.onLimit(reason);
  }

  async stop() {
    if (this.limitReason) {
      throw new Error(this.limitReason);
    }

    const chunks = this.chunks;
    this.chunks = [];
    this.bufferedSampleBytes = 0;
    const sampleRate = this.sampleRate;
    await this.releaseResources();

    const merged = mergeFloat32(chunks);
    const downsampled = downsample(merged, sampleRate, 16000);
    return encodeWav(downsampled, 16000);
  }

  async dispose() {
    this.releaseRequested = true;
    this.chunks = [];
    this.bufferedSampleBytes = 0;
    await this.startPromise?.catch(() => {});
    await this.releaseResources();
  }

  async releaseResources() {
    if (this.releasePromise) {
      return this.releasePromise;
    }

    this.releasePromise = this.performRelease();
    return this.releasePromise;
  }

  async performRelease() {
    if (this.durationTimer !== null) {
      this.clearTimeoutImpl.call(globalThis, this.durationTimer);
      this.durationTimer = null;
    }

    const processor = this.processor;
    const source = this.source;
    const stream = this.stream;
    const audioContext = this.audioContext;
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.audioContext = null;

    try {
      if (processor?.port) {
        processor.port.onmessage = null;
        processor.port.close();
      }
    } catch {}

    try {
      processor?.disconnect();
    } catch {}

    try {
      source?.disconnect();
    } catch {}

    try {
      stream?.getTracks().forEach((track) => track.stop());
    } catch {}

    try {
      await audioContext?.close?.();
    } catch {}
  }
}

function mergeFloat32(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Float32Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

function downsample(buffer, sourceRate, targetRate) {
  if (sourceRate === targetRate) {
    return buffer;
  }

  const ratio = sourceRate / targetRate;
  const length = Math.round(buffer.length / ratio);
  const result = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;

    for (let j = start; j < end && j < buffer.length; j += 1) {
      sum += buffer[j];
      count += 1;
    }

    result[i] = count ? sum / count : 0;
  }

  return result;
}

function encodeWav(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeString(view, offset, value) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
