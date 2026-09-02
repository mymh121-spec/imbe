'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Activity, AudioLines, Camera, CameraOff, Crosshair, Eye, EyeOff, FileAudio,
  Hand, MousePointer2, Pause, Play, Printer, Radio, Repeat2, ScanLine, Square,
  TestTube2, Upload,
} from 'lucide-react';
import { BatonStage } from '@/components/baton-stage';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AudioEngine, type AudioPlaybackState } from '@/modules/audioEngine';
import { BatonController } from '@/modules/batonController';
import { CameraInput, type CameraState } from '@/modules/cameraInput';
import {
  CalibrationManager, DEFAULT_CALIBRATION, printMarkerSheet, type CalibrationSettings,
} from '@/modules/calibration';
import { DEFAULT_MAPPING, mapGesture, type MappingSettings } from '@/modules/gestureMapping';
import { HandDetection, type HandDetectorState } from '@/modules/handDetection';
import { MarkerDetection } from '@/modules/markerDetection';
import { estimateBoardPose } from '@/modules/poseEstimation';
import type { BatonFrame, BatonPose, BoardPose, MappingOutput } from '@/modules/types';

type InputMode = 'simulation' | 'camera';
type CameraTrackingMode = 'hand' | 'marker';

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
  const detectorRef = useRef<MarkerDetection | null>(null);
  const handDetectorRef = useRef<HandDetection | null>(null);
  const calibrationRef = useRef<CalibrationManager | null>(null);
  const controllerRef = useRef<BatonController | null>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const modeRef = useRef<InputMode>('simulation');
  const trackingModeRef = useRef<CameraTrackingMode>('hand');
  const cameraStateRef = useRef<CameraState>('off');
  const simulationPoseRef = useRef<BatonPose | null>(null);
  const cameraPoseRef = useRef<BatonPose | null>(null);
  const lastBoardPoseRef = useRef<BoardPose | null>(null);
  const calibrationSettingsRef = useRef<CalibrationSettings>(DEFAULT_CALIBRATION);
  const mappingSettingsRef = useRef<MappingSettings>(DEFAULT_MAPPING);
  const lastDetectionRef = useRef(0);
  const lastUiUpdateRef = useRef(0);

  const [mode, setMode] = useState<InputMode>('simulation');
  const [trackingMode, setTrackingMode] = useState<CameraTrackingMode>('hand');
  const [cameraState, setCameraState] = useState<CameraState>('off');
  const [markerIds, setMarkerIds] = useState<number[]>([]);
  const [handState, setHandState] = useState<HandDetectorState>('idle');
  const [handDetected, setHandDetected] = useState(false);
  const [handedness, setHandedness] = useState<string | null>(null);
  const [detectionMs, setDetectionMs] = useState(0);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [frame, setFrame] = useState<BatonFrame>(INITIAL_FRAME);
  const [mapped, setMapped] = useState<MappingOutput>(INITIAL_MAPPING);
  const [mappingSettings, setMappingSettings] = useState<MappingSettings>(DEFAULT_MAPPING);
  const [calibrationSettings, setCalibrationSettings] = useState<CalibrationSettings>(DEFAULT_CALIBRATION);
  const [calibrationMessage, setCalibrationMessage] = useState('영점 미설정');
  const [playback, setPlayback] = useState<AudioPlaybackState>('stopped');
  const [loop, setLoop] = useState(true);
  const [trackInfo, setTrackInfo] = useState([
    { name: 'Pulse 110', level: 0.34, hasFile: false },
    { name: 'Body 220', level: 0.24, hasFile: false },
    { name: 'Air 330', level: 0.16, hasFile: false },
  ]);
  const [audioMeter, setAudioMeter] = useState(0);

  useEffect(() => {
    const camera = new CameraInput();
    const detector = new MarkerDetection();
    const handDetector = new HandDetection();
    const calibration = new CalibrationManager();
    const controller = new BatonController();
    const audio = new AudioEngine();
    cameraRef.current = camera;
    detectorRef.current = detector;
    handDetectorRef.current = handDetector;
    calibrationRef.current = calibration;
    controllerRef.current = controller;
    audioRef.current = audio;
    const savedCalibration = calibration.getSettings();
    calibrationSettingsRef.current = savedCalibration;
    queueMicrotask(() => setCalibrationSettings(savedCalibration));

    let animationFrame = 0;
    const tick = (now: number) => {
      const activeMode = modeRef.current;
      const activeTrackingMode = trackingModeRef.current;
      if (
        cameraStateRef.current === 'ready' &&
        videoRef.current &&
        now - lastDetectionRef.current > (activeTrackingMode === 'hand' ? 55 : 70)
      ) {
        lastDetectionRef.current = now;
        if (activeTrackingMode === 'hand' && handDetectorRef.current) {
          const detection = handDetectorRef.current.detect(videoRef.current, previewRef.current ?? undefined, now);
          if (detection) {
            setHandDetected(detection.handCount > 0);
            setHandedness(detection.handedness);
            setMarkerIds([]);
            setDetectionMs(detection.durationMs);
            if (detection.pose) cameraPoseRef.current = detection.pose;
          }
        } else if (detectorRef.current) {
          const detection = detectorRef.current.detect(videoRef.current, previewRef.current ?? undefined);
          if (detection) {
            const configured = calibrationSettingsRef.current;
            const relevant = detection.markers.filter((marker) => configured.markers.some((item) => item.id === marker.id));
            setMarkerIds(relevant.map((marker) => marker.id));
            setHandDetected(false);
            setDetectionMs(detection.durationMs);
            const intrinsics = calibration.getIntrinsics(detection.width, detection.height);
            const boardPose = estimateBoardPose(relevant, configured.markers, configured.markerSizeMm, intrinsics, now);
            if (boardPose) {
              lastBoardPoseRef.current = boardPose;
              cameraPoseRef.current = calibration.normalize(boardPose);
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

  const changeTrackingMode = (next: CameraTrackingMode) => {
    trackingModeRef.current = next;
    setTrackingMode(next);
    setMarkerIds([]);
    setHandDetected(false);
    setHandedness(null);
    setDetectionMs(0);
    cameraPoseRef.current = null;
    if (cameraStateRef.current === 'ready') {
      changeMode('camera');
      if (next === 'hand') void prepareHandDetector();
    }
  };

  const toggleCamera = async () => {
    const camera = cameraRef.current;
    const video = videoRef.current;
    if (!camera || !video) return;
    if (cameraStateRef.current === 'ready') {
      camera.stop();
      cameraStateRef.current = 'off';
      setCameraState('off');
      setMarkerIds([]);
      setHandDetected(false);
      setHandedness(null);
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
      if (trackingModeRef.current === 'hand') void prepareHandDetector();
    }
  };

  const updateMapping = <K extends keyof MappingSettings>(key: K, value: MappingSettings[K]) => {
    const next = { ...mappingSettingsRef.current, [key]: value };
    mappingSettingsRef.current = next;
    controllerRef.current?.setSmoothing(next.smoothingHz);
    setMappingSettings(next);
  };

  const updateCalibration = (next: CalibrationSettings) => {
    calibrationSettingsRef.current = next;
    calibrationRef.current?.update(next);
    setCalibrationSettings(next);
  };

  const updateMarker = (index: number, key: 'id' | 'xMm' | 'yMm' | 'rotationDeg', value: number) => {
    const markers = calibrationSettings.markers.map((marker, markerIndex) =>
      markerIndex === index ? { ...marker, [key]: value } : marker,
    );
    updateCalibration({ ...calibrationSettings, markers });
  };

  const calibrateNeutral = () => {
    const pose = lastBoardPoseRef.current;
    if (!pose || performance.now() - pose.timestamp > 600 || !calibrationRef.current) {
      setCalibrationMessage('마커 보드가 필요합니다');
      return;
    }
    calibrationRef.current.setNeutral(pose);
    const next = calibrationRef.current.getSettings();
    calibrationSettingsRef.current = next;
    setCalibrationSettings(next);
    setCalibrationMessage(`영점 ${new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`);
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

  const useTestTones = () => {
    audioRef.current?.useTestTones();
    setTrackInfo(audioRef.current?.getTrackInfo() ?? trackInfo);
  };

  const cameraTrackingActive = trackingMode === 'hand' ? handDetected : markerIds.length > 0;
  const handTrackingLabel = handDetected
    ? `${handedness === 'Left' ? '왼손' : handedness === 'Right' ? '오른손' : '손'} 추적 중`
    : HAND_STATE_LABELS[handState];
  const trackingLabel = mode === 'simulation'
    ? '시뮬레이션 입력'
    : cameraState !== 'ready'
      ? CAMERA_LABELS[cameraState]
      : trackingMode === 'hand'
        ? handTrackingLabel
        : markerIds.length
          ? `${markerIds.length}개 마커 추적 중`
          : '마커 미검출';

  const statusTone = mode === 'simulation' || cameraTrackingActive
    ? 'ok'
    : cameraState === 'denied' || cameraState === 'error' || handState === 'error' ? 'error' : 'warn';

  return (
    <TooltipProvider>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <span className="brand-mark" aria-hidden="true"><Radio size={18} /></span>
            <div><h1>GESTURE CONDUCTOR</h1><p>다중 마커 3D 지휘 · 실시간 오디오 믹싱</p></div>
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
                <span className="signal-badge">CONF {Math.round(frame.confidence * 100)}%</span>
              </div>
            </div>
            <BatonStage frame={frame} simulationEnabled={mode === 'simulation'} onSimulationPose={handleSimulationPose} />
            <div className="stage-readout">
              {[
                ['X', numberText(frame.position.x), 'norm'],
                ['Y', numberText(frame.position.y), 'norm'],
                ['Z', frame.position.z.toFixed(2), 'depth'],
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
                <TabsTrigger value="calibration">보정</TabsTrigger>
              </TabsList>

              <TabsContent value="input" className="tab-body">
                <div className="section-title"><div><span className="eyebrow">CAMERA</span><h2>손 · 마커 입력</h2></div><Camera size={17} /></div>
                <div className="tracking-source-switch" aria-label="카메라 추적 방식">
                  <button className={trackingMode === 'hand' ? 'active' : ''} aria-pressed={trackingMode === 'hand'} onClick={() => changeTrackingMode('hand')}><Hand />손 추적</button>
                  <button className={trackingMode === 'marker' ? 'active' : ''} aria-pressed={trackingMode === 'marker'} onClick={() => changeTrackingMode('marker')}><ScanLine />마커 추적</button>
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
                  <div><dt>{trackingMode === 'hand' ? '손 추적' : '마커 ID'}</dt><dd>{trackingMode === 'hand' ? handTrackingLabel : markerIds.length ? markerIds.join(', ') : '없음'}</dd></div>
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
              </TabsContent>

              <TabsContent value="calibration" className="tab-body calibration-body">
                <div className="section-title"><div><span className="eyebrow">BOARD SETUP</span><h2>카메라 · 마커 보정</h2></div><Crosshair size={17} /></div>
                <div className="field-grid">
                  <label><span>마커 크기</span><input type="number" min="10" max="100" value={calibrationSettings.markerSizeMm} onChange={(event) => updateCalibration({ ...calibrationSettings, markerSizeMm: Number(event.target.value) })} /><small>mm</small></label>
                  <label><span>수평 화각</span><input type="number" min="30" max="110" value={calibrationSettings.horizontalFovDeg} onChange={(event) => updateCalibration({ ...calibrationSettings, horizontalFovDeg: Number(event.target.value) })} /><small>deg</small></label>
                  <label><span>X 이동 범위</span><input type="number" min="40" max="500" value={calibrationSettings.xRangeMm} onChange={(event) => updateCalibration({ ...calibrationSettings, xRangeMm: Number(event.target.value) })} /><small>mm</small></label>
                  <label><span>Y 이동 범위</span><input type="number" min="40" max="500" value={calibrationSettings.yRangeMm} onChange={(event) => updateCalibration({ ...calibrationSettings, yRangeMm: Number(event.target.value) })} /><small>mm</small></label>
                  <label><span>깊이 범위</span><input type="number" min="80" max="800" value={calibrationSettings.depthRangeMm} onChange={(event) => updateCalibration({ ...calibrationSettings, depthRangeMm: Number(event.target.value) })} /><small>mm</small></label>
                </div>
                <label className="select-control"><span>사용 마커</span><select value={calibrationSettings.markers.length} onChange={(event) => {
                  const count = Number(event.target.value);
                  const markers = count === 2
                    ? calibrationSettings.markers.slice(0, 2)
                    : [...calibrationSettings.markers, DEFAULT_CALIBRATION.markers[2]].slice(0, 3);
                  updateCalibration({ ...calibrationSettings, markers });
                }}><option value="2">2개</option><option value="3">3개</option></select></label>
                <div className="marker-table">
                  <div className="marker-table-head"><span>ID</span><span>X mm</span><span>Y mm</span><span>회전 °</span></div>
                  {calibrationSettings.markers.map((marker, index) => (
                    <div className="marker-table-row" key={index}>
                      <input aria-label={`마커 ${index + 1} ID`} type="number" min="0" max="1023" value={marker.id} onChange={(event) => updateMarker(index, 'id', Number(event.target.value))} />
                      <input aria-label={`마커 ${index + 1} X 위치`} type="number" value={marker.xMm} onChange={(event) => updateMarker(index, 'xMm', Number(event.target.value))} />
                      <input aria-label={`마커 ${index + 1} Y 위치`} type="number" value={marker.yMm} onChange={(event) => updateMarker(index, 'yMm', Number(event.target.value))} />
                      <input aria-label={`마커 ${index + 1} 회전`} type="number" step="90" value={marker.rotationDeg} onChange={(event) => updateMarker(index, 'rotationDeg', Number(event.target.value))} />
                    </div>
                  ))}
                </div>
                <div className="button-row wrap">
                  <Button onClick={calibrateNeutral}><Crosshair data-icon="inline-start" />영점 보정</Button>
                  <Button variant="outline" onClick={() => printMarkerSheet(calibrationSettings)}><Printer data-icon="inline-start" />마커 출력</Button>
                </div>
                <p className="calibration-state">{calibrationMessage} · 기준 Z {calibrationSettings.neutralTranslationMm.z.toFixed(0)} mm</p>
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
              <Meter value={audioMeter} tone="coral" />
              <div className="button-row wrap">
                <input ref={fileInputRef} className="visually-hidden" type="file" accept="audio/*" multiple onChange={(event) => void handleFiles(event.target.files)} />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}><Upload data-icon="inline-start" />오디오 불러오기</Button>
                <Button variant="outline" onClick={useTestTones}><TestTube2 data-icon="inline-start" />테스트톤</Button>
              </div>
              <div className="master-values">
                <span><small>MASTER</small><b>{Math.round(mapped.masterGain * 100)}%</b></span>
                <span><small>PAN</small><b>{numberText(mapped.pan)}</b></span>
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
