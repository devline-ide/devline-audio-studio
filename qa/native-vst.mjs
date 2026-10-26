import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createInterface } from 'node:readline'
import { once } from 'node:events'

assert.match(process.env.DEVLINE_NATIVE_QA_DESKTOP ?? '', /^DevLine-QA-/)
const base = resolve('build/sound-studio-qa'), output = resolve(process.env.SOUND_NATIVE_VST_OUTPUT ?? join(base, 'native-vst-a1')); assert.ok(output.startsWith(base + '\\') || output.startsWith(base + '/')); await mkdir(output, { recursive: false })
const binary = resolve('devline-audio-engine/build/native/bin'), run = promisify(execFile)
const plugins = []
for (const path of ['C:/Program Files/Common Files/VST3/Serum2.vst3', 'C:/Program Files/Common Files/VST3/OTT.vst3']) {
  const result = await run(join(binary, 'devline-audio-plugin-worker.exe'), ['--scan', path], { windowsHide: true, timeout: 15000 })
  const classes = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1)); assert.ok(classes.length); plugins.push(classes[0])
}
const instrument = plugins.find(p => p.instrument), effect = plugins.find(p => !p.instrument); assert.ok(instrument && effect)
const document = { masterGain: 0, tempos: [{ tick: 0, bpm: 120 }], patterns: [{ id: 'p', length: 1920, notes: [{ pitch: 60, tick: 0, duration: 1440, velocity: 100 }] }], tracks: [{ id: 'vst', kind: 'instrument', instrument: { kind: 'vst3', plugin: instrument.id, pluginPath: instrument.path, parameters: {} }, effects: [{ id: 'ott', kind: 'vst3', plugin: effect.id, pluginPath: effect.path, parameters: {}, bypass: false }], clips: [{ tick: 0, length: 1920, pattern: 'p' }], automation: [], sends: [], output: 'master' }] }
const engine = spawn(join(binary, 'devline-audio-engine.exe'), ['--root', output], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }), ended = once(engine, 'exit')
let sequence = 0, errors = ''; const pending = new Map()
engine.stderr.on('data', bytes => { errors += bytes.toString() })
createInterface({ input: engine.stdout }).on('line', line => { const value = JSON.parse(line), task = pending.get(value.id); if (task) { clearTimeout(task.timer); pending.delete(value.id); value.error ? task.reject(Error(value.error)) : task.resolve(value.result) } })
function call(method, args = {}) { return new Promise((resolve, reject) => { const id = ++sequence, timer = setTimeout(() => { pending.delete(id); reject(Error('Native RPC timeout: ' + method + errors)) }, 30000); pending.set(id, { resolve, reject, timer }); engine.stdin.write(JSON.stringify({ id, method, arguments: args }) + '\n') }) }
const control = (command, args = {}, effect = 'instrument') => call('plugin', { track: 'vst', effect, arguments: { command, ...args } })
try {
  await call('load', { document }); const status = await call('poll'); assert.ok(status.plugins.every(p => !p.failed && !p.error), JSON.stringify(status.plugins))
  await call('configure'); await call('play')
  const parameters = await control('parameters'); assert.ok(parameters.total > 0)
  assert.ok(parameters.parameters.length <= 64)
  const lastPage = await control('parameters', { offset: Math.max(0, parameters.total - 64) })
  assert.ok(lastPage.parameters.length > 0 && lastPage.parameters.length <= 64)
  const last = lastPage.parameters.at(-1)
  const found = await control('parameters', { query: String(last.id) })
  assert.ok(found.parameters.some(item => item.id === last.id), 'Search reaches parameters after first 4096')
  assert.ok((await control('parameters', { query: 'no-match-qa-unique' })).total === 0)
  const parameter = parameters.parameters.find(p => !p.readOnly && /volume|level|gain/i.test(p.name)) ?? parameters.parameters.find(p => !p.readOnly)
  assert.ok(parameter); const changed = parameter.value > .5 ? .25 : .75
  await control('editor'); await control('editor', {}, 'ott')
  await control('parameter', { id: parameter.id, value: changed }); await new Promise(r => setTimeout(r, 250))
  const statePath = join(output, 'serum.state'); await control('save', { path: statePath })
  const captured = await call('pluginStates', { directory: 'captured', only: 'vst/instrument' }); assert.equal(captured.states.length, 1)
  assert.ok(Object.keys(captured.states[0].parameters).length > 0)
  document.tracks[0].instrument.state = captured.states[0].state
  document.tracks[0].instrument.parameters = captured.states[0].parameters
  await control('adoptState', { state: captured.states[0].state })
  const reloadStarted = Date.now()
  await call('load', { document })
  const savedGraphReloadMs = Date.now() - reloadStarted
  await writeFile(join(output, 'saved-graph-reload.json'), JSON.stringify({ savedGraphReloadMs }))
  assert.ok(savedGraphReloadMs < 8000, 'Saved VST snapshot must not replay thousands of unchanged parameters')
  await control('parameter', { id: parameter.id, value: .1 }); await new Promise(r => setTimeout(r, 100)); await control('restore', { path: statePath })
  const restored = await control('parameters'); assert.ok(Math.abs(restored.parameters.find(p => p.id === parameter.id).value - changed) < .001)
  await call('stop'); await call('close'); await ended
  document.masterGain = .5; document._render = { startTick: 0, endTick: 1920, tail: .25 }
  const input = join(output, 'vst.dlmusic'), wavPath = join(output, 'vst.wav'); await writeFile(input, JSON.stringify(document))
  await run(join(binary, 'devline-audio-engine.exe'), ['--render', output, input, wavPath, 'wav', '32'], { windowsHide: true, timeout: 45000 })
  const wav = await readFile(wavPath); let at = 12, signal = 0, data = 0
  while (at + 8 < wav.length) { const size = wav.readUInt32LE(at + 4); if (wav.toString('ascii', at, at + 4) === 'data') { data = size; for (let i = at + 8; i < at + 8 + size; i += 4) signal += wav.readFloatLE(i) ** 2; break } at += 8 + size + (size & 1) }
  assert.ok(data > 100000 && signal > 1, 'Real VST3 instrument/effect produced float PCM')
  await writeFile(join(output, 'proof.json'), JSON.stringify({ plugins, nativeEditors: true, savedGraphReloadMs, parameterPagination: { total: parameters.total, lastId: last.id, searchTotal: found.total, capturedReplyBytes: Buffer.byteLength(JSON.stringify(captured)) }, parameter, changed, stateBytes: (await readFile(statePath)).length, offlinePcmEnergy: signal, errors }, null, 2))
  console.log('REAL_VST3_SERUM_OTT_EDITORS_PARAMETERS_STATE_OFFLINE_PCM_PASS')
} finally { if (engine.exitCode === null) { try { await call('close') } catch {} if (engine.exitCode === null) engine.kill(); await ended } }
