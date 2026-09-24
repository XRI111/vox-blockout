/**
 * AlchemyWorx fork addition — keeping a tilted object on the ground.
 * See MODIFICATIONS.md and src/engine/transform.ts.
 *
 * Every asset in this library is built with its origin at ground level (see
 * AGENTS.md conventions). That convention and free rotation do not mix: spin a
 * 0.56 m carry-on 90 degrees about its own origin and half of it is below y=0.
 * In an export that renders as a bag buried to its handle, with nothing in the
 * package flagging it.
 *
 * So the pose is applied, then the object is lifted back until its lowest
 * point sits at the height the document asked for. The document keeps the
 * clean value; only the rendered object carries the lift. Both the viewport
 * and the `.glb` handoff call this, because a pose that rests on the floor in
 * one and sinks in the other is the kind of drift nobody notices until a
 * client sees it.
 */

import * as THREE from 'three'

/**
 * Metres to raise `object` so its lowest point lands on `groundY`. Zero when
 * the object has no measurable geometry, or already rests there.
 *
 * The caller must have set the object's own position, rotation and scale
 * first: this measures what is actually there.
 */
export function groundLiftFor(object: THREE.Object3D, groundY: number): number {
  object.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty() || !Number.isFinite(box.min.y)) return 0
  const lift = groundY - box.min.y
  // Sub-millimetre corrections are noise from float error, not a sunk object.
  return Math.abs(lift) < 1e-4 ? 0 : lift
}
