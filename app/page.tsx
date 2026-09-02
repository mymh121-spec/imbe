'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, AudioLines, Camera, CameraOff, Crosshair, Eye, EyeOff, FileAudio,
  ChevronLeft, ChevronRight, Minus, MousePointer2, Pause, Play, Plus,
  Radio, Repeat2, Square, TestTube2, Triangle, Upload,
  Volume2, VolumeX, Waves,
} from 'lucide-react';
import { BatonStage } from '@/components/baton-stage';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AudioEngine, type AudioPlaybackState, type SynthWaveform } from '@/modules/audioEngine';
import { BatonController } from '@/modules/batonController';
import { BeatTracker, type BeatEvent } from '@/modules/beatTracker';
import { CameraInput, type CameraState } from '@/modules/cameraInput';
import { DEFAULT_MAPPING, mapGesture, type MappingSettings } from '@/modules/gestureMapping';
import { GestureCommandDetector, type ConductorCommand } from '@/modules/gestureCommands';
import type { StaticHandGesture } from '@/modules/gestureFeatures';
import { HandDetection, type HandDetectorState } from '@/modules/handDetection';
import type { BatonFrame, BatonPose, MappingOutput } from '@/modules/types';

type InputMode = 'simulation' | 'camera';

const INITIAL_FRAME: BatonFrame = {
  position: { x: 0, y: 0, z: 0.5 },
  rotation: { x: 0, y: 0, z: 0 },
  quaternion: { x: 0, y: 0, z: 0, w: 1 },
  timestamp: 0,
  confidence: 0,
  speed: 0,
  suddenStop: false,
  tracking: 'idle',
};

const INITIAL_MAPPING: MappingOutput = {
  masterGain: 0.5, pan: 0, lowEq: 0, midEq: 0, highEq: 0, intensity: 1, suddenStop: false,
};

const CAMERA_LABELS: Record<CameraState, string> = {
  off: '카메라 OFF',
  requesting: '권한 요청 중',
  ready: '카메라 준비됨',
  denied: '카메라 권한 거부됨',
  unavailable: '사용 가능한 카메라 없음',
  error: '카메라 연결 오류',
};

const HAND_STATE_LABELS: Record<HandDetectorState, string> = {
  idle: '손 모델 대기',
  loading: '손 모델 준비 중',
  ready: '손 미검출',
  error: '손 모델 오류',
};

const GESTURE_LABELS: Record<StaticHandGesture, string> = {
  fist: '주먹',
  'open-palm': '손바닥',
  'thumb-up': '엄지 위',
  'thumb-down': '엄지 아래',
  pinch: '핀치',
  unknown: '대기',
};

const COMMAND_LABELS: Record<ConductorCommand, string> = {
  mute: '음소거',
  unmute: '음소거 해제',
  'tempo-up': '템포 +10',
  'tempo-down': '템포 -10',
  crescendo: '크레센도',
  decrescendo: '디크레센도',
  'balance-left': '밸런스 왼쪽',
  'balance-right': '밸런스 오른쪽',
};

const INITIAL_BEAT: BeatEvent = {
  index: 0,
  beatsPerBar: 4,
  bpm: null,
  confidence: 0,
  timestamp: 0,
};

function numberText(value: number, digits = 2) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function IconAction({ label, children, ...props }: { label: string; children: ReactNode } & React.ComponentProps<typeof Button>) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button aria-label={label} size="icon" variant="outline" {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function RangeControl({ label, value, min, max, step, unit, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void;
}) {
  return (
    <label className="range-control">
      <span><b>{label}</b><output>{value.toFixed(step < 0.1 ? 2 : 1)} {unit}</output></span>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(next) => onChange(typeof next === 'number' ? next : next[0])} />
    </label>
  );
}

function Meter({ value, tone = 'cyan' }: { value: number; tone?: 'cyan' | 'coral' | 'gold' }) {
  return <span className={`meter tone-${tone}`} aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></span>;
}

export default function Home() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<CameraInput | null>(null);
  const handDetectorRef = useRef<HandDetection | null>(null);
  const controllerRef = useRef<BatonController | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const beatTrackerRef = useRef<BeatTracker | null>(null);
  const gestureCommandRef = useRef<GestureCommandDetector | null>(null);
  const modeRef = useRef<InputMode>('simulation');
  const cameraStateRef = useRef<CameraState>('off');
  const simulationPoseRef = useRef<BatonPose | null>(null);
  const cameraPoseRef = useRef<BatonPose | null>(null);
  const mappingSettingsRef = useRef<MappingSettings>(DEFAULT_MAPPING);
  const gestureCommandsEnabledRef = useRef(false);
  const beatSyncRef = useRef(false);
  const lastDetectionRef = useRef(0);
  const lastUiUpdateRef = useRef(0);

  const [mode, setMode] = useState<InputMode>('simulation');
  const [cameraState, setCameraState] = useState<CameraState>('off');
  const [handState, setHandState] = useState<HandDetectorState>('idle');
  const [handDetected, setHandDetected] = useState(false);
  const [handedness, setHandedness] = useState<string | null>(null);
  const [handGesture, setHandGesture] = useState<StaticHandGesture>('unknown');
  const [gestureConfidence, setGestureConfidence] = useState(0);
  const [gestureCommandsEnabled, setGestureCommandsEnabled] = useState(false);
  const [lastCommand, setLastCommand] = useState('대기');
  const [beatSync, setBeatSync] = useState(false);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [beatInfo, setBeatInfo] = useState<BeatEvent>(INITIAL_BEAT);
  const [detectionMs, setDetectionMs] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [frame, setFrame] = useState<BatonFrame>(INITIAL_FRAME);
  const [mapped, setMapped] = useState<MappingOutput>(INITIAL_MAPPING);
  const [mappingSettings, setMappingSettings] = useState<MappingSettings>(DEFAULT_MAPPING);
  const [playback, setPlayback] = useState<AudioPlaybackState>('stopped');
  const [waveform, setWaveform] = useState<SynthWaveform>('sine');
  const [dynamicsLevel, setDynamicsLevel] = useState(0.7);
  const [muted, setMuted] = useState(false);
  const [tempoBpm, setTempoBpm] = useState(100);
  const [manualPan, setManualPan] = useState(0);
  const [loop, setLoop] = useState(true);
  const [trackInfo, setTrackInfo] = useState([
    { name: 'A4 Base 440', level: 0.34, hasFile: false },
    { name: '2nd Harmonic 880', level: 0.24, hasFile: false },
    { name: '3rd Harmonic 1320', level: 0.16, hasFile: false },
  ]);
  const [audioMeter, setAudioMeter] = useState(0);

  useEffect(() => {
    const camera = new CameraInput();
    const handDetector = new HandDetection();
    const controller = new BatonController();
    const audio = new AudioEngine();
    const beatTracker = new BeatTracker();
    const gestureCommand = new GestureCommandDetector();
    cameraRef.current = camera;
    handDetectorRef.current = handDetector;
    controllerRef.current = controller;
    audioRef.current = audio;
    beatTrackerRef.current = beatTracker;
    gestureCommandRef.current = gestureCommand;
    const executeGestureCommand = (command: ConductorCommand) => {
      setLastCommand(COMMAND_LABELS[command]);
      switch (command) {
        case 'mute':
          audio.setMuted(true);
          setMuted(true);
          break;
        case 'unmute':
          audio.setMuted(false);
          setMuted(false);
          break;
        case 'tempo-up':
          setTempoBpm((current) => {
            const next = Math.min(180, current + 10);
            audio.setTempoBpm(next);
            return next;
          });
          break;
        case 'tempo-down':
          setTempoBpm((current) => {
            const next = Math.max(60, current - 10);
            audio.setTempoBpm(next);
            return next;
          });
          break;
        case 'crescendo':
          setDynamicsLevel((current) => {
            const next = Math.min(1, Number((current + 0.1).toFixed(1)));
            audio.setDynamicsLevel(next);
            return next;
          });
          break;
        case 'decrescendo':
          setDynamicsLevel((current) => {
            const next = Math.max(0, Number((current - 0.1).toFixed(1)));
            audio.setDynamicsLevel(next);
            return next;
          });
          break;
        case 'balance-left':
          setManualPan((current) => {
            const next = Math.max(-1, Number((current - 0.2).toFixed(1)));
            audio.setManualPan(next);
            return next;
          });
          break;
        case 'balance-right':
          setManualPan((current) => {
            const next = Math.min(1, Number((current + 0.2).toFixed(1)));
            audio.setManualPan(next);
            return next;
          });
          break;
      }
    };
    let animationFrame = 0;
    const tick = (now: number) => {
      const activeMode = modeRef.current;
      if (
        cameraStateRef.current === 'ready' &&
        videoRef.current &&
        now - lastDetectionRef.current > 55
      ) {
        lastDetectionRef.current = now;
        if (handDetectorRef.current) {
          const detection = handDetectorRef.current.detect(videoRef.current, previewRef.current ?? undefined, now);
          if (detection) {
            setHandDetected(detection.handCount > 0);
            setHandedness(detection.handedness);
            setHandGesture(detection.gesture);
            setGestureConfidence(detection.gestureConfidence);
            setDetectionMs(detection.durationMs);
            if (detection.pose) {
              cameraPoseRef.current = detection.pose;
              if (gestureCommandsEnabledRef.current) {
                const command = gestureCommand.update({
                  gesture: detection.gesture,
                  confidence: detection.gestureConfidence,
                  position: detection.pose.position,
                  timestamp: now,
                });
                if (command) executeGestureCommand(command);
              } else {
                gestureCommand.reset();
              }
            } else {
              gestureCommand.update(null);
            }
          }
        }
      }

      const cameraPose = cameraPoseRef.current;
      const measurement = activeMode === 'simulation'
        ? simulationPoseRef.current
        : cameraPose && now - cameraPose.timestamp < 420 ? cameraPose : null;
      const nextFrame = controller.update(measurement, now);
      const nextMapping = mapGesture(nextFrame, mappingSettingsRef.current);
      const beat = beatTracker.update(nextFrame.tracking === 'idle' ? null : nextFrame);
      if (beat) {
        setBeatInfo(beat);
        if (beatSyncRef.current && beat.bpm && beat.confidence >= 0.45) {
          audio.setTempoBpm(beat.bpm);
          setTempoBpm(beat.bpm);
        }
      }
      audio.applyMapping(nextMapping, mappingSettingsRef.current.rampSeconds);
      if (nextFrame.suddenStop) audio.handleSuddenStop(mappingSettingsRef.current.suddenStopAction);

      if (now - lastUiUpdateRef.current > 65) {
        lastUiUpdateRef.current = now;
        setFrame(nextFrame);
        setMapped(nextMapping);
        setAudioMeter(audio.getMeterLevel());
      }
      animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animationFrame);
      camera.stop();
      handDetector.close();
      audio.dispose();
      beatTrackerRef.current = null;
      gestureCommandRef.current = null;
    };
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const handleSimulationPose = useCallback((pose: BatonPose) => {
    simulationPoseRef.current = pose;
  }, []);

  const changeMode = (next: InputMode) => {
    setMode(next);
    modeRef.current = next;
  };

  const changeGestureCommandsEnabled = (enabled: boolean) => {
    gestureCommandsEnabledRef.current = enabled;
    setGestureCommandsEnabled(enabled);
    gestureCommandRef.current?.reset();
    setLastCommand(enabled ? '명령 대기' : '안전 잠금');
  };

  const changeBeatSync = (enabled: boolean) => {
    beatSyncRef.current = enabled;
    setBeatSync(enabled);
  };

  const changeBeatsPerBar = (value: number) => {
    const next = Math.min(4, Math.max(2, Math.round(value)));
    beatTrackerRef.current?.setBeatsPerBar(next);
    setBeatsPerBar(next);
    setBeatInfo({ ...INITIAL_BEAT, beatsPerBar: next });
  };

  const prepareHandDetector = useCallback(async () => {
    const detector = handDetectorRef.current;
    if (!detector) return;
    if (detector.state === 'ready') {
      setHandState('ready');
      return;
    }
    setHandState('loading');
    try {
      await detector.initialize();
      setHandState(detector.state);
    } catch {
      setHandState('error');
    }
  }, []);

  const toggleCamera = async () => {
    const camera = cameraRef.current;
    const video = videoRef.current;
    if (!camera || !video) return;
    if (cameraStateRef.current === 'ready') {
      camera.stop();
      cameraStateRef.current = 'off';
      setCameraState('off');
      setHandDetected(false);
      setHandedness(null);
      setHandGesture('unknown');
      setGestureConfidence(0);
      gestureCommandRef.current?.reset();
      cameraPoseRef.current = null;
      changeMode('simulation');
      return;
    }
    cameraStateRef.current = 'requesting';
    setCameraState('requesting');
    const next = await camera.start(video);
    cameraStateRef.current = next;
    setCameraState(next);
    if (next === 'ready') {
      changeMode('camera');
      void prepareHandDetector();
    }
  };

  const updateMapping = <K extends keyof MappingSettings>(key: K, value: MappingSettings[K]) => {
    const next = { ...mappingSettingsRef.current, [key]: value };
    mappingSettingsRef.current = next;
    controllerRef.current?.setSmoothing(next.smoothingHz);
    setMappingSettings(next);
  };

  const handlePlay = async () => {
    await audioRef.current?.play();
    setPlayback(audioRef.current?.state ?? 'stopped');
    setTrackInfo(audioRef.current?.getTrackInfo() ?? trackInfo);
  };

  const handlePause = () => {
    audioRef.current?.pause();
    setPlayback(audioRef.current?.state ?? 'paused');
  };

  const handleStop = () => {
    audioRef.current?.stop();
    setPlayback('stopped');
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    await audioRef.current?.loadFiles([...files]);
    setTrackInfo(audioRef.current?.getTrackInfo() ?? trackInfo);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const setTrackGain = (index: number, value: number) => {
    setTrackInfo((current) => current.map((track, trackIndex) => trackIndex === index ? { ...track, level: value } : track));
    void audioRef.current?.ensureReady().then(() => audioRef.current?.setTrackGain(index, value));
  };

  const selectWaveform = async (nextWaveform: SynthWaveform) => {
    audioRef.current?.useTestTones(nextWaveform);
    setWaveform(nextWaveform);
    await audioRef.current?.play();
    setPlayback(audioRef.current?.state ?? 'stopped');
    setTrackInfo(audioRef.current?.getTrackInfo() ?? trackInfo);
  };

  const adjustDynamics = (delta: number) => {
    setDynamicsLevel((current) => {
      const next = Math.min(1, Math.max(0, Number((current + delta).toFixed(1))));
      audioRef.current?.setDynamicsLevel(next);
      return next;
    });
  };

  const toggleMute = () => {
    setMuted((current) => {
      const next = !current;
      audioRef.current?.setMuted(next);
      return next;
    });
  };

  const adjustTempo = (delta: number) => {
    setTempoBpm((current) => {
      const next = Math.min(180, Math.max(60, current + delta));
      audioRef.current?.setTempoBpm(next);
      return next;
    });
  };

  const adjustBalance = (delta: number) => {
    setManualPan((current) => {
      const next = Math.min(1, Math.max(-1, Number((current + delta).toFixed(1))));
      audioRef.current?.setManualPan(next);
      return next;
    });
  };

  const balanceLabel = manualPan === 0
    ? 'CENTER'
    : manualPan < 0 ? `L ${Math.round(-manualPan * 100)}%` : `R ${Math.round(manualPan * 100)}%`;
  const effectivePan = Math.min(1, Math.max(-1, mapped.pan + manualPan));

  const handTrackingLabel = handDetected
    ? `${handedness === 'Left' ? '왼손' : handedness === 'Right' ? '오른손' : '손'} 추적 중`
    : HAND_STATE_LABELS[handState];
  const trackingLabel = mode === 'simulation'
    ? '시뮬레이션 입력'
    : cameraState !== 'ready'
      ? CAMERA_LABELS[cameraState]
      : handTrackingLabel;

  const statusTone = mode === 'simulation' || handDetected
    ? 'ok'
    : cameraState === 'denied' || cameraState === 'error' || handState === 'error' ? 'error' : 'warn';

  return (
    <TooltipProvider>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true"><Radio size={18} /></span>
            <div><h1>GESTURE CONDUCTOR</h1><p>맨손 3D 지휘 · 실시간 오디오 믹싱</p></div>
          </div>
          <div className="topbar-actions">
            <div className="mode-switch" aria-label="입력 모드">
              <button className={mode === 'simulation' ? 'active' : ''} onClick={() => changeMode('simulation')}><MousePointer2 /> SIM</button>
              <button className={mode === 'camera' ? 'active' : ''} onClick={() => changeMode('camera')} disabled={cameraState !== 'ready'}><Camera /> CAM</button>
            </div>
            <div className={`status-strip ${statusTone}`} aria-live="polite"><span className="status-dot" />{trackingLabel}</div>
          </div>
        </header>

        <section className="workspace-grid">
          <div className="stage-panel">
            <div className="panel-heading stage-heading">
              <div><span className="eyebrow">3D BATON</span><h2>지휘 공간</h2></div>
              <div className="stage-statuses">
                <span className="signal-badge"><Activity size={13} /> {frame.tracking.toUpperCase()}</span>
                <span className="signal-badge beat-badge" key={beatInfo.timestamp}>
                  BEAT {beatInfo.index || '–'}/{beatInfo.beatsPerBar} · {beatInfo.bpm ?? '---'} BPM
                </span>
                <span className="signal-badge confidence-badge">CONF {Math.round(frame.confidence * 100)}%</span>
              </div>
            </div>
            <BatonStage frame={frame} simulationEnabled={mode === 'simulation'} onSimulationPose={handleSimulationPose} />
            <div className="stage-readout">
              {[
                ['X', numberText(frame.position.x), 'norm'],
                ['Y', numberText(frame.position.y), 'norm'],
                ['Z', frame.position.z.toFixed(2), 'relative'],
                ['SPD', frame.speed.toFixed(2), 'u/s'],
                ['TILT', `${Math.round(frame.rotation.z * 180 / Math.PI)}°`, 'roll'],
              ].map(([label, value, unit]) => (
                <div className="metric-cell" key={label}><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>
              ))}
            </div>
          </div>

          <aside className="control-panel side-console">
            <Tabs defaultValue="input">
              <TabsList className="console-tabs">
                <TabsTrigger value="input">입력</TabsTrigger>
                <TabsTrigger value="mapping">매핑</TabsTrigger>
              </TabsList>

              <TabsContent value="input" className="tab-body">
                <div className="section-title"><div><span className="eyebrow">CAMERA</span><h2>맨손 입력</h2></div><Camera size={17} /></div>
                <div className="conductor-options">
                  <div>
                    <span><b>손 명령</b><small>유지·핀치 동작 실행</small></span>
                    <Switch aria-label="손 명령 사용" checked={gestureCommandsEnabled} onCheckedChange={changeGestureCommandsEnabled} />
                  </div>
                  <div>
                    <span><b>박자 동기화</b><small>검출 BPM을 오디오에 적용</small></span>
                    <Switch aria-label="박자 동기화" checked={beatSync} onCheckedChange={changeBeatSync} />
                  </div>
                </div>
                <div className={`camera-preview ${previewVisible ? '' : 'is-hidden'}`}>
                  {/* oxlint-disable-next-line jsx-a11y/media-has-caption -- Muted camera frames contain no audio. */}
                  <video ref={videoRef} muted playsInline aria-hidden="true" />
                  <canvas ref={previewRef} />
                  {!previewVisible && <div className="preview-off"><EyeOff size={20} /><span>미리보기 숨김</span></div>}
                  {cameraState !== 'ready' && <div className="preview-off"><CameraOff size={22} /><span>{CAMERA_LABELS[cameraState]}</span></div>}
                </div>
                <div className="button-row">
                  <Button onClick={toggleCamera} disabled={cameraState === 'requesting'}>
                    {cameraState === 'ready' ? <CameraOff data-icon="inline-start" /> : <Camera data-icon="inline-start" />}
                    {cameraState === 'ready' ? '카메라 끄기' : '카메라 켜기'}
                  </Button>
                  <IconAction label={previewVisible ? '카메라 미리보기 숨기기' : '카메라 미리보기 보이기'} onClick={() => setPreviewVisible((value) => !value)}>
                    {previewVisible ? <Eye /> : <EyeOff />}
                  </IconAction>
                </div>
                <dl className="status-list">
                  <div><dt>장치</dt><dd className={cameraState === 'ready' ? 'text-ok' : ''}>{CAMERA_LABELS[cameraState]}</dd></div>
                  <div><dt>손 추적</dt><dd>{handTrackingLabel}</dd></div>
                  <div><dt>손 모양</dt><dd>{GESTURE_LABELS[handGesture]} {gestureConfidence ? `${Math.round(gestureConfidence * 100)}%` : ''}</dd></div>
                  <div><dt>최근 명령</dt><dd>{lastCommand}</dd></div>
                  <div><dt>박자</dt><dd>{beatInfo.index || '–'}/{beatInfo.beatsPerBar} · {beatInfo.bpm ?? '---'} BPM</dd></div>
                  <div><dt>검출 시간</dt><dd>{detectionMs ? `${detectionMs.toFixed(1)} ms` : '—'}</dd></div>
                </dl>
                <div className="orientation-grid">
                  <div><span>PITCH</span><b>{numberText(frame.rotation.x * 180 / Math.PI, 0)}°</b></div>
                  <div><span>YAW</span><b>{numberText(frame.rotation.y * 180 / Math.PI, 0)}°</b></div>
                  <div><span>ROLL</span><b>{numberText(frame.rotation.z * 180 / Math.PI, 0)}°</b></div>
                </div>
              </TabsContent>

              <TabsContent value="mapping" className="tab-body range-stack">
                <div className="section-title"><div><span className="eyebrow">GESTURE MAP</span><h2>반응 설정</h2></div><Crosshair size={17} /></div>
                <RangeControl label="좌우 패닝" value={mappingSettings.panSensitivity} min={0} max={1.5} step={0.05} unit="x" onChange={(value) => updateMapping('panSensitivity', value)} />
                <RangeControl label="EQ 범위" value={mappingSettings.eqRangeDb} min={0} max={18} step={1} unit="dB" onChange={(value) => updateMapping('eqRangeDb', value)} />
                <RangeControl label="기울기 반응" value={mappingSettings.tiltResponse} min={0} max={1.5} step={0.05} unit="x" onChange={(value) => updateMapping('tiltResponse', value)} />
                <RangeControl label="속도 반응" value={mappingSettings.velocityResponse} min={0} max={1} step={0.05} unit="x" onChange={(value) => updateMapping('velocityResponse', value)} />
                <RangeControl label="입력 평활화" value={mappingSettings.smoothingHz} min={1} max={12} step={0.5} unit="Hz" onChange={(value) => updateMapping('smoothingHz', value)} />
                <RangeControl label="오디오 램프" value={mappingSettings.rampSeconds} min={0.02} max={0.3} step={0.01} unit="s" onChange={(value) => updateMapping('rampSeconds', value)} />
                <label className="select-control"><span>급정지 동작</span><select value={mappingSettings.suddenStopAction} onChange={(event) => updateMapping('suddenStopAction', event.target.value as MappingSettings['suddenStopAction'])}><option value="off">사용 안 함</option><option value="duck">짧게 감쇠</option><option value="pause">일시정지</option></select></label>
                <label className="select-control"><span>박자 패턴</span><select aria-label="박자 패턴" value={beatsPerBar} onChange={(event) => changeBeatsPerBar(Number(event.target.value))}><option value="2">2박</option><option value="3">3박</option><option value="4">4박</option></select></label>
              </TabsContent>

            </Tabs>
          </aside>

          <section className="control-panel audio-console">
            <div className="audio-master">
              <div className="section-title"><div><span className="eyebrow">WEB AUDIO</span><h2>실시간 믹서</h2></div><AudioLines size={18} /></div>
              <div className="transport">
                <IconAction label="재생" onClick={handlePlay} disabled={playback === 'playing'}><Play /></IconAction>
                <IconAction label="일시정지" onClick={handlePause} disabled={playback !== 'playing'}><Pause /></IconAction>
                <IconAction label="정지" onClick={handleStop} disabled={playback === 'stopped'}><Square /></IconAction>
                <div className="loop-control"><Repeat2 /><span>반복</span><Switch aria-label="반복 재생" checked={loop} onCheckedChange={(checked) => { setLoop(checked); audioRef.current?.setLoop(checked); }} /></div>
              </div>
              <div className="waveform-tutorial-layout">
                <div className="waveform-control">
                  <span className="waveform-label">BASE TONE <b>A4 · 440 Hz</b></span>
                  <div className="waveform-buttons" aria-label="테스트 합성음 파형">
                    <button className={waveform === 'sine' ? 'active' : ''} onClick={() => void selectWaveform('sine')}><Waves />사인파</button>
                    <button className={waveform === 'triangle' ? 'active' : ''} onClick={() => void selectWaveform('triangle')}><Triangle />삼각파</button>
                    <button className={waveform === 'square' ? 'active' : ''} onClick={() => void selectWaveform('square')}><Square />사각파</button>
                  </div>
                </div>
                <aside className="motion-tutorial" aria-label="수동 오디오 동작">
                  <span className="waveform-label">ACTION TUTORIAL <b>{Math.round(dynamicsLevel * 100)}%</b></span>
                  <div className="dynamics-actions">
                    <button aria-label="디크레센도" onClick={() => adjustDynamics(-0.1)} disabled={dynamicsLevel <= 0}>
                      <ChevronLeft /><b>&lt;</b><small>DECRESC.</small>
                    </button>
                    <button className={muted ? 'active mute' : ''} aria-label={muted ? '음소거 해제' : '음소거'} aria-pressed={muted} onClick={toggleMute}>
                      {muted ? <VolumeX /> : <Volume2 />}<b>MUTE</b><small>{muted ? 'ON' : 'OFF'}</small>
                    </button>
                    <button aria-label="크레센도" onClick={() => adjustDynamics(0.1)} disabled={dynamicsLevel >= 1}>
                      <ChevronRight /><b>&gt;</b><small>CRESC.</small>
                    </button>
                  </div>
                  <div className="tutorial-adjust-row">
                    <span>TEMPO</span>
                    <button aria-label="템포 낮추기" onClick={() => adjustTempo(-10)} disabled={tempoBpm <= 60}><Minus /></button>
                    <output>{tempoBpm} BPM</output>
                    <button aria-label="템포 높이기" onClick={() => adjustTempo(10)} disabled={tempoBpm >= 180}><Plus /></button>
                  </div>
                  <div className="tutorial-adjust-row">
                    <span>BALANCE</span>
                    <button aria-label="왼쪽 소리 가중치 높이기" onClick={() => adjustBalance(-0.2)} disabled={manualPan <= -1}><ChevronLeft /></button>
                    <output>{balanceLabel}</output>
                    <button aria-label="오른쪽 소리 가중치 높이기" onClick={() => adjustBalance(0.2)} disabled={manualPan >= 1}><ChevronRight /></button>
                  </div>
                </aside>
              </div>
              <Meter value={audioMeter} tone="coral" />
              <div className="button-row wrap">
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="audio/*" multiple onChange={(event) => void handleFiles(event.target.files)} />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload data-icon="inline-start" />오디오 불러오기</Button>
                <Button variant="outline" onClick={() => void selectWaveform('sine')}><TestTube2 data-icon="inline-start" />테스트톤</Button>
              </div>
              <div className="master-values">
                <span><small>MASTER</small><b>{muted ? 'MUTE' : `${Math.round(mapped.masterGain * dynamicsLevel * 100)}%`}</b></span>
                <span><small>PAN</small><b>{numberText(effectivePan)}</b></span>
              </div>
            </div>

            <div className="track-bank">
              {trackInfo.map((track, index) => (
                <div className="track-strip" key={index}>
                  <div className="track-header"><span>0{index + 1}</span><FileAudio size={15} /><b title={track.name}>{track.name}</b><em>{track.hasFile ? 'FILE' : 'SYNTH'}</em></div>
                  <Slider aria-label={`트랙 ${index + 1} 음량`} value={[track.level]} min={0} max={1} step={0.01} onValueChange={(next) => setTrackGain(index, typeof next === 'number' ? next : next[0])} />
                  <div className="track-value">GAIN {(track.level * 100).toFixed(0)}%</div>
                </div>
              ))}
            </div>

            <div className="eq-bank">
              {[
                { label: 'LOW', value: mapped.lowEq, tone: 'gold' as const },
                { label: 'MID', value: mapped.midEq, tone: 'cyan' as const },
                { label: 'HIGH', value: mapped.highEq, tone: 'coral' as const },
              ].map(({ label, value, tone }) => (
                <div className="eq-readout" key={label}><span>{label}</span><b>{numberText(value, 1)} dB</b><Meter value={(value + 18) / 36} tone={tone} /></div>
              ))}
            </div>
          </section>
        </section>
      </main>
    </TooltipProvider>
  );
}
