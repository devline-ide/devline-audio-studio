"""Freeze an owned preview from verified backend bytes and a newly built shell."""
import hashlib
import json
import shutil
import sys
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

source, destination = (Path(value).resolve(strict=False) for value in sys.argv[1:])
assert source.is_dir() and not destination.exists(), 'Use a new destination'
assert source != destination and source not in destination.parents
frontend = Path('devline-web-shell/dist').resolve()
assert (frontend / 'index.html').is_file()
destination.mkdir(parents=True)
for child in source.iterdir():
    if child.name in ('bin', 'docs', 'extensions', 'icons', 'integration', 'lib', 'library', 'runtime', 'tools'):
        shutil.copytree(child, destination / child.name)
    elif child.is_file() and child.suffix.lower() in ('.cmd', '.bat', '.exe', '.sh') and child.name != 'Sound-Studio.cmd':
        shutil.copy2(child, destination / child.name)

jar = next((destination / 'lib').glob('devline-desktop-*.jar'))
original = source / 'lib' / jar.name
temporary = jar.with_suffix('.preview')
def sha(data):
    return hashlib.sha256(data).hexdigest()
with ZipFile(original) as old, ZipFile(temporary, 'w', compression=ZIP_DEFLATED) as new:
    original_entries = {entry.filename: sha(old.read(entry)) for entry in old.infolist() if not entry.filename.startswith('web/')}
    for entry in old.infolist():
        if not entry.filename.startswith('web/'):
            new.writestr(entry, old.read(entry))
    for file in sorted(frontend.rglob('*')):
        if file.is_file():
            new.write(file, 'web/' + file.relative_to(frontend).as_posix())
with ZipFile(temporary) as new:
    assert original_entries == {entry.filename: sha(new.read(entry)) for entry in new.infolist() if not entry.filename.startswith('web/')}
temporary.replace(jar)
files = ('components/extensions/ExtensionDocumentLauncher.vue', 'components/extensions/ExtensionWebview.vue',
         'components/shell/ProjectOpenFileDialog.vue', 'components/explorer/NewProjectItemDialog.vue',
         'components/content-browser/ContentBrowserDock.vue', 'components/extensions/extension-document-launcher.scss')
receipt = {'kind': 'frozen-backend-new-shell', 'backend': str(source), 'backendJar': sha(original.read_bytes()),
           'previewJar': sha(jar.read_bytes()), 'nonWebJarEntriesUnchanged': True,
           'sources': {file: sha((Path('devline-web-shell/src') / file).read_bytes()) for file in files},
           'web': {file.relative_to(frontend).as_posix(): sha(file.read_bytes()) for file in sorted(frontend.rglob('*')) if file.is_file()}}
(destination / 'shell-preview-receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf8')
print('FROZEN_SHELL_PREVIEW_READY', destination)
