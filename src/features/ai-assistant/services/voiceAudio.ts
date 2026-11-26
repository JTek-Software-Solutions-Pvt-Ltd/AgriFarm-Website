/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export const TARGET_VOICE_SAMPLE_RATE = 16000;

/**
 * Downsamples (or resamples) mono Float32 audio from native hardware sample rate
 * to exact 16,000 Hz mono Float32 using box-filtered averaging when downsampling
 * to prevent speech aliasing.
 */
export function resampleTo16kFloat32(
  input: Float32Array,
  inputSampleRate: number
): Float32Array {
  if (input.length === 0) return new Float32Array(0);
  if (inputSampleRate === TARGET_VOICE_SAMPLE_RATE) {
    return new Float32Array(input);
  }

  const ratio = inputSampleRate / TARGET_VOICE_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  if (ratio > 1) {
    let offsetResult = 0;
    let offsetBuffer = 0;
    while (offsetResult < outputLength) {
      const nextOffsetBuffer = Math.min(
        input.length,
        Math.round((offsetResult + 1) * ratio)
      );
      let accum = 0;
      let count = 0;
      for (let i = offsetBuffer; i < nextOffsetBuffer; i++) {
        accum += input[i];
        count++;
      }
      output[offsetResult] = count > 0 ? accum / count : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }
    return output;
  }

  // Upsample with linear interpolation if hardware runs < 16kHz
  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio;
    const idx0 = Math.floor(srcIdx);
    const idx1 = Math.min(input.length - 1, idx0 + 1);
    const frac = srcIdx - idx0;
    output[i] = input[idx0] * (1 - frac) + input[idx1] * frac;
  }
  return output;
}

/**
 * Encodes Float32 samples into explicit little-endian Float32 PCM bytes
 * matching backend requirement: PCM, 16,000 Hz, 1 (Mono), Float32, Little-endian.
 */
export function encodeFloat32PcmLittleEndian(samples: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(samples.length * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    view.setFloat32(i * 4, samples[i], true);
  }
  return buffer;
}

/**
 * Computes root-mean-square energy of a PCM frame for Voice Activity Detection.
 */
export function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

/**
 * Checks RIFF / WAVE header bytes in a binary response buffer.
 */
export function isWavBuffer(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 12) return false;
  const view = new DataView(buffer);
  // "RIFF" = 0x52494646, "WAVE" = 0x57415645
  return view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645;
}

/**
 * Decodes and plays 24,000 Hz (or any standard) binary WAV audio payloads
 * using an unlocked Web Audio API context with an HTMLAudioElement fallback.
 */
export class WavAudioPlayer {
  private ctx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeAudioEl: HTMLAudioElement | null = null;
  private activeObjectUrl: string | null = null;
  private cancelActiveWait: (() => void) | null = null;

  public async unlock(): Promise<void> {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    if (!this.ctx || this.ctx.state === 'closed') {
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume().catch(() => undefined);
    }
  }

  public stop(): void {
    if (this.activeSource) {
      try {
        this.activeSource.onended = null;
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch {
        // Ignore already-stopped source
      }
      this.activeSource = null;
    }

    if (this.activeAudioEl) {
      try {
        this.activeAudioEl.onended = null;
        this.activeAudioEl.onerror = null;
        this.activeAudioEl.pause();
        this.activeAudioEl.src = '';
      } catch {
        // Ignore element stop error
      }
      this.activeAudioEl = null;
    }

    if (this.activeObjectUrl) {
      URL.revokeObjectURL(this.activeObjectUrl);
      this.activeObjectUrl = null;
    }

    if (this.cancelActiveWait) {
      const resolve = this.cancelActiveWait;
      this.cancelActiveWait = null;
      resolve();
    }
  }

  public async playWav(buffer: ArrayBuffer): Promise<void> {
    this.stop();
    if (buffer.byteLength === 0) return;

    try {
      await this.unlock();
      if (this.ctx && this.ctx.state !== 'closed') {
        const audioBuffer = await this.ctx.decodeAudioData(buffer.slice(0));
        await new Promise<void>((resolve) => {
          if (!this.ctx || this.ctx.state === 'closed') {
            resolve();
            return;
          }
          const source = this.ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(this.ctx.destination);
          this.activeSource = source;
          this.cancelActiveWait = resolve;
          source.onended = () => {
            if (this.activeSource === source) {
              this.activeSource = null;
            }
            if (this.cancelActiveWait === resolve) {
              this.cancelActiveWait = null;
            }
            resolve();
          };
          source.start(0);
        });
        return;
      }
    } catch (decodeErr) {
      console.warn('[VoiceAudio] AudioContext decode failed, using HTMLAudioElement fallback:', decodeErr);
    }

    // Fallback via Blob URL + HTMLAudioElement
    await new Promise<void>((resolve, reject) => {
      const blob = new Blob([buffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      this.activeObjectUrl = url;
      this.activeAudioEl = audio;
      this.cancelActiveWait = resolve;

      const cleanup = () => {
        if (this.activeAudioEl === audio) this.activeAudioEl = null;
        if (this.activeObjectUrl === url) {
          URL.revokeObjectURL(url);
          this.activeObjectUrl = null;
        }
        if (this.cancelActiveWait === resolve) this.cancelActiveWait = null;
      };

      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('Failed to play WAV audio response.'));
      };
      audio.play().catch((playErr) => {
        cleanup();
        reject(playErr);
      });
    });
  }

  public dispose(): void {
    this.stop();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
  }
}
