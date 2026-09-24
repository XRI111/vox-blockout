// Modified for the AlchemyWorx internal fork (2026); see MODIFICATIONS.md.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { useStore } from './store'
import { ShotEvaluator } from '@engine/evaluate'
import { analyzeSafeZone, projectToFrame } from '@engine/safe-zone'
import { ASPECT_RATIOS } from '@engine/camera'
import {
  exportShot,
  exportStillAtPlayhead,
  exportDims,
  renderStillPngForTest,
  renderRawForTest,
  type ExportResolution
} from './export/exporter'
import { registerControlHandler } from './control/handler'
import { getSceneManager } from './export/scene-access'
import { getProfile } from '@engine/profiles'
import { MOTION_PRESETS } from '@engine/motions'
import { ACTION_PRESETS } from '@engine/action-presets'
import type { AspectId } from '@engine/types'

// Automation surface for the e2e smoke test and for AI-agent driving —
// not a public API; see AGENTS.md.
;(window as unknown as Record<string, unknown>).__blockout = {
  store: useStore,
  exportShot,
  exportStillAtPlayhead,
  exportDimsForTest: (profileId: string, aspect: AspectId, res: ExportResolution) =>
    exportDims(getProfile(profileId), aspect, res),
  renderStillPngForTest,
  renderRawForTest,
  // AW fork: the engine's pure projection beside the renderer's, for the same
  // points and the same instant. The engine must reproduce the three.js shot
  // camera exactly; this is where that is checked across camera poses.
  projectForTest: (t: number, points: { x: number; y: number; z: number }[]) => {
    const st = useStore.getState()
    const scene = st.scene()
    const shot = st.shot()
    const manager = getSceneManager()
    if (!scene || !shot || !manager) return null
    const three = manager.projectWithRendererCamera(t, points)
    const state = new ShotEvaluator(scene, shot).evaluate(t)
    const aspect = ASPECT_RATIOS[shot.aspect]
    return {
      three,
      engine: points.map((p) => projectToFrame(state.camera, aspect, p))
    }
  },
  // AW fork: the safe-zone report for the live scene at time t. The e2e
  // compares its projected boxes against a real pixel diff — the overlay's
  // whole value rests on the engine's camera matching the renderer's, and
  // that cannot be checked from inside the engine's own tests.
  safeZoneForTest: (t: number) => {
    const st = useStore.getState()
    const scene = st.scene()
    const shot = st.shot()
    if (!scene || !shot) return null
    return analyzeSafeZone(
      scene,
      shot,
      new ShotEvaluator(scene, shot).evaluate(t),
      getSceneManager()?.entityWorldBounds()
    )
  },
  MOTION_PRESETS,
  ACTION_PRESETS
}

// External agents (MCP clients) drive the app through this whitelist.
registerControlHandler()

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
