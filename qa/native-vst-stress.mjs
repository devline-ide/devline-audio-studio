import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

assert.match(process.env.DEVLINE_NATIVE_QA_DESKTOP ?? '', /^DevLine-QA-/)
const root = resolve('build/sound-studio-qa/vst-audio-stress-a1'); await mkdir(root, { recursive: false })
const oldProfile = resolve('build/sound-studio-qa/sound-20261023-a7/distribution/sound-studio-profile/.devline')
const installed = JSON.parse(await readFile(join(oldProfile, 'extensions/installed.json'), 'utf8'))
const old = join(oldProfile, 'extensions/objects', installed.extensions['devline.sound-studio'].checksum, 'native/windows-x64/devline-audio-engine.exe')
const makeTrack = id => ({ id, kind: 'instrument', instrument: { kind: 'synth', waveform: 'sine', parameters: {} }, clips: [], effects: [], automation: [], sends: [], output: 'master' })
const base = { masterGain: 0, tempos: [{ tick: 0, bpm: 120 }], patterns: [{ id: 'p', length: 19200, notes: [{ pitch: 69, tick: 0, duration: 19200, velocity: 100 }] }], tracks: [{ ...makeTrack('vst'), instrument: { kind: 'vst3', plugin: '56534558667350736572756D20320000', pluginPath: 'C:/Program Files/Common Files/VST3/Serum2.vst3', parameters: {} }, clips: [{ tick: 0, length: 19200, pattern: 'p' }] }] }
const results = []
for (const [label, executable] of [['before', old], ['after', resolve('devline-audio-engine/build/native/bin/devline-audio-engine.exe')]]) {
  const engine = spawn(executable, ['--root', root], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), ended = once(engine, 'exit')
  let sequence = 0, errors = ''; const pending = new Map()
  engine.stderr.on('data', bytes => { errors += bytes.toString() })
  createInterface({ input: engine.stdout }).on('line', line => { const value = JSON.parse(line), task = pending.get(value.id); if (task) { clearTimeout(task.timer); pending.delete(value.id); value.error ? task.reject(Error(value.error)) : task.resolve(value.result) } })
  engine.on('exit', code => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(Error('Audio engine exited ' + code + ': ' + errors)) } pending.clear() })
  const call = (method, args = {}) => new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('Native RPC timeout: ' + method + errors)) }, 30000); pending.set(id, { resolve, reject, timer }); engine.stdin.write(JSON.stringify({ id, method, arguments: args }) + '\n') })
  try {
    let document = structuredClone(base)
    await call('load', { document }); const actual = await call('configure', { sampleRate: 48000, blockSize: 256, capture: false, exclusive: false })
    await call('play'); const first = await call('poll'); await new Promise(resolve => setTimeout(resolve, 3000)); const last = await call('poll')
    const misses = last.plugins.reduce((sum, p) => sum + (p.misses ?? 0), 0) - first.plugins.reduce((sum, p) => sum + (p.misses ?? 0), 0)
    results.push({ label, actual, threeSecondPluginMisses: misses, processingLatencyFrames: last.processingLatencyFrames, failed: last.plugins.some(p => p.failed) })
    if (label === 'after') {
      for (let i = 0; i < 64; i++) {
        document = structuredClone(document); const id = 'synth' + i
        document.tracks.push(makeTrack(id)); if (document.tracks.length > 9) document.tracks.splice(1, 1)
        await call('load', { document }); await call('liveTrack', { id }); await call('midi', { status: 144, data1: 60 + i % 12, data2: 100 })
        await new Promise(resolve => setTimeout(resolve, 10)); await call('midi', { status: 128, data1: 60 + i % 12, data2: 0 })
        document.tracks.at(-1).instrument.kind = i % 2 ? 'sfx' : 'synth'; await call('load', { document })
      }
      const status = await call('poll'); assert.equal(status.plugins.some(p => p.failed), false)
      results.at(-1).structuralLoads = 128; results.at(-1).midiNotePairs = 64; results.at(-1).aliveAfterStress = true
    }
    await call('stop'); await call('close'); await ended
  } finally { if (engine.exitCode === null) { engine.kill(); await ended } }
}
await writeFile(join(root, 'proof.json'), JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
