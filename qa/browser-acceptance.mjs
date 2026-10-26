import assert from 'node:assert/strict'
import { studioUx } from './browser-studio-ux.mjs'
import { musicAssetRename } from './browser-music-assets.mjs'
import { documentLauncher } from './browser-document-launcher.mjs'
import { bundledPanels, bundledCreate, bundledFailure } from './browser-bundled-panels.mjs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const base = resolve('build/sound-studio-qa'), distribution = resolve(process.env.SOUND_QA_DIST ?? join(base, 'sound-20261023-a7/distribution'))
const output = resolve(process.env.SOUND_QA_OUTPUT ?? join(base, 'browser-a1'))
assert.ok(output.startsWith(base + '\\') || output.startsWith(base + '/'))
await mkdir(output, { recursive: false })
const fixture = join(output, 'project'), profile = join(output, 'profile'), descriptor = join(fixture, 'Audio.dlproject')
await mkdir(join(fixture, 'src/audio'), { recursive: true }); await mkdir(join(profile, '.devline'), { recursive: true })
await writeFile(join(profile, '.devline/preferences.properties'), 'locale=ru\ntheme=dark\nsplashEnabled=false\nnotificationSound=' + (process.env.SOUND_QA_BUNDLED === '1') + '\n')
await writeFile(descriptor, JSON.stringify({ schemaVersion: 1, name: 'Sound Studio QA', language: 'php', sourceFormat: 'dlproject', sourceFingerprint: 'owned', forms: [], dependencies: [], assets: [], controllerPolicy: 'native' }))
const songPath = 'src/audio/Theme.dlmusic', songFile = join(fixture, songPath)
const song = { schemaVersion: 1, ppq: 960, name: 'Theme QA', masterGain: 0, tempos: [{ tick: 0, bpm: 120, numerator: 4, denominator: 4 }],
  patterns: [{ id: 'piano', name: 'Lead', length: 3840, notes: [60, 64, 67, 72].map((pitch, i) => ({ id: `n${i}`, tick: i * 480, duration: 360, pitch, velocity: 90 + i * 5, channel: 0 })), controllers: [], events: [] }],
  tracks: [{ id: 'lead', name: 'Lead synth', kind: 'instrument', instrument: { kind: 'synth', waveform: 'sine', parameters: {} }, clips: [{ id: 'c1', tick: 0, length: 7680, pattern: 'piano', sourceFrame: 0, gain: 1, fadeIn: 0, fadeOut: 0 }], gain: .7, pan: 0, muted: false, solo: false, output: 'master', sends: [], effects: [], automation: [] }],
  loop: { enabled: true, start: 0, end: 7680 }, markers: [] }
await writeFile(songFile, JSON.stringify(song, null, 2)); await writeFile(join(fixture, 'unrelated.txt'), 'unrelated bytes\r\n')
const { chromium } = await import(pathToFileURL('C:/Users/ozlig/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
let host, exited, browser, page, log = '', frame
const errors = [], consoleErrors = [], evidence = {}
async function rpc(method, params = {}) { return page.evaluate(({ method, params }) => new Promise((resolve, reject) => window.cefQuery({ request: JSON.stringify({ id: 'sound-qa', method, params }), onSuccess: raw => { const r = JSON.parse(raw); r.error ? reject(Error(JSON.stringify(r.error))) : resolve(r.result) }, onFailure: (_, message) => reject(Error(message)) })), { method, params }) }
async function start() {
  const java = join(distribution, 'runtime/bin/java.exe')
  host = spawn(java, ['-Djava.awt.headless=true', '-Dfile.encoding=UTF-8', `-Duser.home=${profile}`, '--enable-native-access=ALL-UNNAMED', '-cp', join(distribution, 'lib/*'), 'devline.desktop.MainKt', '--browser-ui', '--home', distribution, descriptor], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  exited = once(host, 'exit'); host.stderr.on('data', b => { log += b.toString() })
  const url = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Host startup timeout: ' + log)), 30000); let current = ''; host.stdout.on('data', b => { current += b.toString(); log += b.toString(); const match = /DevLine browser development mode: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(current); if (match) { clearTimeout(timer); resolve(match[1]) } }); host.once('exit', code => { clearTimeout(timer); reject(Error('Host exited ' + code + log)) }) })
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'ru-RU' }); page.setDefaultTimeout(15000)
  await page.addInitScript(() => { window.qaSoundStarts = 0; const start = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function(...args) { window.qaSoundStarts++; return start.apply(this, args) } })
  page.on('pageerror', cause => errors.push(String(cause)))
  page.on('console', entry => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
  await page.goto(url); await page.locator('.project-root').waitFor()
  if (process.env.SOUND_QA_LAUNCHER === '1') await page.evaluate(() => {
    window.qaRpcFailures = []
    const original = window.cefQuery
    window.cefQuery = args => original({ ...args, onSuccess: raw => {
      try { const reply = JSON.parse(raw); if (reply.error) window.qaRpcFailures.push({ method: JSON.parse(args.request).method, error: reply.error }) } catch {}
      args.onSuccess(raw)
    } })
  })
}
async function stop() { await page?.close(); if (host?.exitCode === null) host.kill(); if (exited) await exited }
async function sdk(method, args = {}) { return frame.evaluate(({ method, args }) => window.devline.call(method, args), { method, args }) }
async function openSong() {
  await page.locator('.tree-row[data-path="src"]').click()
  await page.locator('.tree-row[data-path="src/audio"]').click()
  await page.locator(`.tree-row[data-path="${songPath}"]`).dblclick()
  await page.locator('iframe[title="Музыкальная студия"]').waitFor()
  frame = page.frames().find(candidate => candidate.url().includes('/extensions/')) ?? page.frames().find(candidate => candidate !== page.mainFrame())
  assert.ok(frame, 'Actual extension iframe')
  await frame.locator('.studio-note').first().waitFor()
  await frame.getByRole('button', { name: 'Воспроизвести / пауза', exact: true }).waitFor()
}
async function source() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const first = await sdk('document', { action: 'read' })
    let text = first.text, changed = false
    for (let offset = text.length; offset < first.length;) {
      const part = await sdk('document', { action: 'read', offset })
      if (part.revision !== first.revision) { changed = true; break }
      assert.ok(part.text, 'Chunked document read makes progress')
      text += part.text; offset = text.length
    }
    if (!changed) return { ...first, text }
    await page.waitForTimeout(20)
  }
  throw Error('Document kept changing during chunked QA read')
}
async function waitForSource(predicate) { for (let i = 0; i < 60; i++) { const current = await source(); if (predicate(JSON.parse(current.text), current)) return current; await page.waitForTimeout(100) } throw Error('Document state timeout') }
async function replaceDocument(value) {
  const current = await source(), text = JSON.stringify(value, null, 2) + '\n'
  await sdk('document', { action: 'begin', revision: current.revision })
  for (let offset = 0; offset < text.length; offset += 3500) await sdk('document', { action: 'chunk', text: text.slice(offset, offset + 3500) })
  await sdk('document', { action: 'commit' })
  await page.waitForTimeout(1200)
}
async function extendedBeforeExport(session) {
  assert.ok((await page.locator('iframe[title="Музыкальная студия"]').boundingBox()).width > 1000, 'Document fills the editor area')
  const velocity = frame.getByRole('slider', { name: 'Velocity', exact: true }), before = await source(), original = JSON.parse(before.text).patterns[0].notes[0].velocity
  const box = await velocity.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width * .8, box.y + box.height / 2, { steps: 8 }); await page.mouse.up()
  const moved = await waitForSource(doc => doc.patterns[0].notes[0].velocity !== original)
  assert.equal(moved.revision, before.revision + 1, 'One velocity drag is one document edit')
  await sdk('document', { action: 'undo' }); await waitForSource(doc => doc.patterns[0].notes[0].velocity === original)
  const piano = frame.locator('[data-tab-id="piano"]').first()
  await piano.press('Control+Shift+ArrowLeft')
  await frame.locator('.ui-tool-dock__group--left [data-tab-id="piano"], [data-dock-edge="left"] [data-tab-id="piano"]').waitFor()
  await frame.locator('[data-tab-id="piano"]').first().press('Control+Shift+ArrowDown')
  await frame.locator('[data-tab-id="piano"]').first().click({ button: 'right' }); await frame.getByRole('menuitem', { name: 'Закрыть', exact: true }).click()
  const companion = page.locator('.ai-companion__button')
  if (await companion.isVisible()) { const box = await companion.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 120, { steps: 6 }); await page.mouse.up() }
  await frame.locator('.studio-panel-restores').getByRole('button', { name: 'Piano roll', exact: true }).click()
  await frame.locator('.studio-note').first().waitFor()
  evidence.dockMoveHideRestore = true
  const count = JSON.parse((await source()).text).patterns[0].notes.length
  await frame.getByRole('button', { name: 'Записать MIDI', exact: true }).click()
  await sdk('engine', { session, command: 'midi', arguments: { status: 144, data1: 65, data2: 95 } }); await page.waitForTimeout(200)
  await sdk('engine', { session, command: 'midi', arguments: { status: 128, data1: 65, data2: 0 } })
  await frame.getByRole('button', { name: 'Стоп', exact: true }).click()
  const recorded = await waitForSource(doc => doc.patterns[0].notes.length === count + 1)
  assert.ok(JSON.parse(recorded.text).patterns[0].notes.some(note => note.pitch === 65 && note.velocity === 95 && note.duration > 0))
  evidence.uiMidiRecord = true
  const local = JSON.parse(recorded.text); local.name = 'Local unsaved draft'; await replaceDocument(local)
  const disk = structuredClone(local); disk.name = 'External disk version'; await writeFile(songFile, JSON.stringify(disk, null, 2))
  await assert.rejects(sdk('document', { action: 'save' }))
  assert.equal(JSON.parse(await readFile(songFile, 'utf8')).name, 'External disk version')
  assert.equal(JSON.parse((await source()).text).name, 'Local unsaved draft')
  await page.getByRole('button', { name: 'Файл', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Сравнить несохранённый файл с диском/ }).click()
  const conflict = page.getByRole('dialog', { name: 'Конфликт сохранения', exact: true }); await conflict.waitFor()
  await conflict.getByRole('button', { name: 'Сохранить результат', exact: true }).click(); await conflict.waitFor({ state: 'hidden' })
  assert.equal(JSON.parse(await readFile(songFile, 'utf8')).name, 'Local unsaved draft')
  evidence.saveConflictPreservesBothVersions = true
}
async function extendedAfterExport() {
  await mkdir(join(fixture, 'src/app/levels'), { recursive: true })
  const level = JSON.parse(await readFile('build/sound-studio-qa/game-a1/hidden-authoring-src/app/levels/Audio.dllevel', 'utf8'))
  level.assets = []; level.layers[0].entities[0].properties = {}
  await writeFile(join(fixture, 'src/app/levels/Audio.dllevel'), JSON.stringify(level, null, 2))
  const targets = await sdk('document', { action: 'audioTargets', path: 'src/app/levels/Audio.dllevel' })
  await sdk('document', { action: 'assignAudio', path: 'src/app/levels/Audio.dllevel', revision: targets.revision, entity: targets.entities[0].id, event: 'ready', asset: 'src/audio/Theme.wav', loop: true })
  assert.equal(JSON.parse(await readFile(join(fixture, 'src/app/levels/Audio.dllevel'), 'utf8')).assets.length, 0, 'Assignment stays in workspace draft')
  await sdk('document', { action: 'save' })
  const assigned = JSON.parse(await readFile(join(fixture, 'src/app/levels/Audio.dllevel'), 'utf8'))
  assert.equal(assigned.layers[0].entities[0].properties.devlineAudio.events.ready.loop, true)
  assert.equal(assigned.assets[0].path, 'audio/Theme.wav')
  evidence.gameEventAssignmentThroughWorkspace = true
  const snapshot = await source()
  await sdk('document', { action: 'saveAs', path: 'src/audio/Theme-copy.dlmusic', revision: snapshot.revision })
  assert.deepEqual(JSON.parse(await readFile(join(fixture, 'src/audio/Theme-copy.dlmusic'), 'utf8')), JSON.parse(snapshot.text))
  await page.locator(`.tab-select[data-path="${songPath}"]`).click()
  evidence.workspaceSaveAs = true
  await page.getByRole('button', { name: 'Файл', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Настройки/ }).first().click()
  const settings = page.getByRole('dialog', { name: 'Настройки', exact: true }); await settings.waitFor()
  await settings.locator('#settings-appearance-tab').click()
  await settings.getByRole('combobox', { name: 'Язык', exact: true }).click()
  await page.getByRole('option', { name: 'English', exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings', exact: true }).getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor({ state: 'hidden' })
  await frame.getByRole('button', { name: 'Arrangement', exact: true }).waitFor()
  for (const width of [1600, 1000]) { await page.setViewportSize({ width, height: 900 }); await page.screenshot({ path: join(output, `studio-en-${width}.png`), animations: 'disabled' }) }
  evidence.englishAndCompactViewport = true
}
async function hardware(session) {
  const devices = evidence.devices, midi = devices.midi.find(d => /lpk25/i.test(d.name)), mic = devices.inputs.find(d => /hyperx/i.test(d.name))
  assert.ok(midi && mic, 'Physical LPK25 and HyperX are present')
  const live = JSON.parse((await source()).text); live.masterGain = .15; live.tracks[0].clips = []
  await replaceDocument(live)
  const actual = await sdk('engine', { session, command: 'configure', arguments: { sampleRate: 48000, blockSize: 256, capture: true, input: mic.index, output: -1, exclusive: false } })
  await sdk('engine', { session, command: 'monitor', arguments: { enabled: false } })
  await sdk('engine', { session, command: 'midiSelectName', arguments: { name: midi.name } })
  await writeFile(join(output, 'hardware-ready.json'), JSON.stringify({ midi, mic, actual }))
  await page.screenshot({ path: join(output, 'ready.png'), animations: 'disabled' })
  console.log('HARDWARE_READY ' + output)
  const deadline = Date.now() + 10 * 60 * 1000
  while (true) { try { await readFile(join(output, 'start-hardware')); break } catch {} if (Date.now() > deadline) throw Error('Hardware start timeout'); await page.waitForTimeout(500) }
  await sdk('take', { session, action: 'start', countIn: false })
  const recording = await sdk('record', { session, action: 'start', channels: 1 })
  console.log('HARDWARE_RECORDING_STARTED')
  let captured, disconnected = false, reconnected = false, inputPeak = 0, instrumentPeak = 0, dropped = 0
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(500)
    const status = await sdk('poll', { session })
    disconnected ||= status.midiConnected === false
    reconnected ||= disconnected && status.midiConnected === true
    inputPeak = Math.max(inputPeak, status.inputPeak); instrumentPeak = Math.max(instrumentPeak, status.meters.lead ?? 0); dropped = Math.max(dropped, status.dropped)
    if (i === 23) { captured = await sdk('record', { session, action: 'stop' }); console.log('MICROPHONE_RECORDING_FINISHED') }
  }
  const take = await sdk('take', { session, action: 'stop' })
  await sdk('engine', { session, command: 'stop' })
  const saved = JSON.parse((await source()).text), length = Math.max(3840, ...take.notes.map(note => note.tick + note.duration))
  saved.patterns.push({ id: 'physical_lpk25', name: 'LPK25 physical take', length, notes: take.notes, controllers: take.controllers, events: take.events })
  saved.tracks[0].clips = [{ id: 'physical_clip', tick: 0, length, pattern: 'physical_lpk25', sourceFrame: 0, gain: 1, fadeIn: 0, fadeOut: 0 }]
  saved.tracks.push({ ...structuredClone(saved.tracks[0]), id: 'physical_mic', name: 'HyperX physical take', kind: 'audio', clips: [{ id: 'mic_clip', tick: 0, length: Math.round(captured.frames * 1920 / captured.sampleRate), asset: recording.path, sourceFrame: 0, gain: 1, fadeIn: 0, fadeOut: 0 }] })
  await replaceDocument(saved); await sdk('document', { action: 'save' })
  const velocities = [...new Set(take.notes.map(note => note.velocity))].sort((a, b) => a - b)
  const polyphony = take.notes.some((note, index) => take.notes.slice(index + 1).some(other => note.tick < other.tick + other.duration && other.tick < note.tick + note.duration))
  evidence.hardware = { actual, notes: take.notes.length, velocities, polyphony, disconnected, reconnected, inputPeak, instrumentPeak, dropped, microphone: { ...recording, ...captured } }
  await writeFile(join(output, 'hardware-proof.json'), JSON.stringify(evidence.hardware, null, 2))
  assert.ok(take.notes.length >= 4, 'Physical MIDI notes recorded'); assert.ok(velocities.length > 1, 'Physical velocity variation'); assert.ok(polyphony, 'Physical simultaneous notes')
  assert.ok(inputPeak > .0001 && captured.frames > 48000, 'Physical microphone captured non-silent PCM'); assert.ok(instrumentPeak > .001, 'Physical MIDI produced synth PCM')
  console.log('HARDWARE_TAKE_SAVED ' + songFile)
}
try {
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/ozlig/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  await start()
  if (process.env.SOUND_QA_BUNDLED === '1') {
    const extensions = await rpc('ide.extensions.list')
    const sound = extensions.extensions.find(e => e.manifest.id === 'devline.sound-studio')
    assert.ok(sound?.enabled && !sound.restartRequired, 'Sound Studio bundled and enabled on first launch')
    evidence.bundledEnabled = true
  } else {
  const archive = resolve('devline-audio-studio/build/extension/devline-sound-studio-0.1.3.dlextension')
  const inspected = await rpc('ide.extensions.inspect', { path: archive })
  assert.equal(inspected.descriptor.apiVersion, 6)
  const installed = await rpc('ide.extensions.install', { path: archive, checksum: inspected.checksum, expectedVersion: inspected.expectedVersion })
  const applied = installed.extensions.find(e => e.manifest.id === 'devline.sound-studio')
  assert.equal(applied?.manifest.version, inspected.descriptor.extension.version)
  evidence.installApi6Archive = inspected.checksum
  if (applied.restartRequired) { await stop(); await start() }
  const extensions = await rpc('ide.extensions.list')
  await rpc('ide.extensions.setEnabled', { id: 'devline.sound-studio', enabled: true, expectedVersion: extensions.version })
  await page.reload(); await page.locator('.project-root').waitFor()
  }
  await openSong()
  if (process.env.SOUND_QA_LAUNCHER === '1') await documentLauncher({ page, source, fixture, output, evidence })
  let session = (await sdk('open', { path: songPath })).session
  evidence.devices = await sdk('engine', { session, command: 'devices' })
  if (process.env.SOUND_QA_UX === '1') await studioUx({ page, frame, sdk, source, replaceDocument, waitForSource, session, output, evidence })
  if (process.env.SOUND_QA_HARDWARE === '1') await hardware(session)
  const before = await source(), note = frame.locator('.studio-note').first(), box = await note.boundingBox()
  await note.click(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 - 13, { steps: 5 }); await page.mouse.up()
  const edited = await waitForSource((doc, state) => state.revision > before.revision && doc.patterns[0].notes[0].tick !== 0)
  evidence.noteDrag = JSON.parse(edited.text).patterns[0].notes[0]
  await sdk('document', { action: 'undo' }); await waitForSource(doc => doc.patterns[0].notes[0].tick === 0)
  await sdk('document', { action: 'redo' }); await waitForSource(doc => doc.patterns[0].notes[0].tick === evidence.noteDrag.tick)
  await sdk('document', { action: 'save' }); assert.equal(JSON.parse(await readFile(songFile, 'utf8')).patterns[0].notes[0].tick, evidence.noteDrag.tick)
  evidence.workspaceUndoRedoSave = true
  await frame.getByRole('button', { name: 'Воспроизвести / пауза', exact: true }).click()
  await page.waitForTimeout(350)
  const firstPoll = await sdk('poll', { session }); assert.equal(firstPoll.playing, true)
  await page.locator('.tree-row[data-path="unrelated.txt"]').dblclick(); await page.waitForTimeout(400)
  // Provider polling is allowed while this document view is hidden.
  const hidden = await sdk('poll', { session }); assert.equal(hidden.playing, true); assert.ok(hidden.frame > firstPoll.frame)
  await page.locator(`.tab-select[data-path="${songPath}"]`).click(); await frame.getByRole('button', { name: 'Стоп', exact: true }).click()
  evidence.hiddenDocumentKeepsEngine = true
  if (process.env.SOUND_QA_BUNDLED === '1') await bundledPanels({ page, frame, sdk, source, output, evidence })
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await frame.waitForFunction(theme => window.devline.getContext().theme === theme, theme)
    await page.screenshot({ path: join(output, `studio-${theme}.png`), animations: 'disabled' })
  }
  if (process.env.SOUND_QA_EXTENDED === '1') await extendedBeforeExport(session)
  await frame.locator('.studio-transport').getByRole('button', { name: 'Экспорт', exact: true }).click()
  await frame.getByRole('button', { name: 'Экспортировать в проект', exact: true }).click()
  await frame.locator('.studio-devices').getByText('Готово', { exact: false }).waitFor({ timeout: 30000 })
  const wav = await readFile(join(fixture, 'src/audio/Theme.wav'))
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.ok(wav.length > 100000)
  evidence.providerWavExport = { bytes: wav.length, sampleRate: wav.readUInt32LE(24) }
  if (process.env.SOUND_QA_EXTENDED === '1') await extendedAfterExport()
  assert.equal(await readFile(join(fixture, 'unrelated.txt'), 'utf8'), 'unrelated bytes\r\n')
  if (process.env.SOUND_QA_BUNDLED === '1') { await bundledFailure({ page, frame, sdk, session, source, replaceDocument, waitForSource, fixture, output, evidence, host }); await bundledCreate({ page, fixture, output, evidence }) }
  if (process.env.SOUND_QA_ASSETS === '1') ({ frame, session } = await musicAssetRename({ page, frame, sdk, source, replaceDocument, rpc, fixture, output, evidence }))
  assert.deepEqual(errors, [])
  if (process.env.SOUND_QA_BUNDLED !== '1') await sdk('engine', { session, command: 'stop' })
  await page.locator('.editor-tab').filter({ has: page.locator(`.tab-select[data-path="${songPath}"]`) }).locator('.tab-close').click()
  const closingTab = page.locator(`.tab-select[data-path="${songPath}"]`)
  const closingPrompt = page.getByRole('dialog', { name: 'Несохранённые изменения', exact: true })
  await Promise.race([closingTab.waitFor({ state: 'detached' }), closingPrompt.waitFor()])
  if (await closingPrompt.isVisible()) await closingPrompt.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await closingTab.waitFor({ state: 'detached' })
  evidence.sessionClosed = true
  await writeFile(join(output, 'proof.json'), JSON.stringify({ ...evidence, errors }, null, 2))
  console.log('SOUND_STUDIO_BROWSER_ACCEPTANCE_PASS')
} catch (cause) {
  await writeFile(join(output, 'partial-proof.json'), JSON.stringify(evidence, null, 2)); await writeFile(join(output, 'failure.txt'), cause.stack ?? String(cause)); throw cause
} finally {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'final.png'), animations: 'disabled' }).catch(() => {})
  // Close provider sessions through the actual host before terminating only this owned server.
  if (page && !page.isClosed()) for (const ownedFrame of page.frames().filter(f => f !== page.mainFrame())) { try { await rpc('ide.extensions.webview.close', { session: new URL(ownedFrame.url()).pathname.slice(1) }) } catch {} }
  await stop(); await browser?.close(); await writeFile(join(output, 'host.log'), log); await writeFile(join(output, 'errors.json'), JSON.stringify(errors, null, 2)); await writeFile(join(output, 'console-errors.json'), JSON.stringify(consoleErrors, null, 2))
}
