class WavRecorderProcessor extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];

    if (output) {
      output.fill(0);
    }

    if (input?.length) {
      const chunk = input.slice();
      this.port.postMessage(chunk, [chunk.buffer]);
    }

    return true;
  }
}

registerProcessor("wav-recorder-processor", WavRecorderProcessor);
