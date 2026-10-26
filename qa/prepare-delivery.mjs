import assert from 'node:assert/strict'
import { cp, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'

const base = resolve('build/sound-studio-qa')
const distribution = resolve(process.env.SOUND_QA_DIST ?? join(base, 'sound-20261023-a7/distribution'))
assert.ok(distribution.startsWith(base + '\\') || distribution.startsWith(base + '/'))
const release = join(distribution, 'sound-studio-release'), profile = join(distribution, 'sound-studio-profile/.devline')
await mkdir(release, { recursive: false }) // Never replace an already prepared delivery.
const accepted = join(base, 'browser-release-a2')
const proof = JSON.parse(await readFile(join(accepted, 'proof.json'), 'utf8'))
assert.equal(proof.sessionClosed, true); assert.deepEqual(proof.errors, [])
const archive = resolve('devline-audio-studio/build/extension/devline-sound-studio-0.1.3.dlextension')
const checksum = createHash('sha256').update(await readFile(archive)).digest('hex')
assert.equal(checksum, proof.installApi5Archive)
await copyFile(archive, join(release, 'devline-sound-studio-0.1.3.dlextension'))
await writeFile(join(release, 'SHA256SUMS.txt'), `${checksum}  devline-sound-studio-0.1.3.dlextension\n`)
await cp(resolve('docs/sound-studio'), join(release, 'docs'), { recursive: true })
const index = JSON.parse(await readFile(join(accepted, 'profile/.devline/extensions/installed.json'), 'utf8'))
assert.equal(index.extensions['devline.sound-studio'].checksum, checksum)
await mkdir(join(profile, 'extensions/objects'), { recursive: true })
await cp(join(accepted, 'profile/.devline/extensions/objects', checksum), join(profile, 'extensions/objects', checksum), { recursive: true })
await writeFile(join(profile, 'extensions/installed.json'), JSON.stringify({ schemaVersion: 1, extensions: { 'devline.sound-studio': index.extensions['devline.sound-studio'] } }))
await writeFile(join(profile, 'extensions.json'), JSON.stringify({ schemaVersion: 1, enabled: { 'devline.sound-studio': true } }))
await writeFile(join(profile, 'preferences.properties'), 'locale=ru\ntheme=dark\nsplashEnabled=false\nnotificationSound=false\n')
const original = join(base, 'browser-hardware-a2/project'), example = join(distribution, 'examples/LPK25-session')
await mkdir(example, { recursive: true })
await cp(join(original, 'src'), join(example, 'src'), { recursive: true })
const project = JSON.parse(await readFile(join(original, 'Audio.dlproject'), 'utf8')); project.name = 'LPK25 Session'
await writeFile(join(example, 'Audio.dlproject'), JSON.stringify(project, null, 2) + '\n')
const song = JSON.parse(await readFile(join(example, 'src/audio/Theme.dlmusic'), 'utf8'))
assert.equal(song.patterns.find(p => p.id === 'physical_lpk25').notes.length, 146)
song.name = 'Сеанс LPK25'; song.loop.enabled = false
song.patterns.sort((a, b) => Number(b.id === 'physical_lpk25') - Number(a.id === 'physical_lpk25'))
song.patterns[0].name = 'Мелодия LPK25'
await writeFile(join(example, 'src/audio/Theme.dlmusic'), JSON.stringify(song, null, 2) + '\n')
await copyFile(join(base, 'browser-hardware-a2/hardware-proof.json'), join(release, 'hardware-proof.json'))
await copyFile(join(base, 'native-vst-a2/proof.json'), join(release, 'vst3-proof.json'))
await copyFile(join(accepted, 'proof.json'), join(release, 'browser-proof.json'))
await cp(join(process.env.LOCALAPPDATA, 'DevLine/jcef/152.0.6/native'), join(distribution, 'sound-studio-cache/DevLine/jcef/152.0.6/native'), { recursive: true })
await writeFile(join(distribution, 'Sound-Studio.cmd'), [
  '@echo off', 'setlocal', 'set "JDK_JAVA_OPTIONS="', 'set "JAVA_TOOL_OPTIONS="', 'set "_JAVA_OPTIONS="',
  'set "LOCALAPPDATA=%~dp0sound-studio-cache"',
  'if "%~1"=="" (',
  '  "%~dp0runtime\\bin\\java.exe" "-Duser.home=%~dp0sound-studio-profile" --enable-native-access=ALL-UNNAMED -Dfile.encoding=UTF-8 -cp "%~dp0lib\\*" devline.desktop.MainKt --home "%~dp0." --open-file "%~dp0examples\\LPK25-session\\src\\audio\\Theme.dlmusic"',
  ') else (',
  '  "%~dp0runtime\\bin\\java.exe" "-Duser.home=%~dp0sound-studio-profile" --enable-native-access=ALL-UNNAMED -Dfile.encoding=UTF-8 -cp "%~dp0lib\\*" devline.desktop.MainKt --home "%~dp0." %*',
  ')', 'exit /b %errorlevel%', '',
].join('\r\n'))
await writeFile(join(release, 'START.ru.txt'), 'Запустить Sound-Studio.cmd из корня этой копии IDE. Откроется копия сохранённой мелодии LPK25 и записи HyperX. Нажать Play для прослушивания. Отдельный профиль находится в sound-studio-profile. Исходный аппаратный сеанс не изменён. ARP отложен.\r\n')
console.log('SOUND_STUDIO_DELIVERY_PREPARED ' + distribution)
