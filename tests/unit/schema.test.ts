import { describe, expect, it } from 'vitest'
import {
  createProject,
  createScene,
  createEntity,
  serializeProject,
  parseProject,
  validateProject
} from '@engine/schema'
import { generatePrompt } from '@engine/prompt'
import { getProfile, BUILTIN_PROFILES } from '@engine/profiles'
import { createActorMark, createCameraMark } from '@engine/schema'
import { effectiveScale, rotationOf } from '@engine/transform'

describe('schema round-trip', () => {
  it('serialize → parse reproduces the document exactly', () => {
    const doc = createProject('Roundtrip')
    const scene = doc.scenes[0]!
    const man = createEntity('person.man', 'Man', { x: 1, y: 0, z: -2 })
    man.label = { text: 'HERO', color: '#e5484d' }
    scene.entities.push(man)
    scene.blocking[0]!.tracks.push({
      entityId: man.id,
      marks: [createActorMark({ x: 1, y: 0, z: -2 }, 0), createActorMark({ x: 4, y: 0, z: -8 }, 3, 'run')]
    })
    scene.shots[0]!.camera.marks.push(createCameraMark({ x: 5, y: 1.6, z: 2 }, 0, 0.3, -0.05, 50))

    const json = serializeProject(doc)
    const { doc: parsed, issues } = parseProject(json)
    expect(issues).toEqual([])
    expect(parsed).toEqual(doc)
  })

  it('serialization is byte-stable regardless of key insertion order', () => {
    const doc = createProject('Stable')
    const a = serializeProject(doc)
    // Shuffle top-level keys by rebuilding the object in a different order.
    const shuffled = JSON.parse(JSON.stringify({ scenes: doc.scenes, version: doc.version, settings: doc.settings, name: doc.name, id: doc.id }))
    const b = serializeProject(shuffled)
    expect(a).toBe(b)
  })

  it('rejects invalid JSON and wrong versions', () => {
    expect(parseProject('not json').doc).toBeNull()
    expect(parseProject('{"version": 99, "name": "x", "scenes": []}').doc).toBeNull()
  })

  it('migrates scans: missing → [], malformed refs dropped, defaults filled', () => {
    const doc = createProject('Scans')
    const json = JSON.parse(serializeProject(doc)) as Record<string, unknown>
    const scene = (json.scenes as Record<string, unknown>[])[0]!
    // A v1 document has no scans key at all.
    delete scene.scans
    const v1 = parseProject(JSON.stringify(json))
    expect(v1.doc?.scenes[0]?.scans).toEqual([])

    // Malformed entries are dropped; partial entries get safe defaults.
    scene.scans = [
      null,
      42,
      { id: 'scan_x' }, // no file → dropped
      { file: 'scans/loft.splat', position: { x: 1 } } // partial → defaults
    ]
    const v2 = parseProject(JSON.stringify(json))
    const scans = v2.doc?.scenes[0]?.scans
    expect(scans).toHaveLength(1)
    expect(scans?.[0]).toMatchObject({
      file: 'scans/loft.splat',
      position: { x: 1, y: 0, z: 0 },
      rotationY: 0,
      scale: 1,
      visible: true
    })
  })

  it('flags a shot referencing a missing blocking take', () => {
    const doc = createProject('Bad')
    doc.scenes[0]!.shots[0]!.blockingTakeId = 'take_missing'
    const issues = validateProject(JSON.parse(serializeProject(doc)))
    expect(issues.some((i) => i.message.includes('blocking take'))).toBe(true)
  })

  it('new scenes come with a master take and one shot', () => {
    const scene = createScene(3)
    expect(scene.blocking.length).toBe(1)
    expect(scene.shots.length).toBe(1)
    expect(scene.shots[0]!.name).toBe('3A')
    expect(scene.shots[0]!.blockingTakeId).toBe(scene.blocking[0]!.id)
  })
})

describe('prompt generation', () => {
  function promptFixture() {
    const doc = createProject('Prompt')
    const scene = doc.scenes[0]!
    const shot = scene.shots[0]!
    const man = createEntity('person.man', 'Man', { x: 0, y: 0, z: 0 })
    man.label = { text: 'THIEF', color: '#e5484d' }
    scene.entities.push(man)
    scene.blocking[0]!.tracks.push({
      entityId: man.id,
      marks: [
        createActorMark({ x: 0, y: 0, z: 0 }, 0, 'walk'),
        createActorMark({ x: 0, y: 0, z: -8 }, 3, 'run')
      ]
    })
    shot.camera.marks.push(
      createCameraMark({ x: 4, y: 1.6, z: 4 }, 0, 0, 0, 35),
      createCameraMark({ x: 4, y: 1.6, z: -4 }, 5, 0, 0, 85)
    )
    return { scene, shot }
  }

  it('v5: short prompt with lens, label, and the motion-reference directive', () => {
    const { scene, shot } = promptFixture()
    const profile = getProfile('seedance-2')
    const prompt = generatePrompt(scene, shot, profile)
    expect(prompt).toContain('35mm')
    expect(prompt).toContain('THIEF')
    expect(prompt).toContain('strictly as a motion reference')
    // No choreography dump — the reference video carries the detail.
    expect(prompt).not.toContain('3s')
    expect(prompt.toLowerCase()).not.toContain('zooms in')
    expect(prompt.length).toBeLessThan(600)
  })

  it('every builtin profile produces a non-empty prompt', () => {
    const { scene, shot } = promptFixture()
    for (const p of BUILTIN_PROFILES) {
      const prompt = generatePrompt(scene, shot, p)
      expect(prompt.length).toBeGreaterThan(100)
    }
  })

  it('unknown profile ids fall back to the first builtin', () => {
    expect(getProfile('nope').id).toBe(BUILTIN_PROFILES[0]!.id)
  })
})

/**
 * AW fork: the pose fields are additive, so the thing to prove is that they
 * cost a pre-existing project nothing. A document written before they existed
 * must parse to the identity pose AND must not gain keys on the way back out,
 * or every old project shows a spurious diff the first time it is opened.
 */
describe('AW static pose migration', () => {
  it('a document with no pose fields parses upright and unstretched', () => {
    const doc = createProject('Old')
    const e = createEntity('prop.suitcase', 'Bag', { x: 0, y: 0, z: 0 })
    doc.scenes[0]!.entities.push(e)
    const raw = JSON.parse(serializeProject(doc)) as {
      scenes: Array<{ entities: Array<Record<string, unknown>> }>
    }
    // Simulate a pre-fork file: no rotationX / rotationZ / stretch anywhere.
    const t = raw.scenes[0]!.entities[0]!.transform as Record<string, unknown>
    expect('rotationX' in t).toBe(false)
    expect('stretch' in t).toBe(false)

    const { doc: parsed, issues } = parseProject(JSON.stringify(raw))
    expect(issues).toEqual([])
    const pt = parsed!.scenes[0]!.entities[0]!.transform
    expect(rotationOf(pt)).toEqual({ x: 0, y: 0, z: 0 })
    expect(effectiveScale(pt)).toEqual({ x: 1, y: 1, z: 1 })
    // And it did not gain keys, so re-saving produces no phantom diff.
    expect('rotationX' in pt).toBe(false)
    expect('stretch' in pt).toBe(false)
  })

  it('a posed entity survives serialize → parse unchanged', () => {
    const doc = createProject('Posed')
    const e = createEntity('product.biaggi.runway-carry-on', 'Runway', { x: 0, y: 0, z: 0 })
    e.transform.rotationX = Math.PI / 2
    e.transform.rotationZ = -Math.PI / 4
    e.transform.stretch = { x: 1, y: 1.08, z: 0.95 }
    doc.scenes[0]!.entities.push(e)
    const { doc: parsed, issues } = parseProject(serializeProject(doc))
    expect(issues).toEqual([])
    expect(parsed).toEqual(doc)
  })

  it('junk in the pose fields degrades to upright instead of rejecting the file', () => {
    const doc = createProject('Junk')
    doc.scenes[0]!.entities.push(createEntity('prop.crate', 'Crate', { x: 0, y: 0, z: 0 }))
    const raw = JSON.parse(serializeProject(doc)) as {
      scenes: Array<{ entities: Array<{ transform: Record<string, unknown> }> }>
    }
    raw.scenes[0]!.entities[0]!.transform.rotationX = 'sideways'
    raw.scenes[0]!.entities[0]!.transform.stretch = { x: 1, y: null }
    const { doc: parsed, issues } = parseProject(JSON.stringify(raw))
    expect(issues).toEqual([])
    const pt = parsed!.scenes[0]!.entities[0]!.transform
    expect('rotationX' in pt).toBe(false)
    expect(effectiveScale(pt)).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('an identity stretch on disk is dropped, not preserved as noise', () => {
    const doc = createProject('Identity')
    doc.scenes[0]!.entities.push(createEntity('prop.crate', 'Crate', { x: 0, y: 0, z: 0 }))
    const raw = JSON.parse(serializeProject(doc)) as {
      scenes: Array<{ entities: Array<{ transform: Record<string, unknown> }> }>
    }
    raw.scenes[0]!.entities[0]!.transform.stretch = { x: 1, y: 1, z: 1 }
    const { doc: parsed } = parseProject(JSON.stringify(raw))
    expect('stretch' in parsed!.scenes[0]!.entities[0]!.transform).toBe(false)
  })
})
