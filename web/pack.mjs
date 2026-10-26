import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const payload = process.argv[3] ? path.resolve(process.argv[3]) : path.join(root, 'build/extension-payload')
const panel = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, 'build/panel')
const native = process.argv[4] ? path.resolve(process.argv[4]) : path.resolve(root, '../devline-audio-engine/build/native/bin')
const platform = `${process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`
const executable = process.platform === 'win32' ? 'devline-audio-engine.exe' : 'devline-audio-engine'
const worker = process.platform === 'win32' ? 'devline-audio-plugin-worker.exe' : 'devline-audio-plugin-worker'
const code = (await readFile(path.join(panel, 'studio.js'), 'utf8')).replaceAll('</script', '<\\/script')
// The embedded Chromium host supports WOFF2. Avoid embedding the identical fallback font twice.
const css = (await readFile(path.join(panel, 'studio.css'), 'utf8')).replace(/,url\([^)]*data:[^)]*;base64,[^)]*\)\s*format\(["']woff["']\)/g, '').replaceAll('</style', '<\\/style')
const html = `<meta charset="utf-8"><style>${css}</style><div id="app"></div><script>${code}</script>`
if (Buffer.byteLength(html) > 1024 * 1024) throw Error('Studio webview exceeds the 1 MiB extension limit')
await mkdir(path.join(payload, 'web'), { recursive: true })
await mkdir(path.join(payload, 'native', platform), { recursive: true })
await writeFile(path.join(payload, 'web/studio.html'), html)
await copyFile(path.join(native, executable), path.join(payload, 'native', platform, executable))
await copyFile(path.join(native, worker), path.join(payload, 'native', platform, worker))
const licenses = await readFile(path.resolve(native, '../licenses/THIRD-PARTY.txt'))
await writeFile(path.join(payload, 'native', platform, 'third-party.txt'), licenses)
const descriptor = {
  schemaVersion: 1, apiVersion: 6, compatibility: { minIdeVersion: '0.1.0', capabilities: ['ui.webviews', 'ui.settings', 'editor.documents', 'editor.save', 'editor.history', 'editor.notices', 'native.artifacts'] }, entryPoint: 'devline.audio.studio.SoundStudioExtension',
  extension: JSON.parse(await readFile(path.join(root, 'src/main/resources/devline/soundstudio/extension.json'), 'utf8')),
  libraries: ['lib/devline-audio-studio-0.1.0.jar', 'lib/devline-audio-core-0.1.0.jar', 'lib/gson-2.13.2.jar'],
  webviews: [{ id: 'settings', title: { en: 'Sound Studio', ru: 'Музыкальная студия' }, html: 'web/studio.html', location: 'settings', icon: 'music-note-beamed', methods: ['preferences','devices'] },
    { id: 'studio', title: { en: 'Sound Studio', ru: 'Музыкальная студия' }, html: 'web/studio.html', methods: ['template','open','load','engine','poll','take','record','render','job','midiFile','plugins','plugin','state','settings','gesture'] }],
  documentEditors: [{ id: 'composition', extensions: ['dlmusic'], webview: 'studio', fileAssociation: true,
    icon: `data:image/png;base64,${(await readFile(path.join(root, 'src/main/resources/devline/soundstudio/branding/file-dlmusic.png'))).toString('base64')}` }],
  nativeArtifacts: [
    { id: 'licenses', platform, path: `native/${platform}/third-party.txt`, sha256: createHash('sha256').update(licenses).digest('hex') },
    { id: 'engine', platform, path: `native/${platform}/${executable}`, sha256: createHash('sha256').update(await readFile(path.join(native, executable))).digest('hex') },
    { id: 'pluginWorker', platform, path: `native/${platform}/${worker}`, sha256: createHash('sha256').update(await readFile(path.join(native, worker))).digest('hex') },
  ],
}
await writeFile(path.join(payload, 'extension.json'), JSON.stringify(descriptor, null, 2) + '\n')
console.log(`Sound Studio: ${Buffer.byteLength(html)} UI bytes, ${platform}`)
