import { BrainCircuit, Database, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  GESTURE_MODEL_LABELS,
  type GestureModelLabel,
  type GestureModelPrediction,
} from '@/modules/gestureModelFeatures';
import {
  MIN_GESTURE_SAMPLES_PER_LABEL,
  type GestureSampleCounts,
  type GestureTrainingProgress,
} from '@/modules/gestureModel';

export type GestureModelStatus = 'loading' | 'missing' | 'ready' | 'training' | 'error';

const LABELS: Record<GestureModelLabel, string> = {
  unknown: '기타 / 대기',
  mute: '음소거',
  unmute: '음소거 해제',
  'tempo-up': '템포 +10',
  'tempo-down': '템포 -10',
  crescendo: '크레센도',
  decrescendo: '디크레센도',
  'balance-left': '밸런스 왼쪽',
  'balance-right': '밸런스 오른쪽',
};

const STATUS_LABELS: Record<GestureModelStatus, string> = {
  loading: '엔진 준비 중',
  missing: '학습 모델 없음',
  ready: '학습 모델 준비됨',
  training: '모델 학습 중',
  error: '모델 오류',
};

type Props = {
  status: GestureModelStatus;
  enabled: boolean;
  counts: GestureSampleCounts;
  captureLabel: GestureModelLabel | null;
  captureProgress: number;
  trainingProgress: GestureTrainingProgress | null;
  prediction: GestureModelPrediction | null;
  message: string;
  cameraReady: boolean;
  handDetected: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onCapture: (label: GestureModelLabel) => void;
  onTrain: () => void;
  onClear: () => void;
};

export function GestureTrainingPanel({
  status,
  enabled,
  counts,
  captureLabel,
  captureProgress,
  trainingProgress,
  prediction,
  message,
  cameraReady,
  handDetected,
  onEnabledChange,
  onCapture,
  onTrain,
  onClear,
}: Props) {
  const totalSamples = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const canTrain = GESTURE_MODEL_LABELS.every((label) => counts[label] >= MIN_GESTURE_SAMPLES_PER_LABEL);
  const busy = status === 'training' || captureLabel !== null;
  const progress = status === 'training'
    ? (trainingProgress?.epoch ?? 0) / (trainingProgress?.epochs ?? 35)
    : captureProgress;

  return (
    <div className="gesture-training-body">
      <div className="section-title">
        <div><span className="eyebrow">LOCAL TCN</span><h2>제스처 학습</h2></div>
        <BrainCircuit size={18} />
      </div>

      <div className="model-enable-row">
        <span><b>학습 모델</b><small>{enabled ? 'TCN 명령 분류' : '규칙 기반 폴백'}</small></span>
        <Switch
          aria-label="학습 모델 사용"
          checked={enabled}
          disabled={status !== 'ready'}
          onCheckedChange={onEnabledChange}
        />
      </div>

      <dl className="status-list model-status-list">
        <div><dt>모델</dt><dd className={status === 'ready' ? 'text-ok' : ''}>{STATUS_LABELS[status]}</dd></div>
        <div><dt>로컬 데이터</dt><dd>{totalSamples}개</dd></div>
        <div><dt>예측</dt><dd>{prediction ? `${LABELS[prediction.label]} ${Math.round(prediction.confidence * 100)}%` : '대기'}</dd></div>
      </dl>

      <div className="training-progress" aria-live="polite">
        <span><b>{message}</b><small>{Math.round(progress * 100)}%</small></span>
        <i><b style={{ width: `${Math.min(1, Math.max(0, progress)) * 100}%` }} /></i>
      </div>

      <div className="gesture-sample-grid">
        {GESTURE_MODEL_LABELS.map((label) => (
          <button
            key={label}
            className={captureLabel === label ? 'active' : ''}
            disabled={!cameraReady || !handDetected || busy}
            onClick={() => onCapture(label)}
          >
            <span>{LABELS[label]}</span>
            <b>{counts[label]}/{MIN_GESTURE_SAMPLES_PER_LABEL}</b>
          </button>
        ))}
      </div>

      <div className="button-row wrap model-actions">
        <Button disabled={!canTrain || busy || status === 'loading'} onClick={onTrain}>
          <BrainCircuit data-icon="inline-start" />모델 학습
        </Button>
        <Button variant="outline" disabled={busy || (!totalSamples && status === 'missing')} onClick={onClear}>
          <Trash2 data-icon="inline-start" />모두 초기화
        </Button>
      </div>
      <div className="local-data-note"><Database size={13} /><span>INDEXEDDB · LANDMARKS ONLY</span></div>
    </div>
  );
}
