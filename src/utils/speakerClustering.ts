/**
 * SpeakerClustering — Online centroid-based clustering of speaker embeddings.
 *
 * Each VAD chunk produces one L2-normalized embedding. The first chunk
 * becomes Speaker 1; subsequent chunks are matched against existing speaker
 * centroids via cosine similarity:
 *   - similarity >= threshold → assigned to the best-matching speaker and
 *     its centroid is updated (running mean, re-normalized);
 *   - otherwise → a new speaker is created, capped at `maxSpeakers`
 *     (beyond the cap, the closest centroid wins regardless of threshold).
 *
 * Chunks too short for a reliable embedding (`null`) inherit the previously
 * assigned speaker — back-channels ("Yes", "Okay") rarely change the turn.
 *
 * Pure module with no dependencies — unit-testable.
 */

import {
  MAX_SPEAKERS,
  SPEAKER_SIMILARITY_THRESHOLD
} from '../constants';
import { debugLog } from './debug';

interface SpeakerCentroid {
  /** Running mean of member embeddings, kept L2-normalized. */
  vector: Float32Array;
  /** Number of embeddings merged into this centroid. */
  count: number;
}

/** Dot product of two L2-normalized vectors equals cosine similarity. */
function cosineSimilarity(vectorA: Float32Array, vectorB: Float32Array): number {
  let dotProduct = 0;
  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
  }
  return dotProduct;
}

export class SpeakerClustering {
  private centroids: SpeakerCentroid[] = [];
  private lastSpeakerId = 1;

  private readonly threshold: number;
  private readonly maxSpeakers: number;

  constructor(
    threshold: number = SPEAKER_SIMILARITY_THRESHOLD,
    maxSpeakers: number = MAX_SPEAKERS
  ) {
    this.threshold = threshold;
    this.maxSpeakers = maxSpeakers;
  }

  /** Number of distinct speakers detected so far. */
  public get speakerCount(): number {
    return this.centroids.length;
  }

  /**
   * Assigns a speaker ID (1-based) to an embedding.
   * Pass `null` for chunks too short to embed — the previous speaker is reused.
   */
  assign(embedding: Float32Array | null): number {
    if (!embedding) {
      return this.lastSpeakerId;
    }

    // First speaker bootstraps the cluster set.
    if (this.centroids.length === 0) {
      this.centroids.push({ vector: Float32Array.from(embedding), count: 1 });
      this.lastSpeakerId = 1;
      debugLog('SpeakerClustering', 'Created Speaker 1');
      return 1;
    }

    let bestIndex = 0;
    let bestSimilarity = -1;
    for (let i = 0; i < this.centroids.length; i++) {
      const similarity = cosineSimilarity(embedding, this.centroids[i].vector);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = i;
      }
    }

    const canCreate = this.centroids.length < this.maxSpeakers;
    if (bestSimilarity < this.threshold && canCreate) {
      this.centroids.push({ vector: Float32Array.from(embedding), count: 1 });
      this.lastSpeakerId = this.centroids.length;
      debugLog(
        'SpeakerClustering',
        `Created Speaker ${this.lastSpeakerId} (best sim=${bestSimilarity.toFixed(3)})`
      );
      return this.lastSpeakerId;
    }

    // Centroid protection: only update the centroid if it's a strong match
    // This prevents short/noisy fragments from "poisoning" the speaker profile.
    if (bestSimilarity > this.threshold + 0.1) {
      this.updateCentroid(bestIndex, embedding);
    }
    
    this.lastSpeakerId = bestIndex + 1;
    debugLog(
      'SpeakerClustering',
      `Assigned Speaker ${this.lastSpeakerId} (sim=${bestSimilarity.toFixed(3)})`
    );
    return this.lastSpeakerId;
  }

  /** Resets all clusters. Call when the recording session stops. */
  reset(): void {
    this.centroids = [];
    this.lastSpeakerId = 1;
  }

  /** Running-mean centroid update followed by re-normalization. */
  private updateCentroid(index: number, embedding: Float32Array): void {
    const centroid = this.centroids[index];
    const newCount = centroid.count + 1;
    let norm = 0;
    for (let i = 0; i < centroid.vector.length; i++) {
      centroid.vector[i] =
        (centroid.vector[i] * centroid.count + embedding[i]) / newCount;
      norm += centroid.vector[i] * centroid.vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < centroid.vector.length; i++) {
        centroid.vector[i] /= norm;
      }
    }
    centroid.count = newCount;
  }
}
