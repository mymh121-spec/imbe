import type { MappingOutput } from './types';

export type AudioPlaybackState = 'stopped' | 'playing' | 'paused';
export type SynthWaveform = 'sine' | 'triangle' | 'square';

type TrackChain = {
  pulse: GainNode;
  gain: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  pan: StereoPannerNode;
  source: AudioBufferSourceNode | OscillatorNode | null;
  buffer: AudioBuffer | null;
  name: string;
  level: number;
};

const SYNTH_FREQUENCIES = [440, 880, 1320];
const SYNTH_NAMES = ['A4 Base 440', '2nd Harmonic 880', '3rd Harmonic 1320'];

export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private analyser: AnalyserNode | null = null;
  private tracks: TrackChain[] = [];
  private playbackState: AudioPlaybackState = 'stopped';
  private loop = true;
  private pausedOffset = 0;
  private startedAt = 0;
  private requestedMasterGain = 0.5;
  private duckUntil = 0;
  private synthWaveform: SynthWaveform = 'sine';
  private muted = false;
  private dynamicsLevel = 0.7;
  private tempoBpm = 100;
  private manualPan = 0;
  private gesturePan = 0;
  private tempoLfo: OscillatorNode | null = null;
  private tempoDepth: GainNode | null = null;

  get state() { return this.playbackState; }
  get isLooping() { return this.loop; }
  get waveform() { return this.synthWaveform; }
  get isMuted() { return this.muted; }
  get dynamics() { return this.dynamicsLevel; }
  get tempo() { return this.tempoBpm; }
  get balance() { return this.manualPan; }

  getTrackInfo() {
    return Array.from({ length: 3 }, (_, index) => ({
      name: this.tracks[index]?.name ?? SYNTH_NAMES[index],
      level: this.tracks[index]?.level ?? [0.34, 0.24, 0.16][index],
      hasFile: Boolean(this.tracks[index]?.buffer),
    }));
  }

  async ensureReady() {
    if (!this.context) this.createGraph();
    if (this.context?.state === 'suspended') await this.context.resume();
  }

  async play() {
    await this.ensureReady();
    if (!this.context || this.playbackState === 'playing') return;
    this.startSources(this.pausedOffset);
    this.startedAt = this.context.currentTime;
    this.playbackState = 'playing';
  }

  pause() {
    if (!this.context || this.playbackState !== 'playing') return;
    this.pausedOffset = this.getCurrentOffset();
    this.stopSources();
    this.playbackState = 'paused';
  }

  stop() {
    this.stopSources();
    this.pausedOffset = 0;
    this.startedAt = 0;
    this.playbackState = 'stopped';
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.context || !this.master) return;
    const target = muted ? 0 : this.requestedMasterGain * this.dynamicsLevel;
    this.ramp(this.master.gain, target, this.context.currentTime, 0.025);
  }

  setDynamicsLevel(level: number) {
    this.dynamicsLevel = Math.min(1, Math.max(0, level));
    if (!this.context || !this.master || this.muted) return;
    const target = this.requestedMasterGain * this.dynamicsLevel;
    this.ramp(this.master.gain, target, this.context.currentTime, 0.27);
  }

  setTempoBpm(bpm: number) {
    const nextTempo = Math.min(180, Math.max(60, Math.round(bpm)));
    if (this.context && this.playbackState === 'playing') {
      this.pausedOffset = this.getCurrentOffset();
      this.startedAt = this.context.currentTime;
    }
    this.tempoBpm = nextTempo;
    if (!this.context) return;
    const now = this.context.currentTime;
    this.tempoLfo?.frequency.setTargetAtTime(nextTempo / 60, now, 0.025);
    this.tracks.forEach((track) => {
      if (track.source instanceof AudioBufferSourceNode) {
        track.source.playbackRate.setTargetAtTime(this.getPlaybackRate(), now, 0.025);
      }
    });
  }

  setManualPan(pan: number) {
    this.manualPan = Math.min(1, Math.max(-1, pan));
    if (!this.context) return;
    const target = Math.min(1, Math.max(-1, this.gesturePan + this.manualPan));
    this.tracks.forEach((track) => this.ramp(track.pan.pan, target, this.context!.currentTime, 0.025));
  }

  setLoop(enabled: boolean) {
    this.loop = enabled;
    this.tracks.forEach((track) => {
      if (track.source instanceof AudioBufferSourceNode) track.source.loop = enabled;
    });
  }

  async loadFiles(files: File[]) {
    await this.ensureReady();
    if (!this.context) return;
    const wasPlaying = this.playbackState === 'playing';
    if (wasPlaying) this.stopSources();
    const selected = files.slice(0, 3);
    for (let index = 0; index < selected.length; index += 1) {
      const buffer = await this.context.decodeAudioData(await selected[index].arrayBuffer());
      this.tracks[index].buffer = buffer;
      this.tracks[index].name = selected[index].name;
    }
    if (wasPlaying) this.startSources(this.pausedOffset);
  }

  useTestTones(waveform: SynthWaveform = this.synthWaveform) {
    this.synthWaveform = waveform;
    this.tracks.forEach((track, index) => {
      track.buffer = null;
      track.name = SYNTH_NAMES[index];
    });
    if (this.playbackState === 'playing') {
      this.stopSources();
      this.startSources(0);
    }
  }

  setTrackGain(index: number, gain: number) {
    const track = this.tracks[index];
    if (!track || !this.context) return;
    track.level = Math.min(1, Math.max(0, gain));
    track.gain.gain.setTargetAtTime(track.level, this.context.currentTime, 0.035);
  }

  applyMapping(mapping: MappingOutput, rampSeconds: number) {
    if (!this.context || !this.master) return;
    const now = this.context.currentTime;
    this.requestedMasterGain = mapping.masterGain;
    this.gesturePan = mapping.pan;
    const mappedMaster = performance.now() < this.duckUntil
      ? mapping.masterGain * this.dynamicsLevel * 0.12
      : mapping.masterGain * this.dynamicsLevel;
    const masterTarget = this.muted ? 0 : mappedMaster;
    const panTarget = Math.min(1, Math.max(-1, mapping.pan + this.manualPan));
    const timeConstant = Math.max(0.012, rampSeconds / 3);
    this.ramp(this.master.gain, masterTarget, now, timeConstant);
    this.tracks.forEach((track) => {
      this.ramp(track.pan.pan, panTarget, now, timeConstant);
      this.ramp(track.low.gain, mapping.lowEq, now, timeConstant);
      this.ramp(track.mid.gain, mapping.midEq, now, timeConstant);
      this.ramp(track.high.gain, mapping.highEq, now, timeConstant);
    });
  }

  handleSuddenStop(action: 'off' | 'duck' | 'pause') {
    if (action === 'pause') this.pause();
    if (action === 'duck') this.duckUntil = performance.now() + 320;
  }

  getMeterLevel() {
    if (!this.analyser) return 0;
    const samples = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(samples);
    const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
    return Math.min(1, rms * 3.2);
  }

  dispose() {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  private createGraph() {
    this.context = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : this.requestedMasterGain * this.dynamicsLevel;
    this.compressor = this.context.createDynamicsCompressor();
    this.compressor.threshold.value = -8;
    this.compressor.knee.value = 8;
    this.compressor.ratio.value = 4;
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.master.connect(this.compressor).connect(this.analyser).connect(this.context.destination);
    this.tracks = Array.from({ length: 3 }, (_, index) => this.createTrack(index));
  }

  private createTrack(index: number): TrackChain {
    const context = this.context!;
    const pulse = context.createGain();
    const gain = context.createGain();
    const low = context.createBiquadFilter();
    const mid = context.createBiquadFilter();
    const high = context.createBiquadFilter();
    const pan = context.createStereoPanner();
    const level = [0.34, 0.24, 0.16][index];
    gain.gain.value = level;
    low.type = 'lowshelf';
    low.frequency.value = 250;
    mid.type = 'peaking';
    mid.frequency.value = 1100;
    mid.Q.value = 0.8;
    high.type = 'highshelf';
    high.frequency.value = 4200;
    pulse.connect(gain).connect(low).connect(mid).connect(high).connect(pan).connect(this.master!);
    return { pulse, gain, low, mid, high, pan, source: null, buffer: null, name: SYNTH_NAMES[index], level };
  }

  private startSources(offset: number) {
    if (!this.context) return;
    this.stopSources();
    let hasSynthSource = false;
    this.tracks.forEach((track, index) => {
      if (track.buffer) {
        const source = this.context!.createBufferSource();
        source.buffer = track.buffer;
        source.loop = this.loop;
        source.playbackRate.value = this.getPlaybackRate();
        track.pulse.gain.value = 1;
        source.connect(track.pulse);
        source.start(0, offset % track.buffer.duration);
        track.source = source;
      } else {
        const oscillator = this.context!.createOscillator();
        oscillator.type = this.synthWaveform;
        oscillator.frequency.value = SYNTH_FREQUENCIES[index];
        track.pulse.gain.value = 0.55;
        oscillator.connect(track.pulse);
        oscillator.start();
        track.source = oscillator;
        hasSynthSource = true;
      }
    });
    if (hasSynthSource) this.startTempoPulse();
  }

  private stopSources() {
    if (this.tempoLfo) {
      try { this.tempoLfo.stop(); } catch { /* already stopped */ }
      this.tempoLfo.disconnect();
      this.tempoDepth?.disconnect();
      this.tempoLfo = null;
      this.tempoDepth = null;
    }
    this.tracks.forEach((track) => {
      if (!track.source) return;
      try { track.source.stop(); } catch { /* already stopped */ }
      track.source.disconnect();
      track.source = null;
    });
  }

  private startTempoPulse() {
    if (!this.context) return;
    const lfo = this.context.createOscillator();
    const depth = this.context.createGain();
    lfo.type = 'square';
    lfo.frequency.value = this.tempoBpm / 60;
    depth.gain.value = 0.45;
    lfo.connect(depth);
    this.tracks.forEach((track) => {
      if (track.source instanceof OscillatorNode) depth.connect(track.pulse.gain);
    });
    lfo.start();
    this.tempoLfo = lfo;
    this.tempoDepth = depth;
  }

  private getCurrentOffset() {
    if (!this.context || this.playbackState !== 'playing') return this.pausedOffset;
    return Math.max(0, this.pausedOffset + (this.context.currentTime - this.startedAt) * this.getPlaybackRate());
  }

  private getPlaybackRate() {
    return this.tempoBpm / 100;
  }

  private ramp(parameter: AudioParam, value: number, now: number, timeConstant: number) {
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(value, now, timeConstant);
  }
}
