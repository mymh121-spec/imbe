'use client';

import { useEffect, useRef } from 'react';
import { SimulationMode } from '@/modules/simulationMode';
import { BatonVisualizer } from '@/modules/visualizer';
import type { BatonFrame, BatonPose } from '@/modules/types';

type BatonStageProps = {
  frame: BatonFrame;
  simulationEnabled: boolean;
  onSimulationPose: (pose: BatonPose) => void;
};

export function BatonStage({ frame, simulationEnabled, onSimulationPose }: BatonStageProps) {
  const mountRef = useRef<HTMLButtonElement>(null);
  const visualizerRef = useRef<BatonVisualizer | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    visualizerRef.current = new BatonVisualizer(mountRef.current);
    return () => {
      visualizerRef.current?.dispose();
      visualizerRef.current = null;
    };
  }, []);

  useEffect(() => {
    visualizerRef.current?.update(frame);
  }, [frame]);

  useEffect(() => {
    if (!mountRef.current || !simulationEnabled) return;
    const simulation = new SimulationMode();
    simulation.attach(mountRef.current, onSimulationPose);
    return () => simulation.detach();
  }, [simulationEnabled, onSimulationPose]);

  return (
    <button
      type="button"
      className={`baton-stage ${simulationEnabled ? 'is-simulation' : ''}`}
      ref={mountRef}
      tabIndex={simulationEnabled ? 0 : -1}
      aria-label={simulationEnabled ? '마우스와 키보드로 조작하는 3차원 지휘봉' : '카메라로 추적되는 3차원 지휘봉'}
    >
      <span className="stage-reticle" aria-hidden="true" />
      <span className="stage-axis axis-x">X</span>
      <span className="stage-axis axis-y">Y</span>
      <span className="stage-axis axis-z">Z</span>
    </button>
  );
}
