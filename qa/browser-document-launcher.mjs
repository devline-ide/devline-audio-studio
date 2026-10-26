import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function documentLauncher({ page, source, fixture, output, evidence }) {
  const initial = await source()
  assert.equal(await page.getByText('Произошла непредвиденная ошибка', { exact: true }).count(), 0)
  await page.locator('.tree-row[data-path="unrelated.txt"]').dblclick()
  const tab = page.locator('[data-tab-id="extension:devline.sound-studio:studio"]').first()
  await tab.click()
  const launcher = page.locator('.extension-document-launcher')
  await launcher.waitFor()
  assert.equal(await launcher.locator('iframe').count(), 0)
  assert.equal(await launcher.locator('..').locator('iframe').count(), 0, 'Global entry does not boot a document-less DAW')
  assert.equal(await page.getByText('UNKNOWN_METHOD', { exact: true }).count(), 0)
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme }, theme)
    await page.screenshot({ path: join(output, `launcher-${theme}.png`), animations: 'disabled' })
  }
  await launcher.getByRole('button', { name: 'Открыть…', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Открыть файл', exact: true })
  await picker.waitFor()
  await picker.getByRole('textbox', { name: 'Путь к файлу проекта', exact: true }).fill('unrelated.txt')
  await picker.getByRole('button', { name: 'Открыть', exact: true }).click()
  await picker.getByRole('alert').filter({ hasText: '*.dlmusic' }).waitFor()
  await picker.getByRole('textbox', { name: 'Путь к файлу проекта', exact: true }).fill('src/audio/Theme.dlmusic')
  await picker.getByRole('button', { name: 'Открыть', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await launcher.waitFor({ state: 'hidden' })
  assert.equal((await source()).revision, initial.revision, 'Opening an existing song retains the shared document')
  await tab.click()
  await launcher.getByRole('button', { name: 'Создать…', exact: true }).click()
  const create = page.getByRole('dialog', { name: 'Новый…', exact: true })
  await create.getByRole('textbox').fill('LauncherCreated')
  await create.getByRole('button', { name: 'Создать', exact: true }).click()
  await create.waitFor({ state: 'hidden' })
  await launcher.waitFor({ state: 'hidden' })
  const created = page.locator('.tab-select[data-path$="/LauncherCreated.dlmusic"]')
  await created.waitFor()
  const path = await created.getAttribute('data-path')
  const editor = page.locator('iframe[title="Музыкальная студия"]').last().contentFrame()
  await editor.getByRole('button', { name: 'Сохранить', exact: true }).click()
  await page.waitForTimeout(350)
  assert.equal(JSON.parse(await readFile(join(fixture, path), 'utf8')).ppq, 960)
  assert.equal(await page.getByText('Это действие пока недоступно.', { exact: true }).count(), 0)
  assert.deepEqual(await page.evaluate(() => (window.qaRpcFailures ?? []).filter(failure => failure.error?.code === 'UNKNOWN_METHOD')), [])
  await page.screenshot({ path: join(output, 'launcher-created-document.png'), animations: 'disabled' })
  await page.locator('.editor-tab').filter({ has: created }).locator('.tab-close').click()
  await created.waitFor({ state: 'detached' })
  await page.locator('.tab-select[data-path="src/audio/Theme.dlmusic"]').click()
  evidence.documentLauncherCreateOpen = true
  evidence.documentLauncherNoUnknownMethod = true
}
