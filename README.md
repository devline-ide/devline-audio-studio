# Sound Studio extension settings

Sound Studio registers its own `settings` webview with `location: "settings"`.
The host lists it under Settings > Extensions while the extension is enabled.
The document toolbar gear calls `host.openSettings` and opens this registered page.
Settings require host capability `ui.settings`; the same HTML bundle chooses its
screen from `context.view.location`. The settings screen does not open a document.

The sessionless `preferences` method reads or atomically writes profile defaults
in `sound-studio/preferences.json`: named audio/MIDI inputs and outputs, sample
rate, buffer size, exclusive mode, MIDI channel, count-in, metronome and follow.
Unknown keys, invalid types/ranges and control characters in names are rejected.
Saved device names remain selectable while the device is disconnected.

The sessionless `devices` method starts a short-lived engine only to enumerate
hardware, then closes it. It does not configure/open an audio stream, MIDI port,
recording or plugin. Failure leaves saved device choices and editable defaults.
Changing defaults takes effect when a document is reopened. The existing Devices
panel retains current-session controls, recording status, export and game tools.

On first use, old compatible defaults are promoted from the most recently saved
entries in `sound-studio/settings.json`. That legacy file is retained. Document
settings continue to hold dock layout, track/pattern selection, grid and swing;
new document writes exclude profile defaults. Read combines profile defaults with
the document UI data. Settings do not use webview state or project files.

Focused verification (2026-10-24): source Vue typecheck, isolated Kotlin compile
and `SoundStudioDocumentsCheckKt` (validation, migration, round-trip persistence,
rejected-write preservation and sessionless preferences, plus existing document
create/read/edit/save checks), headless RU/EN settings save/cancel/failure checks,
and read-only enumeration against the cached native engine. No playback, recording,
device configuration, live installation replacement or restart was performed.
Evidence is in `build/qa-extension-settings-20261024/`. Isolated panel/descriptor
packing accepts `node web/pack.mjs <panel-directory> <payload-directory>`.
