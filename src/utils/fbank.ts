/**
 * fbank — Kaldi-compatible 80-dim log-mel filterbank feature extraction.
 *
 * Matches the WeSpeaker preprocessing configuration
 * (onnx-community/wespeaker-voxceleb-resnet34-LM preprocessor_config.json):
 *   - sampling rate 16 kHz, frame 25 ms / shift 10 ms, snip_edges = true
 *   - dither 0, remove DC offset, pre-emphasis 0.97
 *   - Hamming window, 512-point FFT (round to power of two)
 *   - 80 mel bins (Kaldi mel scale, 20 Hz .. Nyquist), log of power spectrum
 *   - global cepstral mean normalization (CMN) across frames
 *
 * Pure module with no dependencies — unit-testable.
 */

const SAMPLE_RATE = 16000;
const FRAME_LENGTH = 400; // 25 ms at 16 kHz
const FRAME_SHIFT = 160; // 10 ms at 16 kHz
const FFT_SIZE = 512; // next power of two >= FRAME_LENGTH
const NUM_MEL_BINS = 80;
const MEL_LOW_FREQ_HZ = 20;
const PREEMPHASIS = 0.97;
const LOG_FLOOR = 1.1920929e-7; // FLT_EPSILON, matches Kaldi's energy floor

/** Result of feature extraction: row-major [numFrames x NUM_MEL_BINS]. */
export interface FbankResult {
  features: Float32Array;
  numFrames: number;
  numBins: number;
}

/** Converts frequency in Hz to the Kaldi mel scale. */
function hzToMel(hz: number): number {
  return 1127 * Math.log(1 + hz / 700);
}

/** Precomputed Hamming window of FRAME_LENGTH samples. */
const HAMMING_WINDOW: Float32Array = (() => {
  const win = new Float32Array(FRAME_LENGTH);
  for (let i = 0; i < FRAME_LENGTH; i++) {
    win[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME_LENGTH - 1));
  }
  return win;
})();

/**
 * Precomputed triangular mel filterbank.
 * Each filter is stored as { start, weights } over FFT power-spectrum bins.
 */
interface MelFilter {
  start: number;
  weights: Float32Array;
}

const MEL_FILTERS: MelFilter[] = (() => {
  const numFftBins = FFT_SIZE / 2 + 1;
  const nyquist = SAMPLE_RATE / 2;
  const melLow = hzToMel(MEL_LOW_FREQ_HZ);
  const melHigh = hzToMel(nyquist);
  const melDelta = (melHigh - melLow) / (NUM_MEL_BINS + 1);
  const fftBinWidth = SAMPLE_RATE / FFT_SIZE;

  const filters: MelFilter[] = [];
  for (let bin = 0; bin < NUM_MEL_BINS; bin++) {
    const leftMel = melLow + bin * melDelta;
    const centerMel = melLow + (bin + 1) * melDelta;
    const rightMel = melLow + (bin + 2) * melDelta;

    let start = -1;
    const weights: number[] = [];
    for (let i = 0; i < numFftBins; i++) {
      const mel = hzToMel(i * fftBinWidth);
      if (mel > leftMel && mel < rightMel) {
        const weight =
          mel <= centerMel
            ? (mel - leftMel) / (centerMel - leftMel)
            : (rightMel - mel) / (rightMel - centerMel);
        if (start === -1) start = i;
        weights.push(weight);
      } else if (start !== -1) {
        break;
      }
    }
    filters.push({
      start: Math.max(start, 0),
      weights: Float32Array.from(weights)
    });
  }
  return filters;
})();

/** Bit-reversal permutation table for the radix-2 FFT. */
const BIT_REVERSAL: Uint16Array = (() => {
  const table = new Uint16Array(FFT_SIZE);
  const bits = Math.log2(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    let reversed = 0;
    for (let b = 0; b < bits; b++) {
      reversed = (reversed << 1) | ((i >> b) & 1);
    }
    table[i] = reversed;
  }
  return table;
})();

/** Precomputed twiddle factors (cos/sin) for the FFT stages. */
const TWIDDLE_COS = new Float32Array(FFT_SIZE / 2);
const TWIDDLE_SIN = new Float32Array(FFT_SIZE / 2);
for (let i = 0; i < FFT_SIZE / 2; i++) {
  const angle = (-2 * Math.PI * i) / FFT_SIZE;
  TWIDDLE_COS[i] = Math.cos(angle);
  TWIDDLE_SIN[i] = Math.sin(angle);
}

/**
 * In-place iterative radix-2 FFT over complex arrays of length FFT_SIZE.
 */
function fft(re: Float32Array, im: Float32Array): void {
  for (let i = 0; i < FFT_SIZE; i++) {
    const j = BIT_REVERSAL[i];
    if (j > i) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }

  for (let size = 2; size <= FFT_SIZE; size <<= 1) {
    const half = size >> 1;
    const step = FFT_SIZE / size;
    for (let start = 0; start < FFT_SIZE; start += size) {
      for (let k = 0; k < half; k++) {
        const tIdx = k * step;
        const evenIdx = start + k;
        const oddIdx = evenIdx + half;
        const tRe =
          re[oddIdx] * TWIDDLE_COS[tIdx] - im[oddIdx] * TWIDDLE_SIN[tIdx];
        const tIm =
          re[oddIdx] * TWIDDLE_SIN[tIdx] + im[oddIdx] * TWIDDLE_COS[tIdx];
        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;
      }
    }
  }
}

/** Number of frames produced for a given sample count (snip_edges = true). */
export function fbankNumFrames(numSamples: number): number {
  if (numSamples < FRAME_LENGTH) return 0;
  return 1 + Math.floor((numSamples - FRAME_LENGTH) / FRAME_SHIFT);
}

/**
 * Computes 80-dim log-mel filterbank features with global CMN.
 *
 * @param audio - Mono PCM samples in [-1, 1] at 16 kHz.
 * @returns Feature matrix and dimensions, or `null` if the audio is too short.
 */
export function computeFbank(audio: Float32Array): FbankResult | null {
  const numFrames = fbankNumFrames(audio.length);
  if (numFrames <= 0) return null;

  const features = new Float32Array(numFrames * NUM_MEL_BINS);
  const frame = new Float32Array(FRAME_LENGTH);
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const power = new Float32Array(FFT_SIZE / 2 + 1);

  for (let f = 0; f < numFrames; f++) {
    const offset = f * FRAME_SHIFT;

    // Kaldi expects samples in int16 range; scale from [-1, 1].
    let mean = 0;
    for (let i = 0; i < FRAME_LENGTH; i++) {
      frame[i] = audio[offset + i] * 32768;
      mean += frame[i];
    }
    mean /= FRAME_LENGTH;

    // Remove DC offset.
    for (let i = 0; i < FRAME_LENGTH; i++) {
      frame[i] -= mean;
    }

    // Pre-emphasis (Kaldi convention: first sample has no previous sample).
    for (let i = FRAME_LENGTH - 1; i > 0; i--) {
      frame[i] -= PREEMPHASIS * frame[i - 1];
    }

    // Apply Hamming window and zero-pad to FFT size.
    for (let i = 0; i < FRAME_LENGTH; i++) {
      re[i] = frame[i] * HAMMING_WINDOW[i];
      im[i] = 0;
    }
    re.fill(0, FRAME_LENGTH);
    im.fill(0, FRAME_LENGTH);

    fft(re, im);

    // Power spectrum (first half + Nyquist).
    for (let i = 0; i <= FFT_SIZE / 2; i++) {
      power[i] = re[i] * re[i] + im[i] * im[i];
    }

    // Mel filterbank + log.
    const rowOffset = f * NUM_MEL_BINS;
    for (let bin = 0; bin < NUM_MEL_BINS; bin++) {
      const filter = MEL_FILTERS[bin];
      let energy = 0;
      for (let i = 0; i < filter.weights.length; i++) {
        energy += power[filter.start + i] * filter.weights[i];
      }
      features[rowOffset + bin] = Math.log(Math.max(energy, LOG_FLOOR));
    }
  }

  // Global cepstral mean normalization across frames.
  for (let bin = 0; bin < NUM_MEL_BINS; bin++) {
    let sum = 0;
    for (let f = 0; f < numFrames; f++) {
      sum += features[f * NUM_MEL_BINS + bin];
    }
    const binMean = sum / numFrames;
    for (let f = 0; f < numFrames; f++) {
      features[f * NUM_MEL_BINS + bin] -= binMean;
    }
  }

  return { features, numFrames, numBins: NUM_MEL_BINS };
}
