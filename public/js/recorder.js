// In-browser microphone recording -> 16-bit PCM WAV Blob.
// Carries forward the existing capture approach (ScriptProcessor -> PCM -> WAV
// encode) from the prior UI, wrapped as a small class with real amplitude
// metering for the waveform visualization (no fabricated animation).

function mergeFloat32Arrays(chunks) {
  let totalLength = 0;
  for (const chunk of chunks) totalLength += chunk.length;

  const result = new Float32Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function floatTo16BitPCM(view, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function writeString(view, offset, string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  floatTo16BitPCM(view, 44, samples);
  return new Blob([view], { type: "audio/wav" });
}

export class VoiceRecorder {
  constructor({ onAmplitude, onTick } = {}) {
    this.onAmplitude = onAmplitude || (() => {});
    this.onTick = onTick || (() => {});
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processorNode = null;
    this.analyserNode = null;
    this.pcmChunks = [];
    this.sampleRate = 44100;
    this.isRecording = false;
    this._rafId = null;
    this._tickInterval = null;
    this._startedAt = 0;
  }

  async start() {
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.audioContext = new AudioContextClass();
    this.sampleRate = this.audioContext.sampleRate;

    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 512;

    this.pcmChunks = [];

    this.processorNode.onaudioprocess = (event) => {
      if (!this.isRecording) return;
      const inputData = event.inputBuffer.getChannelData(0);
      this.pcmChunks.push(new Float32Array(inputData));
    };

    this.sourceNode.connect(this.analyserNode);
    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination);

    this.isRecording = true;
    this._startedAt = performance.now();

    this._meter();
    this._tickInterval = setInterval(() => {
      this.onTick(Math.floor((performance.now() - this._startedAt) / 1000));
    }, 250);

    return true;
  }

  _meter() {
    const buffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    const step = () => {
      if (!this.isRecording) return;
      this.analyserNode.getByteTimeDomainData(buffer);
      let sumSquares = 0;
      for (const value of buffer) {
        const normalized = (value - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      this.onAmplitude(Math.min(1, rms * 4));
      this._rafId = requestAnimationFrame(step);
    };
    this._rafId = requestAnimationFrame(step);
  }

  async stop() {
    if (!this.isRecording) return null;
    this.isRecording = false;

    if (this._rafId) cancelAnimationFrame(this._rafId);
    if (this._tickInterval) clearInterval(this._tickInterval);

    if (this.processorNode) this.processorNode.disconnect();
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.analyserNode) this.analyserNode.disconnect();
    if (this.mediaStream) this.mediaStream.getTracks().forEach((t) => t.stop());
    if (this.audioContext && this.audioContext.state !== "closed") {
      await this.audioContext.close();
    }

    const durationSeconds = (performance.now() - this._startedAt) / 1000;
    const merged = mergeFloat32Arrays(this.pcmChunks);
    const blob = encodeWAV(merged, this.sampleRate);

    return { blob, durationSeconds };
  }
}
