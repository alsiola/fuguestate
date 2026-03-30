/**
 * Embedding module — lazy-loads a local transformer model for semantic search.
 * Uses all-MiniLM-L6-v2 (384 dimensions, ~23MB quantized).
 */

import { logger } from "./logger.js";

let pipeline: any = null;
let loading: Promise<any> | null = null;

async function getPipeline() {
  if (pipeline) return pipeline;
  if (loading) return loading;

  loading = (async () => {
    logger.info("Loading embedding model (first use)...");
    const { pipeline: createPipeline } = await import("@huggingface/transformers");
    pipeline = await createPipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
      dtype: "q8",
    });
    logger.info("Embedding model loaded");
    return pipeline;
  })();

  return loading;
}

/**
 * Embed a single text string into a 384-dimensional vector.
 */
export async function embed(text: string): Promise<Float32Array> {
  const pipe = await getPipeline();
  const output = await pipe(text, { pooling: "mean", normalize: true });
  return new Float32Array(output.data);
}

/**
 * Embed multiple texts in sequence. For small batches this is fine;
 * transformers.js handles one at a time under the hood anyway.
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const pipe = await getPipeline();
  const results: Float32Array[] = [];
  for (const text of texts) {
    const output = await pipe(text, { pooling: "mean", normalize: true });
    results.push(new Float32Array(output.data));
  }
  return results;
}

/**
 * Pre-warm the model so the first real embed() call isn't slow.
 */
export async function warmup(): Promise<void> {
  await getPipeline();
}
