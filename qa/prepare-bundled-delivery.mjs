import assert from 'node:assert/strict'
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

assert.ok(process.env.SOUND_QA_DIST && process.env.SOUND_QA_OUTPUT, 'Choose the new distribution and accepted fixture')
const distribution = resolve(process.env.SOUND_QA_DIST), accepted = resolve(process.env.SOUND_QA_OUTPUT)
const proof = JSON.parse(await readFile(join(accepted, 'proof.json'), 'utf8'))
assert.ok(proof.bundledEnabled && proof.createMusicFromNew && proof.normalErrorBarHistoryAndSound && proof.engineFailureReportedOnce)
assert.deepEqual(proof.errors, [])
const catalog = JSON.parse(await readFile(join(distribution, 'extensions/catalog.json'), 'utf8'))
const release = join(distribution, 'sound-studio-release')
await mkdir(release, { recursive: false })
await cp(resolve('docs/sound-studio'), join(release, 'docs'), { recursive: true })
await copyFile(join(accepted, 'proof.json'), join(release, 'browser-proof.json'))
await copyFile(resolve('build/sound-studio-qa/vst-audio-stress-a1/proof.json'), join(release, 'vst-audio-proof.json'))
await copyFile(resolve('build/sound-studio-qa/browser-hardware-a2/hardware-proof.json'), join(release, 'hardware-proof.json'))
await writeFile(join(release, 'SHA256SUMS.txt'), (await Promise.all(catalog.extensions.map(async item => {
  const file = item.path ?? item.archive
  const bytes = await readFile(join(distribution, 'extensions', file))
  const checksum = createHash('sha256').update(bytes).digest('hex')
  assert.equal(checksum, item.sha256)
  return `${checksum}  extensions/${file}\n`
}))).join(''))
const original = resolve('build/sound-studio-qa/browser-hardware-a2/project'), example = join(distribution, 'examples/LPK25-session')
await mkdir(example, { recursive: true })
await cp(join(original, 'src'), join(example, 'src'), { recursive: true })
const project = JSON.parse(await readFile(join(original, 'Audio.dlproject'), 'utf8')); project.name = 'LPK25 Session'
await writeFile(join(example, 'Audio.dlproject'), JSON.stringify(project, null, 2) + '\n')
const songFile = join(example, 'src/audio/Theme.dlmusic'), song = JSON.parse(await readFile(songFile, 'utf8'))
assert.equal(song.patterns.find(pattern => pattern.id === 'physical_lpk25').notes.length, 146)
song.name = 'Сеанс LPK25'; song.loop.enabled = false
song.patterns.sort((a, b) => Number(b.id === 'physical_lpk25') - Number(a.id === 'physical_lpk25'))
song.patterns[0].name = 'Мелодия LPK25'
await writeFile(songFile, JSON.stringify(song, null, 2) + '\n')
// Only preferences are prepared. The ordinary distribution installs/enables its own bundled catalog.
const profile = join(distribution, 'sound-studio-profile/.devline')
await mkdir(profile, { recursive: true })
await writeFile(join(profile, 'preferences.properties'), 'locale=ru\ntheme=dark\nsplashEnabled=false\nnotificationSound=true\n')
await writeFile(join(distribution, 'Sound-Studio.cmd'), [
  '@echo off', 'chcp 65001 >nul', 'setlocal', 'set "JDK_JAVA_OPTIONS="', 'set "JAVA_TOOL_OPTIONS="', 'set "_JAVA_OPTIONS="',
  'if "%~1"=="" (',
  '  "%~dp0runtime\\bin\\java.exe" "-Duser.home=%~dp0sound-studio-profile" --enable-native-access=ALL-UNNAMED -Dfile.encoding=UTF-8 -cp "%~dp0lib\\*" devline.desktop.MainKt --home "%~dp0." --open-file "%~dp0examples\\LPK25-session\\src\\audio\\Theme.dlmusic"',
  ') else (',
  '  "%~dp0runtime\\bin\\java.exe" "-Duser.home=%~dp0sound-studio-profile" --enable-native-access=ALL-UNNAMED -Dfile.encoding=UTF-8 -cp "%~dp0lib\\*" devline.desktop.MainKt --home "%~dp0." %*',
  ')', 'exit /b %errorlevel%', '',
].join('\r\n'))
await writeFile(join(release, 'START.ru.txt'), 'Запустить Sound-Studio.cmd: отдельный профиль и копия сохранённой мелодии LPK25/HyperX. Студия поставляется вместе с IDE и включается автоматически. Для нового звука: Файл → Новый… → Музыка и звуки → имя → Создать. Ноты редактируются в Piano roll. Для WAV/OGG нажать Экспорт → Экспортировать в проект. Обычный devline.cmd запускает эту же сборку с основным профилем; сначала закрыть прежнюю IDE. Старая a7 и её несохранённые данные не изменены.\r\n')
console.log('BUNDLED_DELIVERY_PREPARED ' + distribution)
