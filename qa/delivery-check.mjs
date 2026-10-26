import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { once } from 'node:events'

const distribution = resolve(process.env.SOUND_QA_DIST ?? 'build/sound-studio-qa/sound-20261023-a7/distribution')
assert.ok(distribution.startsWith(resolve('build/sound-studio-qa') + '\\'))
const release = join(distribution, 'sound-studio-release'), profile = join(distribution, 'sound-studio-profile')
const songPath = 'src/audio/Theme.dlmusic', song = join(distribution, 'examples/LPK25-session', songPath)
const { chromium } = await import(pathToFileURL('C:/Users/ozlig/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs').href)
const host = spawn(join(distribution, 'runtime/bin/java.exe'), ['-Djava.awt.headless=true', '-Dfile.encoding=UTF-8', `-Duser.home=${profile}`, '--enable-native-access=ALL-UNNAMED', '-cp', join(distribution, 'lib/*'), 'devline.desktop.MainKt', '--browser-ui', '--home', distribution, '--open-file', song], { windowsHide: true, env: { ...process.env, LOCALAPPDATA: join(distribution, 'sound-studio-cache') }, stdio: ['ignore', 'pipe', 'pipe'] })
const ended = once(host, 'exit'); let log = '', browser, page
const errors = []
host.stderr.on('data', b => { log += b.toString() })
async function rpc(method, params = {}) { return page.evaluate(({ method, params }) => new Promise((resolve, reject) => window.cefQuery({ request: JSON.stringify({ id: 'sound-delivery', method, params }), onSuccess: raw => { const r = JSON.parse(raw); r.error ? reject(Error(JSON.stringify(r.error))) : resolve(r.result) }, onFailure: (_, message) => reject(Error(message)) })), { method, params }) }
try {
  const url = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Startup timeout: ' + log)), 30000); host.stdout.on('data', b => { log += b.toString(); const m = /DevLine browser development mode: (http:\/\/127\.0\.0\.1:\d+\/)/.exec(log); if (m) { clearTimeout(timer); resolve(m[1]) } }); host.once('exit', code => { clearTimeout(timer); reject(Error('Host exited ' + code + log)) }) })
  browser = await chromium.launch({ headless: true, executablePath: 'C:/Users/ozlig/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe' })
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, locale: 'ru-RU' }); page.setDefaultTimeout(30000)
  page.on('pageerror', e => errors.push(String(e))); await page.goto(url)
  await page.locator('iframe[title="Музыкальная студия"]').waitFor()
  const frame = page.frames().find(f => f !== page.mainFrame()); assert.ok(frame)
  await frame.locator('.studio-note').first().waitFor()
  assert.ok(await frame.getByRole('combobox', { name: 'Паттерн', exact: true }).textContent().then(v => v.includes('Мелодия LPK25')))
  const sdk = (method, args = {}) => frame.evaluate(({ method, args }) => window.devline.call(method, args), { method, args })
  const session = (await sdk('open', { path: songPath })).session
  let initialized = false
  for (let i = 0; i < 100; i++) { if ((await sdk('poll', { session })).latencyMs > 0) { initialized = true; break } await page.waitForTimeout(100) }
  assert.ok(initialized, 'Initial settings and audio device configuration completed')
  await frame.getByRole('button', { name: 'Экспорт', exact: true }).click()
  await frame.getByRole('checkbox', { name: 'Заменить готовый экспорт', exact: true }).check()
  await frame.getByRole('button', { name: 'Экспортировать в проект', exact: true }).click()
  await frame.getByText('Готово', { exact: false }).waitFor()
  const source = await readFile(song), document = JSON.parse(source)
  assert.equal(document.patterns[0].notes.length, 146); assert.equal(document.loop.enabled, false)
  const receipt = JSON.parse(await readFile(song.replace(/\.dlmusic$/i, '.dlassets') + '/render.json', 'utf8').catch(() => readFile(song + '.assets/render.json', 'utf8')))
  assert.equal(receipt.sourceHash, createHash('sha256').update(source).digest('hex'))
  const wav = await readFile(song.replace('.dlmusic', '.wav')); assert.equal(wav.toString('ascii', 0, 4), 'RIFF'); assert.ok(wav.length > 8_000_000)
  assert.deepEqual(errors, [])
  await page.screenshot({ path: join(release, 'studio-ready.png'), animations: 'disabled' })
  await writeFile(join(release, 'delivery-proof.json'), JSON.stringify({ bundledJava: true, isolatedProfile: true, externalFileOpensStudio: true, selectedPhysicalMelody: true, notes: 146, fullSongWithoutShortLoop: true, renderBytes: wav.length, sourceHash: receipt.sourceHash, errors }, null, 2))
  console.log('SOUND_STUDIO_BUNDLED_DELIVERY_READY_PASS')
} finally {
  if (page && !page.isClosed()) await page.screenshot({ path: join(release, 'delivery-final.png'), animations: 'disabled' }).catch(() => {})
  if (page && !page.isClosed()) for (const frame of page.frames().filter(f => f !== page.mainFrame())) { try { await rpc('ide.extensions.webview.close', { session: new URL(frame.url()).pathname.slice(1) }) } catch {} }
  await page?.close(); if (host.exitCode === null) host.kill(); await ended; await browser?.close()
  await writeFile(join(release, 'delivery-host.log'), log)
}
