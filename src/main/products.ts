/**
 * AlchemyWorx fork addition — per-project product presets. See MODIFICATIONS.md.
 *
 * A project may carry its own `products/` folder of JSON presets. A preset
 * whose id matches a built-in replaces it, which is how a client tweaks a
 * shipped product without forking the app.
 *
 * This layer only reads text. Parsing, validation and geometry all live in
 * the pure engine (`src/engine/products.ts`) so they stay unit-testable.
 */

import { ipcMain } from 'electron'
import { readdir, readFile } from 'fs/promises'
import { join, resolve, sep } from 'path'

/** Ignore anything that is not a plain .json file directly in the folder. */
const isPresetFile = (name: string): boolean => name.toLowerCase().endsWith('.json')

export function registerProductsIpc(): void {
  ipcMain.handle('products:loadProject', async (_e, folder: string): Promise<string[]> => {
    if (typeof folder !== 'string' || !folder) return []
    const dir = join(folder, 'products')
    let names: string[]
    try {
      names = (await readdir(dir)).filter(isPresetFile).sort()
    } catch {
      // No products/ folder is the normal case, not an error.
      return []
    }
    const root = resolve(dir)
    const out: string[] = []
    for (const name of names) {
      const path = resolve(dir, name)
      // A symlink or a crafted name must not read outside the project.
      if (path !== root && !path.startsWith(root + sep)) continue
      try {
        out.push(await readFile(path, 'utf8'))
      } catch {
        // Skip an unreadable file rather than failing the whole project open.
      }
    }
    return out
  })
}
