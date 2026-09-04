import "server-only";
import fs from "node:fs";
import path from "node:path";
import type { InferenceSession as OrtSession } from "onnxruntime-node";

/**
 * Self-hosted person segmentation.
 *
 * The mask is produced by a U²-Net (Silueta) ONNX graph running on this
 * server's own CPU through ONNX Runtime. No image ever leaves the process:
 * Post Studio calls no remove.bg, PhotoRoom or other third-party image API.
 *
 * The model is *discriminative* — it emits one probability per pixel and
 * nothing else. It cannot repaint a face, a hairline, clothing or a skin tone,
 * which is exactly why it was chosen over any generative "background removal":
 * the poster must show the candidate's own pixels with an alpha channel
 * attached, never a redrawn person.
 *
 * See models/README.md for provenance, licence and the sizing decision.
 */

/** Square input the graph declares; not resizable — the shape is fixed. */
export const SEGMENTATION_INPUT_SIZE = 320;

/** ImageNet statistics the U²-Net family was trained with. */
const CHANNEL_MEAN = [0.485, 0.456, 0.406] as const;
const CHANNEL_STD = [0.229, 0.224, 0.225] as const;

const MODEL_FILE = "silueta.onnx";

/** Recorded on every post so a bad batch can be traced back to a model change. */
export const SEGMENTATION_MODEL_LABEL = "silueta-u2net-onnx";

/**
 * Resolved with a statically-written directory prefix and a constant file name,
 * for the same reason fonts.ts does: Turbopack's file tracer gives up and
 * bundles the whole project when it sees a fully computed path.join.
 */
function modelPath(): string {
  return path.join(process.cwd(), "models", MODEL_FILE);
}

export interface SegmentationMask {
  /** Raw sigmoid probabilities, row-major, SEGMENTATION_INPUT_SIZE². */
  data: Float32Array;
  size: number;
  /** Highest foreground probability anywhere in the frame. */
  peak: number;
}

let sessionPromise: Promise<OrtSession> | null = null;

/**
 * The session is created once per warm lambda and reused. Building it parses
 * 44 MB of weights, so doing it per request would dominate the request time.
 */
/**
 * What the deployment actually contains, next to what it needs.
 *
 * The native runtime fails with a bare `libonnxruntime.so.1: cannot open
 * shared object file`, which says nothing about WHERE it looked. Reporting the
 * three facts that decide the outcome — is the model there, is the shared
 * library there, is it beside its binding — turns the next failure into a
 * finding instead of another round of guessing.
 */
function nativeRuntimeReport(): Record<string, unknown> {
  const binDir = path.join(
    process.cwd(),
    "node_modules",
    "onnxruntime-node",
    "bin",
    "napi-v6",
    process.platform,
    process.arch,
  );
  const exists = (file: string) => {
    try {
      return fs.existsSync(file);
    } catch {
      return false;
    }
  };
  return {
    cwd: process.cwd(),
    platform: `${process.platform}/${process.arch}`,
    model: modelPath(),
    modelExists: exists(modelPath()),
    binDir,
    binDirExists: exists(binDir),
    // The binding's RPATH is $ORIGIN, so the library must sit beside it.
    bindingExists: exists(path.join(binDir, "onnxruntime_binding.node")),
    sharedLibExists: exists(path.join(binDir, "libonnxruntime.so.1")),
    ldLibraryPath: process.env.LD_LIBRARY_PATH ?? null,
  };
}

export function loadSegmentationSession(): Promise<OrtSession> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      // Imported lazily so the 44 MB native runtime is not initialised in
      // request paths that never touch a portrait.
      const ort = await import("onnxruntime-node");
      return ort.InferenceSession.create(modelPath(), {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        // One thread per lambda vCPU; oversubscribing makes inference slower.
        interOpNumThreads: 1,
        intraOpNumThreads: 0,
      });
    })().catch((err) => {
      console.error(
        "[segmentation] session load failed",
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
          ...nativeRuntimeReport(),
        }),
      );
      // A failed load must not poison every later request with the same
      // rejected promise — the next call gets a fresh attempt.
      sessionPromise = null;
      throw err;
    });
  }
  return sessionPromise;
}

/** True when the committed model is actually on disk in this deployment. */
export function segmentationModelAvailable(): boolean {
  return fs.existsSync(modelPath());
}

export function segmentationModelSize(): number {
  return fs.statSync(modelPath()).size;
}

/**
 * Turns a 320x320 RGB byte buffer into the network's NCHW input.
 *
 * The reference implementation scales by the image's own maximum channel value
 * rather than by 255, which acts as a mild auto-exposure on dark photos. It is
 * reproduced here so the masks match the weights' training-time distribution.
 */
export function buildSegmentationInput(rgb: Buffer | Uint8Array, size: number): Float32Array {
  const plane = size * size;
  if (rgb.length !== plane * 3) {
    throw new Error(`segmentation input must be ${plane * 3} RGB bytes, got ${rgb.length}`);
  }

  let max = 0;
  for (let i = 0; i < rgb.length; i += 1) if (rgb[i] > max) max = rgb[i];
  if (max === 0) max = 255;

  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p += 1) {
    for (let c = 0; c < 3; c += 1) {
      chw[c * plane + p] = (rgb[p * 3 + c] / max - CHANNEL_MEAN[c]) / CHANNEL_STD[c];
    }
  }
  return chw;
}

/**
 * Runs the graph on one preprocessed frame.
 *
 * U²-Net emits seven side outputs; only the first (the fused map `d0`) is the
 * final prediction, and it is already a sigmoid. The probabilities are returned
 * unstretched on purpose: the usual min-max rescale would turn a hesitant mask
 * — every pixel around 0.4 — into a confident-looking one, and the caller uses
 * `peak` to decide whether the cut-out can be trusted at all.
 */
export async function runSegmentation(rgb: Buffer | Uint8Array): Promise<SegmentationMask> {
  const size = SEGMENTATION_INPUT_SIZE;
  const ort = await import("onnxruntime-node");
  const session = await loadSegmentationSession();

  const input = new ort.Tensor("float32", buildSegmentationInput(rgb, size), [1, 3, size, size]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const fused = outputs[session.outputNames[0]].data as Float32Array;

  let peak = 0;
  for (const v of fused) if (v > peak) peak = v;

  return { data: fused, size, peak };
}
