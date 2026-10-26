import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function prepareEngineRecovery({ page, frame, sdk, session, source, replaceDocument, waitForSource, fixture }) {
  assert.match(process.env.DEVLINE_NATIVE_QA_DESKTOP ?? '', /^DevLine-QA-/)
  const scan = await sdk('plugins', { session, action: 'scan', directories: ['C:/Program Files/Common Files/VST3/Serum2.vst3'] })
  for (let i = 0; i < 100; i++) {
    const job = await sdk('job', { session, id: scan.id })
    if (job.status === 'completed') break
    assert.notEqual(job.status, 'failed', JSON.stringify(job))
    await page.waitForTimeout(100)
  }
  const plugin = (await sdk('plugins', { session })).plugins.find(plugin => /serum/i.test(plugin.name))
  assert.ok(plugin)
  const song = JSON.parse((await source()).text)
  song.tracks[0].instrument = { kind: 'vst3', waveform: 'sine', plugin: plugin.id, parameters: {} }
  await replaceDocument(song)
  await frame.getByRole('button', { name: 'Параметры', exact: true }).waitFor()
  await page.locator('.editor-toolbar__save').click()
  const saved = JSON.parse((await waitForSource((doc, state) => !state.dirty && !!doc.tracks[0].instrument.state)).text)
  const statePath = saved.tracks[0].instrument.state, stateBytes = await readFile(join(fixture, statePath))
  const name = frame.locator('.studio-property-grid').getByRole('textbox', { name: 'Имя', exact: true }).first()
  await name.fill('Unsaved before engine crash')
  await waitForSource(doc => doc.tracks[0].name === 'Unsaved before engine crash')
  return { statePath, stateBytes, notes: saved.patterns[0].notes }
}

export async function saveEngineRecovery({ page, frame, source, waitForSource, fixture, output, evidence, recovery }) {
  await page.locator('.editor-toolbar__save').click()
  const current = JSON.parse((await waitForSource((doc, state) => !state.dirty && doc.tracks[0].name === 'Unsaved before engine crash')).text)
  const disk = JSON.parse(await readFile(join(fixture, 'src/audio/Theme.dlmusic'), 'utf8'))
  assert.deepEqual(disk, current)
  assert.deepEqual(disk.patterns[0].notes, recovery.notes)
  assert.equal(disk.tracks[0].instrument.state, recovery.statePath)
  assert.deepEqual(await readFile(join(fixture, recovery.statePath)), recovery.stateBytes)
  const name = frame.locator('.studio-property-grid').getByRole('textbox', { name: 'Имя', exact: true }).first()
  await name.fill('Save and close after engine crash')
  await waitForSource(doc => doc.tracks[0].name === 'Save and close after engine crash')
  const tab = page.locator('.editor-tab').filter({ has: page.locator('.tab-select[data-path="src/audio/Theme.dlmusic"]') })
  await tab.locator('.tab-close').click()
  const prompt = page.getByRole('dialog', { name: 'Несохранённые изменения', exact: true })
  await prompt.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await tab.waitFor({ state: 'detached' })
  assert.equal(JSON.parse(await readFile(join(fixture, 'src/audio/Theme.dlmusic'), 'utf8')).tracks[0].name, 'Save and close after engine crash')
  await page.screenshot({ path: join(output, 'saved-and-closed-after-crash.png'), animations: 'disabled' })
  await page.locator('.tree-row[data-path="src/audio/Theme.dlmusic"]').dblclick()
  const reopened = page.locator('iframe[title="Музыкальная студия"]').contentFrame()
  await reopened.locator('.studio-note').first().waitFor()
  await page.locator('[data-document-status="audio-format"]').waitFor()
  evidence.engineCrashSaveAndClose = { realVst: true, documentSaved: true, previousStateIntact: true, notesIntact: true, closeWithSave: true, reopenFreshEngine: true }
}
