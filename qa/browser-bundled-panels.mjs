import { prepareEngineRecovery, saveEngineRecovery } from './browser-engine-recovery.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export async function bundledPanels({ page, frame, sdk, source, output, evidence }) {
  await page.locator('[data-document-status="audio-format"]').waitFor()
  assert.equal(await frame.locator('.studio-status').count(), 0, 'No duplicate inner status bar')
  await page.locator('.tree-row[data-path="unrelated.txt"]').dblclick()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('[data-document-status]').count(), 0, 'Music status absent on text tab')
  await page.locator('.tab-select[data-path="src/audio/Theme.dlmusic"]').click()
  await page.locator('[data-document-status="audio-format"]').waitFor()
  const properties = frame.locator('.studio-property-grid').filter({ has: frame.getByRole('textbox', { name: 'Имя', exact: true }) }).first()
  const row = properties.locator('.ui-form-properties__row').first()
  assert.ok([23,24].includes(Math.round((await row.boundingBox()).height)), 'Shared compact property row including separator')
  const separator = properties.getByRole('separator')
  const ratio = Number(await separator.getAttribute('aria-valuenow'))
  await separator.press('ArrowRight'); assert.equal(Number(await separator.getAttribute('aria-valuenow')), ratio + 1)
  await separator.press('ArrowLeft')
  const instrument = properties.getByRole('button', { name: 'Инструмент', exact: true })
  await instrument.click(); assert.equal(await properties.getByRole('combobox', { name: 'Волна', exact: true }).count(), 0)
  await instrument.click()
  await properties.getByRole('combobox', { name: 'Добавить эффект', exact: true }).click()
  await frame.getByRole('option', { name: 'Лимитер', exact: true }).click()
  const effectRow = properties.locator('.studio-effect .ui-form-properties__row').first()
  await effectRow.waitFor()
  assert.equal(await effectRow.evaluate(element => getComputedStyle(element).display), 'grid', 'Effect rows retain shared property columns')
  await sdk('document', { action: 'undo' })
  await effectRow.waitFor({ state: 'detached' })
  const buttons = frame.locator('.studio-main')
  for (const label of ['Инструмент', 'Аудиодорожка', 'Шина']) assert.ok(await buttons.getByRole('button', { name: label, exact: true }).locator('.ui-icon').count(), `Add icon: ${label}`)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await frame.waitForFunction(theme => window.devline.getContext().theme === theme, theme)
    await page.screenshot({ path: join(output, `properties-${theme}.png`), animations: 'disabled' })
  }
  await frame.locator('[data-tab-id="instruments"]').first().click()
  await frame.getByRole('button', { name: 'Добавить Синтезатор', exact: true }).waitFor()
  const before = JSON.parse((await source()).text).tracks.length
  await frame.getByRole('button', { name: 'Добавить Синтезатор', exact: true }).click()
  await page.waitForTimeout(700)
  assert.equal(JSON.parse((await source()).text).tracks.length, before + 1)
  await sdk('document', { action: 'undo' })
  await frame.getByRole('searchbox', { name: 'Найти VST3' }).fill('no-match-qa')
  await frame.getByText('Нет подходящих плагинов.', { exact: true }).waitFor()
  await frame.getByRole('searchbox', { name: 'Найти VST3' }).fill('')
  await page.screenshot({ path: join(output, 'instruments.png'), animations: 'disabled' })
  const sounds = await page.evaluate(() => window.qaSoundStarts)
  await frame.getByRole('textbox', { name: 'Путь к файлу внутри проекта', exact: true }).fill('src/audio/missing-qa.wav')
  await frame.getByRole('button', { name: /^Импортировать/ }).click()
  await page.locator('.editor-notice--error').waitFor()
  assert.equal(await frame.locator('.ui-toast').count(), 0, 'No isolated iframe error toast')
  await page.waitForFunction(before => window.qaSoundStarts > before, sounds)
  await page.locator('.notification-trigger').click()
  await page.locator('.notification-center__item').first().waitFor()
  await page.screenshot({ path: join(output, 'host-notifications.png'), animations: 'disabled' })
  evidence.normalErrorBarHistoryAndSound = true
  await page.keyboard.press('Escape')
  await frame.locator('.studio-transport').getByRole('button', { name: 'Экспорт', exact: true }).click()
  await frame.locator('.studio-devices').waitFor()
  await page.screenshot({ path: join(output, 'devices-export.png'), animations: 'disabled' })
  evidence.sharedPropertyTableAndStatus = true
}

export async function bundledFailure(context) {
  const { page, frame, sdk, session, host, output, evidence } = context
  const recovery = process.env.SOUND_QA_RECOVERY === '1' ? await prepareEngineRecovery(context) : undefined
  // Kill only the audio engine descended from this fixture's owned browser host.
  const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-Command', `$p = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${host.pid} -and $_.Name -eq 'devline-audio-engine.exe' }; if (@($p).Count -ne 1) { throw 'Expected one owned engine' }; $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Output $_.ProcessId }`], { windowsHide: true })
  assert.ok(Number(result.stdout.trim()) > 0)
  await page.locator('[data-document-status="audio-error"]').waitFor()
  await page.locator('.editor-notice--error').waitFor()
  assert.equal((await sdk('poll', { session })).playing, false)
  await page.locator('.notification-trigger').click()
  const count = await page.locator('.notification-center__item').count()
  await page.waitForTimeout(2500)
  assert.equal(await page.locator('.notification-center__item').count(), count, 'Dead engine does not spam notifications')
  await page.screenshot({ path: join(output, 'engine-stopped.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  evidence.engineFailureReportedOnce = true
  if (recovery) await saveEngineRecovery({ ...context, recovery })
}

export async function bundledCreate({ page, fixture, output, evidence }) {
  await page.locator('.tree-row[data-path="src/audio"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Новый…', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Новый…', exact: true })
  await dialog.getByRole('button', { name: /^Музыка и звуки/ }).click()
  await dialog.getByRole('textbox').fill('Created')
  await dialog.getByRole('button', { name: 'Создать', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.locator('.tab-select[data-path="src/audio/Created.dlmusic"]').waitFor()
  const music = page.locator('iframe[title="Музыкальная студия"]').last().contentFrame()
  await music.locator('.sound-studio').waitFor()
  await page.locator('.editor-toolbar__save').click()
  await page.waitForTimeout(500)
  assert.equal(JSON.parse(await readFile(join(fixture, 'src/audio/Created.dlmusic'), 'utf8')).ppq, 960)
  await page.screenshot({ path: join(output, 'created-from-new.png'), animations: 'disabled' })
  evidence.createMusicFromNew = true
}
