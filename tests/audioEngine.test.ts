import { describe, expect, it } from 'vitest';
import { AudioEngine } from '../modules/audioEngine';

describe('AudioEngine manual controls', () => {
  it('clamps dynamics, tempo, and balance to safe ranges', () => {
    const audio = new AudioEngine();

    audio.setDynamicsLevel(-1);
    expect(audio.dynamics).toBe(0);
    audio.setDynamicsLevel(2);
    expect(audio.dynamics).toBe(1);

    audio.setTempoBpm(20);
    expect(audio.tempo).toBe(60);
    audio.setTempoBpm(250);
    expect(audio.tempo).toBe(180);

    audio.setManualPan(-2);
    expect(audio.balance).toBe(-1);
    audio.setManualPan(2);
    expect(audio.balance).toBe(1);
  });

  it('stores mute state before the audio graph is initialized', () => {
    const audio = new AudioEngine();
    audio.setMuted(true);
    expect(audio.isMuted).toBe(true);
    audio.setMuted(false);
    expect(audio.isMuted).toBe(false);
  });
});
