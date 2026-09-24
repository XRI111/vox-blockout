#!/usr/bin/env node
// AW bring-up check: install, verify, launch the app, then alert for manual testing.
// Usage: node scripts/aw-verify.mjs [--skip-install] [--skip-smoke]
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const results = []

const run = (cmd, cmdArgs, opts = {}) =>
  spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', ...opts })

function step(name, fn) {
  console.log(`\n=== ${name} ===`)
  const started = Date.now()
  const ok = fn()
  const secs = ((Date.now() - started) / 1000).toFixed(1)
  results.push({ name, ok, secs })
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${name} (${secs}s)`)
  if (!ok) summarizeAndExit(1)
}

function summarizeAndExit(code) {
  console.log('\n--- Summary ---')
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.secs}s)`)
  process.exit(code)
}

const has = (cmd) => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0

step('Node 22+', () => {
  const major = Number(process.versions.node.split('.')[0])
  console.log(`node ${process.versions.node}`)
  return major >= 22
})

step('ffmpeg + ffprobe present', () => {
  if (has('ffmpeg') && has('ffprobe')) return true
  if (process.platform === 'darwin' && spawnSync('brew', ['--version'], { stdio: 'ignore' }).status === 0) {
    console.log('ffmpeg missing, installing with Homebrew')
    run('brew', ['install', 'ffmpeg'])
    return has('ffmpeg') && has('ffprobe')
  }
  console.log('Install ffmpeg and ensure ffmpeg and ffprobe are on PATH.')
  return false
})

if (!args.has('--skip-install')) {
  step('npm install', () => run(npm, ['install']).status === 0)
}

step('typecheck', () => run(npm, ['run', 'typecheck']).status === 0)
step('lint', () => run(npm, ['run', 'lint']).status === 0)
step('unit tests', () => run(npm, ['test']).status === 0)

if (!args.has('--skip-smoke')) {
  step('smoke (build + Playwright export, ffprobe-verified)', () => run(npm, ['run', 'smoke']).status === 0)
} else {
  step('build', () => run(npm, ['run', 'build']).status === 0)
}

step('launch app and confirm it stays up', () => {
  if (!existsSync(resolve(root, 'out/main/index.js'))) return false
  const child = spawn(npm, ['start'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
  let exited = false
  child.on('exit', () => { exited = true })
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) spawnSync('node', ['-e', 'setTimeout(()=>{},500)'])
  if (exited) return false
  globalThis.__appChild = child
  return true
})

console.log('\n--- Summary ---')
for (const r of results) console.log(`PASS  ${r.name}  (${r.secs}s)`)

const msg = 'Blockout is up. All automated checks passed. Your turn to test.'
process.stdout.write('\x07\x07\x07')
console.log(`\n*** ${msg} ***`)
console.log('Press Ctrl+C here to close the app when you are done.')
if (process.platform === 'darwin') {
  spawnSync('osascript', ['-e', `display notification "${msg}" with title "AW Previs" sound name "Glass"`])
  spawn('say', [msg], { stdio: 'ignore', detached: true }).unref()
}

const child = globalThis.__appChild
const shutdown = () => { child.kill(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
child.on('exit', () => process.exit(0))
