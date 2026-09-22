/**
 * AW fork: the generic parametric product system.
 *
 * The point of the system is dimensional accuracy, so most of this file is
 * arithmetic: a preset in inches has to come out the right number of metres,
 * and the shipped presets have to match the spec sheets they cite.
 */

import { describe, it, expect } from 'vitest'
import {
  allProducts,
  builtinProducts,
  clearProjectProducts,
  findState,
  getProduct,
  isProductAssetId,
  isValidPreset,
  parseProductFile,
  presetIdFromAssetId,
  productAssetId,
  resolveProduct,
  setProjectProducts,
  toMetres,
  type ProductPreset
} from '../../src/engine/products'
import { assetSpec, placeableAssets } from '../../src/engine/assets'

const IN = 0.0254
const near = (a: number, b: number, tol = 1e-9): void => expect(Math.abs(a - b)).toBeLessThan(tol)

const minimal = (over: Partial<ProductPreset> = {}): ProductPreset => ({
  id: 'test.block',
  name: 'Test block',
  category: 'test',
  unit: 'in',
  promptNoun: 'a test block',
  pieces: [{ archetype: 'roundedBox', width: 10, height: 20, depth: 5 }],
  ...over
})

describe('units', () => {
  it('converts every supported unit to metres', () => {
    near(toMetres(1, 'in'), 0.0254)
    near(toMetres(1, 'cm'), 0.01)
    near(toMetres(1, 'mm'), 0.001)
    near(toMetres(1, 'm'), 1)
  })

  it('resolves a preset into metres, not its authoring unit', () => {
    const r = resolveProduct(minimal())
    near(r.pieces[0]!.size.x, 10 * IN)
    near(r.pieces[0]!.size.y, 20 * IN)
    near(r.pieces[0]!.size.z, 5 * IN)
    near(r.height, 20 * IN)
  })

  it('lets a piece override the preset unit', () => {
    const r = resolveProduct(
      minimal({ pieces: [{ archetype: 'roundedBox', unit: 'cm', width: 10, height: 20, depth: 5 }] })
    )
    near(r.pieces[0]!.size.y, 0.2)
  })
})

describe('archetypes', () => {
  it('makes round archetypes circular in plan, ignoring depth', () => {
    const r = resolveProduct(
      minimal({ pieces: [{ archetype: 'cappedCylinder', width: 3, height: 1, depth: 99 }] })
    )
    near(r.pieces[0]!.size.z, 3 * IN)
  })

  it('defaults a tapered tube to 60% of its base diameter', () => {
    const r = resolveProduct(minimal({ pieces: [{ archetype: 'taperedTube', width: 2, height: 4 }] }))
    near(r.pieces[0]!.topDiameter!, 1.2 * IN)
  })

  it('honours an explicit top diameter', () => {
    const r = resolveProduct(
      minimal({ pieces: [{ archetype: 'taperedTube', width: 2, height: 4, topWidth: 1.8 }] })
    )
    near(r.pieces[0]!.topDiameter!, 1.8 * IN)
  })
})

describe('compound products', () => {
  it('places pieces at their offsets and takes the tallest as the height', () => {
    const r = resolveProduct(
      minimal({
        pieces: [
          { archetype: 'roundedBox', width: 6, height: 4, depth: 6 },
          { archetype: 'cappedCylinder', width: 3, height: 5, offset: { y: 4 } }
        ]
      })
    )
    expect(r.pieces).toHaveLength(2)
    near(r.pieces[1]!.position.y, 4 * IN)
    near(r.height, 9 * IN)
  })

  it('widens the bounds to the widest piece, wherever it sits', () => {
    const r = resolveProduct(
      minimal({
        pieces: [
          { archetype: 'roundedBox', width: 2, height: 2, depth: 2 },
          { archetype: 'roundedBox', width: 2, height: 1, depth: 2, offset: { x: 10 } }
        ]
      })
    )
    near(r.bounds.width, 12 * IN)
  })
})

describe('doors and lids', () => {
  const withDoor = (over: Record<string, unknown> = {}): ProductPreset =>
    minimal({
      pieces: [
        {
          archetype: 'roundedBox',
          width: 10,
          height: 20,
          depth: 4,
          door: { face: 'front', hinge: 'bottom', thickness: 0.5, ...over }
        }
      ],
      states: [
        { id: 'closed', label: 'Closed' },
        { id: 'open', label: 'Open', door: 90 },
        { id: 'folded', label: 'Folded', fold: 90 }
      ],
      defaultState: 'closed'
    })

  it('is shut in the default state', () => {
    expect(resolveProduct(withDoor()).pieces[0]!.door!.angle).toBe(0)
  })

  it('opens by the state angle, in radians', () => {
    const d = resolveProduct(withDoor(), 'open').pieces[0]!.door!
    near(Math.abs(d.angle), Math.PI / 2, 1e-12)
  })

  it('hinges a bottom-hinged front door about X, below the face centre', () => {
    const d = resolveProduct(withDoor()).pieces[0]!.door!
    expect(d.axis).toBe('x')
    // Front face is -Z, so the slab sits at negative Z.
    expect(d.pivot.z).toBeLessThan(0)
    near(d.pivot.y, 20 * IN * 0.5 - (20 * IN) / 2, 1e-12)
  })

  it('hinges a side door about Y', () => {
    const d = resolveProduct(withDoor({ hinge: 'left' })).pieces[0]!.door!
    expect(d.axis).toBe('y')
  })

  it('covers the whole face by default and less when asked', () => {
    near(resolveProduct(withDoor()).pieces[0]!.door!.size.x, 10 * IN)
    near(resolveProduct(withDoor({ coverage: 0.5 })).pieces[0]!.door!.size.x, 5 * IN)
  })

  it('splits off a secondary fold and shrinks the main slab to match', () => {
    const d = resolveProduct(withDoor({ foldFraction: 0.25 })).pieces[0]!.door!
    expect(d.fold).toBeDefined()
    near(d.fold!.size.y, 20 * IN * 0.25)
    near(d.size.y, 20 * IN * 0.75)
    // The two together still span the original face.
    near(d.size.y + d.fold!.size.y, 20 * IN)
  })

  it('hinges the flap on the main panel free edge, not inside it', () => {
    const d = resolveProduct(withDoor({ foldFraction: 0.25 })).pieces[0]!.door!
    // Bottom-hinged door: the free edge is the top of the (already shrunk)
    // main slab, so the fold pivot sits at exactly +half its height.
    near(d.fold!.pivot.y, d.size.y / 2)
    // And the flap's own centre is half a flap above that, so the two panels
    // meet edge to edge and span the original face exactly once.
    near(d.fold!.slabOffset.y, d.fold!.size.y / 2)
    near(d.fold!.pivot.y + d.fold!.slabOffset.y * 2, d.size.y / 2 + d.fold!.size.y)
  })

  it('folds the flap without opening the panel', () => {
    const d = resolveProduct(withDoor({ foldFraction: 0.25 }), 'folded').pieces[0]!.door!
    expect(d.angle).toBe(0)
    near(Math.abs(d.fold!.angle), Math.PI / 2, 1e-12)
  })

  it('ignores a degenerate fold fraction', () => {
    expect(resolveProduct(withDoor({ foldFraction: 0 })).pieces[0]!.door!.fold).toBeUndefined()
    expect(resolveProduct(withDoor({ foldFraction: 1 })).pieces[0]!.door!.fold).toBeUndefined()
  })

  it('leaves the bounds alone when a door opens, so framing does not jump', () => {
    const shut = resolveProduct(withDoor())
    const open = resolveProduct(withDoor(), 'open')
    expect(open.bounds).toEqual(shut.bounds)
  })
})

describe('parts', () => {
  const withParts = (parts: Record<string, unknown>[]): ProductPreset =>
    minimal({
      pieces: [{ archetype: 'roundedBox', width: 14, height: 20, depth: 8, parts: parts as never }],
      states: [
        { id: 'stowed', label: 'Stowed' },
        { id: 'up', label: 'Up', handleStop: 2 }
      ],
      defaultState: 'stowed'
    })

  it('expands wheels into individual corner parts', () => {
    const r = resolveProduct(withParts([{ kind: 'wheels', count: 4, size: 2 }]))
    const wheels = r.pieces[0]!.parts.filter((p) => p.kind === 'wheels')
    expect(wheels).toHaveLength(4)
    // All four hang below the shell and sit at distinct corners.
    expect(new Set(wheels.map((w) => `${w.position.x},${w.position.z}`)).size).toBe(4)
    for (const w of wheels) expect(w.position.y).toBeLessThan(0)
  })

  it('counts wheel drop in the overall height and rests the product on it', () => {
    const plain = resolveProduct(minimal({ pieces: [{ archetype: 'roundedBox', width: 14, height: 20, depth: 8 }] }))
    near(plain.height, 20 * IN)

    // A 20" shell on 2" wheels is a 22" bag, and 22" is the number that has
    // to match the airline limit.
    const rolling = resolveProduct(withParts([{ kind: 'wheels', count: 4, size: 2 }]))
    near(rolling.height, 22 * IN)

    // The shell is lifted clear of the floor so the wheels touch it, rather
    // than the wheels sinking below ground.
    near(rolling.pieces[0]!.position.y, 2 * IN)
    const lowest = Math.min(
      ...rolling.pieces[0]!.parts.map((p) => rolling.pieces[0]!.position.y + p.position.y - p.size.y / 2)
    )
    near(lowest, 0)
  })

  it('raises a telescoping handle to the selected stop', () => {
    const stowed = resolveProduct(withParts([{ kind: 'handle', stops: [0, 9, 16] }]))
    const up = resolveProduct(withParts([{ kind: 'handle', stops: [0, 9, 16] }]), 'up')
    near(stowed.pieces[0]!.parts[0]!.size.y, 0)
    near(up.pieces[0]!.parts[0]!.size.y, 16 * IN)
    // An extended handle makes the product taller.
    expect(up.height).toBeGreaterThan(stowed.height)
  })

  it('clamps a handle stop index instead of throwing', () => {
    const preset = withParts([{ kind: 'handle', stops: [0, 9] }])
    preset.states = [{ id: 'silly', label: 'Silly', handleStop: 99 }]
    preset.defaultState = 'silly'
    near(resolveProduct(preset).pieces[0]!.parts[0]!.size.y, 9 * IN)
  })

  it('stacks a cap on top and counts it in the height', () => {
    const r = resolveProduct(
      minimal({
        pieces: [
          { archetype: 'taperedTube', width: 0.8, height: 2, parts: [{ kind: 'cap', size: 0.85, depth: 1.4 }] }
        ]
      })
    )
    near(r.height, 3.4 * IN)
  })
})

describe('state lookup', () => {
  it('falls back to the default, then the first, then a synthetic state', () => {
    const p = minimal({
      states: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' }
      ],
      defaultState: 'b'
    })
    expect(findState(p, 'a').id).toBe('a')
    expect(findState(p, 'nope').id).toBe('b')
    expect(findState(p).id).toBe('b')
    expect(findState(minimal()).id).toBe('default')
  })

  it('swaps in the expanded depth only when the state asks', () => {
    const p = minimal({
      pieces: [{ archetype: 'roundedBox', width: 14, height: 20, depth: 8, expandedDepth: 10.5 }],
      states: [
        { id: 'normal', label: 'Normal' },
        { id: 'big', label: 'Big', expand: true }
      ],
      defaultState: 'normal'
    })
    near(resolveProduct(p).pieces[0]!.size.z, 8 * IN)
    near(resolveProduct(p, 'big').pieces[0]!.size.z, 10.5 * IN)
  })
})

describe('validation and project overrides', () => {
  it('rejects presets that would render nothing', () => {
    expect(isValidPreset(minimal())).toBe(true)
    expect(isValidPreset(null)).toBe(false)
    expect(isValidPreset({ ...minimal(), pieces: [] })).toBe(false)
    expect(isValidPreset({ ...minimal(), unit: 'furlongs' })).toBe(false)
    expect(isValidPreset({ ...minimal(), pieces: [{ archetype: 'blob', width: 1, height: 1 }] })).toBe(false)
    expect(isValidPreset({ ...minimal(), pieces: [{ archetype: 'roundedBox', width: 0, height: 1 }] })).toBe(false)
  })

  it('survives malformed JSON without throwing', () => {
    expect(parseProductFile('{ not json')).toEqual([])
    expect(parseProductFile('[]')).toEqual([])
    expect(parseProductFile('{"id":"x"}')).toEqual([])
  })

  it('accepts a single object or an array', () => {
    expect(parseProductFile(JSON.stringify(minimal()))).toHaveLength(1)
    expect(parseProductFile(JSON.stringify([minimal(), minimal({ id: 'test.two' })]))).toHaveLength(2)
  })

  it('lets a project preset replace a built-in of the same id', () => {
    const builtinId = builtinProducts()[0]!.id
    try {
      setProjectProducts([minimal({ id: builtinId, name: 'Overridden' })])
      expect(getProduct(builtinId)!.name).toBe('Overridden')
      expect(allProducts().filter((p) => p.id === builtinId)).toHaveLength(1)
    } finally {
      clearProjectProducts()
    }
    expect(getProduct(builtinId)!.name).not.toBe('Overridden')
  })

  it('returns products in a stable order so exports stay deterministic', () => {
    expect(allProducts().map((p) => p.id)).toEqual([...allProducts().map((p) => p.id)].sort())
  })
})

describe('shipped presets', () => {
  it('ships the five categories the pilot needs', () => {
    const ids = builtinProducts().map((p) => p.id)
    expect(ids).toContain('biaggi.runway-carry-on')
    expect(ids).toContain('biaggi.zipcube-carry-on')
    expect(ids).toContain('biaggi.zipcube-mini')
    expect(ids).toContain('generic.cosmetic-compact')
    expect(ids).toContain('generic.lipstick-tube')
    expect(ids).toContain('generic.bottle-warmer')
  })

  it('every shipped preset is valid and cites a source', () => {
    for (const p of builtinProducts()) {
      expect(isValidPreset(p), p.id).toBe(true)
      expect(p.source, p.id).toBeTruthy()
    }
  })

  // biaggi.com/products/runway-hardside-hybrid-carry-on, pulled 2026-09-22.
  it('matches the Runway spec sheet: 22 x 14 x 8, expanding to 10.5', () => {
    const p = getProduct('biaggi.runway-carry-on')!
    const closed = resolveProduct(p, 'closed')
    near(closed.height, 22 * IN, 1e-6)
    near(closed.bounds.width, 14 * IN, 1e-6)
    near(closed.bounds.depth, 8 * IN, 1e-6)
    near(resolveProduct(p, 'expanded').bounds.depth, 10.5 * IN, 1e-6)
  })

  it('gives the Runway all four states the pilot shot list needs', () => {
    const p = getProduct('biaggi.runway-carry-on')!
    const ids = (p.states ?? []).map((s) => s.id)
    for (const want of ['closed', 'open', 'topFolded', 'expanded']) expect(ids).toContain(want)
    expect(resolveProduct(p, 'open').pieces[0]!.door!.angle).not.toBe(0)
    expect(resolveProduct(p, 'topFolded').pieces[0]!.door!.fold!.angle).not.toBe(0)
    // The laptop flap folds while the panel itself stays shut.
    expect(resolveProduct(p, 'topFolded').pieces[0]!.door!.angle).toBe(0)
  })

  // biaggi.com/products/copy-of-zipcubes-3-pack-carry-on-size and
  // /zipcubes-mini-cube-duo, pulled 2026-09-22.
  it('matches the Zipcube spec sheets', () => {
    const big = resolveProduct(getProduct('biaggi.zipcube-carry-on')!)
    near(big.bounds.width, 13.5 * IN, 1e-6)
    near(big.height, 3 * IN, 1e-6)
    near(big.bounds.depth, 9.5 * IN, 1e-6)
    const mini = resolveProduct(getProduct('biaggi.zipcube-mini')!)
    near(mini.bounds.width, 7 * IN, 1e-6)
    near(mini.height, 4 * IN, 1e-6)
  })

  it('fits carry-on Zipcubes inside the open Runway, which is the promo shot', () => {
    const bag = resolveProduct(getProduct('biaggi.runway-carry-on')!, 'open')
    const cube = resolveProduct(getProduct('biaggi.zipcube-carry-on')!)
    expect(cube.bounds.width).toBeLessThan(bag.bounds.width)
    expect(cube.bounds.depth).toBeLessThan(bag.height)
  })

  it('spans the required scale range, roughly 1 inch to 30 inches', () => {
    const heights = builtinProducts().map((p) => resolveProduct(p).height)
    expect(Math.min(...heights)).toBeLessThan(4 * IN)
    expect(Math.max(...heights)).toBeGreaterThan(20 * IN)
  })
})

describe('catalog integration', () => {
  it('namespaces product asset ids', () => {
    expect(productAssetId('a.b')).toBe('product.a.b')
    expect(isProductAssetId('product.a.b')).toBe(true)
    expect(isProductAssetId('person.man')).toBe(false)
    expect(presetIdFromAssetId('product.a.b')).toBe('a.b')
  })

  it('gives auto-framing the real product size, not the person-scale fallback', () => {
    const spec = assetSpec(productAssetId('generic.lipstick-tube'))
    expect(spec.height).toBeLessThan(0.1)
    expect(spec.promptNoun).toBe('a lipstick tube')
    // The fallback would have claimed 1.7 m.
    expect(assetSpec('product.does-not-exist').height).toBe(1.7)
  })

  it('lists every product as a placeable asset', () => {
    const ids = placeableAssets().map((a) => a.id)
    for (const p of builtinProducts()) expect(ids).toContain(productAssetId(p.id))
  })
})
