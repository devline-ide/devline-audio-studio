import assert from 'node:assert/strict'
import { mkdir, copyFile, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'

export async function musicAssetRename({ page, frame, sdk, source, replaceDocument, rpc, fixture, output, evidence }) {
  const project = join(fixture, 'Audio.dlproject')
  const originalPath = 'src/audio/Theme.dlmusic'
  const oldDirectory = 'src/audio/Theme.dlassets'
  await access(join(fixture, oldDirectory, 'render.json'))
  await mkdir(join(fixture, oldDirectory), { recursive: true })
  await copyFile(join(fixture, 'src/audio/Theme.wav'), join(fixture, oldDirectory, 'tone.wav'))
  const song = JSON.parse((await source()).text)
  song.tracks[0].instrument = { kind: 'sampler', asset: oldDirectory + '/tone.wav', waveform: 'sine', parameters: {} }
  await replaceDocument(song)
  // Leave a real unsaved score edit. Explorer rename must use the workspace Save path first.
  await frame.locator('.studio-property-grid').getByRole('textbox', { name: 'Имя', exact: true }).first().fill('Unsaved before rename')
  const notes = song.patterns[0].notes
  async function readDocument() {
    const first = await frame.evaluate(() => window.devline.call('document', { action: 'read' }))
    let text = first.text
    for (let offset = text.length; offset < first.length;) {
      const part = await frame.evaluate(offset => window.devline.call('document', { action: 'read', offset }), offset)
      assert.equal(part.revision, first.revision); text += part.text; offset = text.length
    }
    return JSON.parse(text)
  }
  async function rename(from, name) {
    const oldFrame = frame
    await page.locator(`.tree-row[data-path="${from}"]`).click()
    await page.keyboard.press('F2')
    const dialog = page.getByRole('dialog', { name: 'Переименовать', exact: true })
    await dialog.getByRole('textbox').fill(name)
    const submit = dialog.getByRole('button', { name: 'Переименовать', exact: true })
    await submit.waitFor(); await page.waitForFunction(() => !document.querySelector('[role="dialog"] button[type="submit"]')?.disabled)
    await submit.click()
    await dialog.waitFor({ state: 'detached' })
    const path = from.split('/').slice(0, -1).concat(name).join('/')
    await page.locator(`.tab-select[data-path="${path}"]`).waitFor()
    await page.waitForFunction(old => !document.querySelector(`iframe[src="${old}"]`), oldFrame.url())
    await page.locator('iframe[title="Музыкальная студия"]').waitFor()
    frame = await (await page.locator('iframe[title="Музыкальная студия"]').elementHandle()).contentFrame()
    assert.ok(frame)
    await frame.locator('.studio-note').first().waitFor()
    await page.locator('[data-document-status="audio-format"]').waitFor()
    return path
  }
  const renamedPath = await rename(originalPath, 'Renamed.dlmusic')
  const renamedDirectory = 'src/audio/Renamed.dlassets'
  const disk = JSON.parse(await readFile(join(fixture, renamedPath), 'utf8'))
  assert.equal(disk.tracks[0].name, 'Unsaved before rename')
  assert.equal(disk.tracks[0].instrument.asset, renamedDirectory + '/tone.wav')
  assert.deepEqual(disk.patterns[0].notes, notes)
  assert.deepEqual(await readFile(join(fixture, renamedDirectory, 'tone.wav')), await readFile(join(fixture, 'src/audio/Theme.wav')))
  assert.deepEqual(await readDocument(), disk)
  await assert.rejects(access(join(fixture, originalPath)))
  await assert.rejects(access(join(fixture, oldDirectory)))
  const assets = (await rpc('project.tree', { path: 'src/audio' })).find(entry => entry.path === renamedDirectory)
  assert.ok(assets)
  await page.locator(`.tree-row[data-path="${renamedDirectory}"]`).click({ button: 'right' })
  assert.equal(await page.getByRole('menuitem', { name: 'Переименовать', exact: true }).getAttribute('aria-disabled'), 'true')
  assert.equal(await page.getByRole('menuitem', { name: 'Удалить', exact: true }).getAttribute('aria-disabled'), 'true')
  await page.keyboard.press('Escape')
  await assert.rejects(rpc('project.entry.rename', { path: renamedDirectory, name: 'Broken.dlassets', expectedEntryVersion: assets.version, expectedProjectFile: project }), /MUSIC_ASSETS_OWNED/)
  await assert.rejects(rpc('project.entry.deletePlan', { path: renamedDirectory, expectedProjectFile: project }), /MUSIC_ASSETS_DELETE_OWNED/)
  await page.screenshot({ path: join(output, 'music-assets-renamed.png'), animations: 'disabled' })
  await rename(renamedPath, 'Theme.dlmusic')
  const session = (await frame.evaluate(path => window.devline.call('open', { path }), originalPath)).session
  await frame.getByRole('button', { name: 'Воспроизвести / пауза', exact: true }).click()
  const status = await frame.evaluate(session => window.devline.call('poll', { session }), session)
  assert.equal(status.playing, true)
  await frame.getByRole('button', { name: 'Стоп', exact: true }).click()
  evidence.musicAssets = { newDirectory: true, autoSaveBeforeRename: true, pairedRename: true, sampleBytesIntact: true, referencesUpdated: true, openBufferUpdated: true, renamedEditorReopened: true, notesIntact: true, directFolderRenameDisabled: true, directFolderDeleteDisabled: true, backendDeleteGuard: true, backendGuard: true, playbackAfterRename: true }
  return { frame, session }
}
