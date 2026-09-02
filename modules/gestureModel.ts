import type { LayersModel, Tensor } from '@tensorflow/tfjs';
import {
  GESTURE_FEATURE_SIZE,
  GESTURE_MODEL_LABELS,
  GESTURE_SEQUENCE_LENGTH,
  GestureSequenceBuffer,
  type GestureModelLabel,
  type GestureModelPrediction,
} from './gestureModelFeatures';

export const MIN_GESTURE_SAMPLES_PER_LABEL = 5;
export const GESTURE_MODEL_URL = 'indexeddb://gesture-command-tcn-v1';

export type GestureSampleCounts = Record<GestureModelLabel, number>;

export type GestureTrainingProgress = {
  epoch: number;
  epochs: number;
  accuracy: number;
  loss: number;
};

export type GestureTrainingResult = {
  accuracy: number;
  loss: number;
  sampleCount: number;
};

type StoredGestureSample = {
  id?: number;
  label: GestureModelLabel;
  values: Float32Array;
  createdAt: number;
};

export type TensorFlow = typeof import('@tensorflow/tfjs');

const DATA_DB_NAME = 'gesture-conductor-training-v1';
const DATA_STORE_NAME = 'samples';

export function emptyGestureSampleCounts(): GestureSampleCounts {
  return Object.fromEntries(GESTURE_MODEL_LABELS.map((label) => [label, 0])) as GestureSampleCounts;
}

export function validateGestureSequence(sequence: number[][]) {
  return sequence.length === GESTURE_SEQUENCE_LENGTH
    && sequence.every((frame) => frame.length === GESTURE_FEATURE_SIZE && frame.every(Number.isFinite));
}

export function createGestureCommandTcn(tf: TensorFlow) {
  const model = tf.sequential();
  model.add(tf.layers.conv1d({
    inputShape: [GESTURE_SEQUENCE_LENGTH, GESTURE_FEATURE_SIZE],
    filters: 48,
    kernelSize: 5,
    padding: 'same',
    activation: 'relu',
  }));
  model.add(tf.layers.conv1d({ filters: 64, kernelSize: 3, dilationRate: 2, padding: 'same', activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.globalAveragePooling1d({}));
  model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
  model.add(tf.layers.dropout({ rate: 0.2 }));
  model.add(tf.layers.dense({ units: GESTURE_MODEL_LABELS.length, activation: 'softmax' }));
  model.compile({ optimizer: tf.train.adam(0.001), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });
  return model;
}

class GestureDatasetStore {
  private database: IDBDatabase | null = null;

  async add(label: GestureModelLabel, sequence: number[][]) {
    if (!validateGestureSequence(sequence)) throw new Error('제스처 시퀀스 형식이 올바르지 않습니다');
    const values = new Float32Array(GESTURE_SEQUENCE_LENGTH * GESTURE_FEATURE_SIZE);
    sequence.forEach((frame, index) => values.set(frame, index * GESTURE_FEATURE_SIZE));
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DATA_STORE_NAME, 'readwrite');
      transaction.objectStore(DATA_STORE_NAME).add({ label, values, createdAt: Date.now() } satisfies StoredGestureSample);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async list(): Promise<StoredGestureSample[]> {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(DATA_STORE_NAME).objectStore(DATA_STORE_NAME).getAll();
      request.onsuccess = () => resolve((request.result as StoredGestureSample[]).map((sample) => ({
        ...sample,
        values: Float32Array.from(sample.values),
      })));
      request.onerror = () => reject(request.error);
    });
  }

  async counts() {
    const counts = emptyGestureSampleCounts();
    for (const sample of await this.list()) counts[sample.label] += 1;
    return counts;
  }

  async clear() {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(DATA_STORE_NAME, 'readwrite');
      transaction.objectStore(DATA_STORE_NAME).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  close() {
    this.database?.close();
    this.database = null;
  }

  private async open() {
    if (this.database) return this.database;
    if (!globalThis.indexedDB) throw new Error('이 브라우저는 IndexedDB를 지원하지 않습니다');
    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATA_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DATA_STORE_NAME)) {
          request.result.createObjectStore(DATA_STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.database;
  }
}

export class GestureCommandModel {
  private tf: TensorFlow | null = null;
  private model: LayersModel | null = null;
  private readonly sequenceBuffer = new GestureSequenceBuffer();
  private readonly dataset = new GestureDatasetStore();
  private frameIndex = 0;
  private initializing: Promise<boolean> | null = null;

  get hasModel() {
    return this.model !== null;
  }

  initialize() {
    if (this.initializing) return this.initializing;
    this.initializing = this.loadTensorFlow();
    return this.initializing;
  }

  async addSample(label: GestureModelLabel, sequence: number[][]) {
    await this.dataset.add(label, sequence);
    return this.dataset.counts();
  }

  getSampleCounts() {
    return this.dataset.counts();
  }

  async clearSamples() {
    await this.dataset.clear();
    return emptyGestureSampleCounts();
  }

  async train(onProgress?: (progress: GestureTrainingProgress) => void): Promise<GestureTrainingResult> {
    const tf = await this.requireTensorFlow();
    const samples = await this.dataset.list();
    const counts = emptyGestureSampleCounts();
    samples.forEach((sample) => { counts[sample.label] += 1; });
    const missing = GESTURE_MODEL_LABELS.filter((label) => counts[label] < MIN_GESTURE_SAMPLES_PER_LABEL);
    if (missing.length) throw new Error(`학습 샘플 부족: ${missing.join(', ')}`);

    for (let index = samples.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [samples[index], samples[swapIndex]] = [samples[swapIndex], samples[index]];
    }

    const model = createGestureCommandTcn(tf);
    const xValues = new Float32Array(samples.length * GESTURE_SEQUENCE_LENGTH * GESTURE_FEATURE_SIZE);
    samples.forEach((sample, index) => xValues.set(sample.values, index * sample.values.length));
    const xs = tf.tensor3d(xValues, [samples.length, GESTURE_SEQUENCE_LENGTH, GESTURE_FEATURE_SIZE]);
    const labelIndices = tf.tensor1d(samples.map((sample) => GESTURE_MODEL_LABELS.indexOf(sample.label)), 'int32');
    const ys = tf.oneHot(labelIndices, GESTURE_MODEL_LABELS.length);
    const epochs = 35;
    let lastAccuracy = 0;
    let lastLoss = Number.POSITIVE_INFINITY;

    try {
      await model.fit(xs, ys, {
        epochs,
        batchSize: Math.min(16, samples.length),
        validationSplit: 0.2,
        shuffle: true,
        yieldEvery: 'epoch',
        callbacks: {
          onEpochEnd: async (epoch, logs = {}) => {
            lastAccuracy = Number(logs.val_acc ?? logs.val_accuracy ?? logs.acc ?? logs.accuracy ?? 0);
            lastLoss = Number(logs.val_loss ?? logs.loss ?? 0);
            onProgress?.({ epoch: epoch + 1, epochs, accuracy: lastAccuracy, loss: lastLoss });
            await tf.nextFrame();
          },
        },
      });
      await model.save(GESTURE_MODEL_URL);
      this.model?.dispose();
      this.model = model;
      this.sequenceBuffer.reset();
      return { accuracy: lastAccuracy, loss: lastLoss, sampleCount: samples.length };
    } catch (error) {
      model.dispose();
      throw error;
    } finally {
      xs.dispose();
      labelIndices.dispose();
      ys.dispose();
    }
  }

  predictFrame(features: number[]): GestureModelPrediction | null {
    if (!this.tf || !this.model || !this.sequenceBuffer.push(features)) return null;
    this.frameIndex += 1;
    const sequence = this.sequenceBuffer.snapshot();
    if (!sequence || this.frameIndex % 3 !== 0) return null;

    const tf = this.tf;
    return tf.tidy(() => {
      const input = tf.tensor3d(
        new Float32Array(sequence.flat()),
        [1, GESTURE_SEQUENCE_LENGTH, GESTURE_FEATURE_SIZE],
      );
      const output = this.model!.predict(input);
      const tensor = (Array.isArray(output) ? output[0] : output) as Tensor;
      const probabilities = tensor.dataSync();
      let bestIndex = 0;
      for (let index = 1; index < probabilities.length; index += 1) {
        if (probabilities[index] > probabilities[bestIndex]) bestIndex = index;
      }
      return { label: GESTURE_MODEL_LABELS[bestIndex], confidence: probabilities[bestIndex] };
    });
  }

  resetSequence() {
    this.sequenceBuffer.reset();
    this.frameIndex = 0;
  }

  async clearModel() {
    const tf = await this.requireTensorFlow();
    this.model?.dispose();
    this.model = null;
    this.resetSequence();
    try {
      await tf.io.removeModel(GESTURE_MODEL_URL);
    } catch {
      // No persisted model exists yet.
    }
  }

  dispose() {
    this.model?.dispose();
    this.model = null;
    this.dataset.close();
    this.resetSequence();
  }

  private async loadTensorFlow() {
    this.tf = await import('@tensorflow/tfjs');
    await this.tf.ready();
    try {
      this.model = await this.tf.loadLayersModel(GESTURE_MODEL_URL);
    } catch {
      this.model = null;
    }
    return this.hasModel;
  }

  private async requireTensorFlow() {
    await this.initialize();
    if (!this.tf) throw new Error('TensorFlow.js 초기화에 실패했습니다');
    return this.tf;
  }
}
