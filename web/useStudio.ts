import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { createDesignerDockState, type DesignerDockState } from '@devline/ui-web'
import { sdk } from './sdk'
import type { StudioPreferences } from './preferences'
import { createTrackMute } from './trackMute'
import { clone, frameToTick, tickToFrame, makeTrack, PPQ, quantize, uid, validateRouting, automationAt, type Composition, type Note, type Track } from './model'

interface DocumentStatus { revision: number; length: number; text?: string; writable: boolean; dirty: boolean }
export interface AudioStatus {
  arrangementFrame?: number; pluginMisses?: number; processingLatencyFrames?: number; pluginQuantum?: number
  engineError?: string; plugins?: Array<{ id?: string; error?: string; failed?: boolean }>
  pluginDirty?: boolean; renderStale?: boolean
  heldNotes?: number[]; latencyMs?: number; latencyEstimated?: boolean; midiConnected?: boolean
  frame: number; playing: boolean; recording: boolean; capturedFrames: number; dropped: number; sampleRate: number
  inputPeak: number; meters: Record<string, number>; midi: Array<{ status: number; data1: number; data2: number; frame: number }>
}
export interface Devices { outputs: Array<{ index: number; name: string }>; inputs: Array<{ index: number; name: string }>; midi: Array<{ index: number; name: string }>; midiOutputs: Array<{ index: number; name: string }> }

export function useStudio() {
  const document = ref<Composition>(), revision = ref(0), writable = ref(false), dirty = ref(false)
  const trackMute = createTrackMute()
  watch(document, () => trackMute.reset(), { flush: 'sync' })
  const session = ref(''), error = ref(''), busy = ref(false), selectedTrack = ref(''), selectedPattern = ref('')
  const midiTrack = ref(''), followPlayhead = ref(true), playbackMode = ref('song'), playbackBusy = ref(false)
  const trackAppearance = ref(''), parameterDialog = ref(false)
  const armedTrack = ref(''), recordingTrack = ref('')
  const grid = ref(240), swing = ref(0), selectedNotes = ref<string[]>([]), main = ref('arrangement'), visible = ref(sdk.getContext().visible)
  const status = ref<AudioStatus>({ frame: 0, playing: false, recording: false, capturedFrames: 0, dropped: 0, sampleRate: 48000, inputPeak: 0, meters: {}, midi: [] })
  const devices = ref<Devices>({ outputs: [], inputs: [], midi: [], midiOutputs: [] }), midiInput = ref<string | null>(null), midiOutput = ref<number | null>(null), output = ref<number | null>(null), input = ref<number | null>(null)
  const midiClock = ref(false), heldNotes = reactive(new Set<number>()), stepCursor = ref(0), waveforms = reactive<Record<string, { frames: number; sampleRate: number; sourceRate: number; peaks: number[] }>>({})
  const selectedClip = ref('')
  const conflictDraft = ref(''), writeConflict = ref(false)
  const documentGesture = ref(false)
  const plugins = ref<Array<{ id: string; name: string; instrument: boolean }>>([])
  const pluginParameters = ref<Array<{ id: number; name: string; value: number; readOnly: boolean }>>([])
  const pluginParametersEffect = ref('instrument'), pluginParameterTotal = ref(0)
  const presetPath = ref('')
  const scanJob = ref<{ id: string; status: string; error?: string }>()
  const scanDirectory = ref(''), retryPlugins = ref(false), failedPlugins = ref(0)
  const sampleRate = ref<number | null>(48000), blockSize = ref<number | null>(256), exclusive = ref(false), monitoring = ref(false), midiRecording = ref(false)
  const inputChannel = ref<number | null>(null), overdub = ref(true), recordQuantize = ref(false), countIn = ref(false), metronome = ref(false), stepInput = ref(false)
  const captureChannels = ref<string | number | null>(0), recoveries = ref<Array<{ path: string; sampleRate: number; startFrame: number; latencyFrames: number }>>([])
  const recordingAsset = ref(''), recordingStart = ref(0), recordingTrim = ref(0), noteClipboard = ref<Note[]>([]), job = ref<{ id: string; status: string; output?: string; error?: string }>()
  const importPath = ref(''), exportPath = ref(''), exportFormat = ref<string | number | null>('wav')
  const saveAsPath = ref('')
  const exportRegion = ref<string | number | null>('song'), exportBits = ref<string | number | null>(16), exportTail = ref('2'), exportCrossfade = ref('0'), exportOverwrite = ref(false), exportStart = ref('0'), exportEnd = ref('15360')
  const gameLevel = ref(''), gameEntity = ref<string | number | null>(null), gameEvent = ref<string | number | null>('ready'), gameLoop = ref(false)
  const gameTargets = ref<Array<{ id: string; name: string }>>([]), gameRevision = ref(0), gameAssigned = ref('')
  const dock = reactive<DesignerDockState<string>>({ ...createDesignerDockState(),
    tools: {
      piano: { visible: true, pinned: true, edge: 'bottom' },
      mixer: { visible: true, pinned: false, edge: 'bottom' },
      patterns: { visible: true, pinned: false, edge: 'left' },
      properties: { visible: true, pinned: true, edge: 'right' },
      instruments: { visible: true, pinned: false, edge: 'right' },
      devices: { visible: true, pinned: false, edge: 'right' },
      automation: { visible: true, pinned: false, edge: 'bottom' },
    }, selected: { left: 'patterns', right: 'properties', top: 'piano', bottom: 'piano' },
    hiddenHeaders: { left: false, right: false, top: false, bottom: true },
    sizes: { left: 180, right: 200, top: 160, bottom: 240 },
  })
  const track = computed(() => document.value?.tracks.find(track => track.id === selectedTrack.value))
  const pattern = computed(() => document.value?.patterns.find(pattern => pattern.id === selectedPattern.value))
  const clip = computed(() => track.value?.clips.find(clip => clip.id === selectedClip.value))
  const tick = computed(() => document.value ? frameToTick(status.value.frame, status.value.sampleRate, document.value.tempos) : 0)
  const arrangementTick = computed(() => document.value ? frameToTick(status.value.arrangementFrame ?? status.value.frame, status.value.sampleRate, document.value.tempos) : 0)
  let active = true, reading = false, polling = false, dirtyEngine = false, writes = Promise.resolve(), pendingWrites = 0
  let engineLoading: Promise<void> | undefined
  let lastStatusCheck = 0
  let takePattern = '', takeOverdub = true, stepHeld = new Set<number>(), preferencesReady = false
  interface Gesture { id: string; track: string; target: string; mode: string; before: number; value: number }
  let gesture: Gesture | undefined, gesturePending: Promise<void> = Promise.resolve(), previewAt = 0
  const writingGestures = new Map<string, Gesture>()
  let engineUnavailable = false, lastHealthError = ''
  const engineFailed = (cause: unknown) => /Audio engine (?:stopped|closed|disconnected|did not respond)/i.test(String(cause instanceof Error ? cause.message : cause))
  const fail = (cause: unknown) => { error.value = String(cause instanceof Error ? cause.message : cause); if (engineFailed(cause)) { engineUnavailable = true; status.value.engineError = error.value; status.value.playing = false; status.value.recording = false; heldNotes.clear() } }
  async function safe<T>(action: () => Promise<T>) {
    try { const result = await action(); error.value = ''; return result } catch (cause) { fail(cause); return undefined }
  }
  async function call<T = unknown>(method: string, args: Record<string, unknown> = {}) {
    return sdk.call<T>(method, { ...args, session: session.value })
  }
  async function readDocument() {
    if (reading || pendingWrites || documentGesture.value || !visible.value || writeConflict.value || gesture || writingGestures.size) return
    reading = true
    try {
      const first = await sdk.call<DocumentStatus>('document', { action: 'read', offset: 0 })
      let text = first.text ?? ''
      for (let offset = text.length; offset < first.length;) {
        const part = await sdk.call<DocumentStatus>('document', { action: 'read', offset })
        if (part.revision !== first.revision || !part.text) throw Error('FILE_CONFLICT')
        text += part.text; offset = text.length
      }
      if (!active) return
      writable.value = first.writable; dirty.value = first.dirty; revision.value = first.revision
      if (!text.trim()) {
        document.value = await call<Composition>('template', { name: sdk.getContext().document?.path.split('/').pop()?.replace(/\.dlmusic$/i, '') })
        if (writable.value) await commit()
      } else document.value = JSON.parse(text) as Composition
      if (document.value?.schemaVersion !== 1 || document.value.ppq !== PPQ) throw Error('Unsupported music document')
      document.value.patterns.forEach(pattern => { pattern.controllers ??= []; pattern.events ??= [] })
      if (!track.value) selectedTrack.value = document.value.tracks[0]?.id ?? ''
      if (!pattern.value) selectedPattern.value = document.value.patterns[0]?.id ?? ''
      if (!document.value.tracks.some(track => track.kind === 'instrument' && track.id === midiTrack.value)) midiTrack.value = document.value.tracks.find(track => track.kind === 'instrument')?.id ?? ''
      dirtyEngine = true
    } finally { reading = false }
  }
  async function commit(snapshot?: string) {
    if (!document.value || !writable.value) return
    const text = snapshot ?? JSON.stringify(document.value, null, 2) + '\n'
    const baseRevision = revision.value
    await sdk.call('document', { action: 'begin', revision: baseRevision })
    for (let offset = 0; offset < text.length; offset += 3500) await sdk.call('document', { action: 'chunk', text: text.slice(offset, offset + 3500) })
    const result = await sdk.call<DocumentStatus>('document', { action: 'commit' })
    revision.value = result.revision; dirty.value = result.dirty; dirtyEngine = true
  }
  function edit(change: (value: Composition) => void) {
    if (!document.value || !writable.value) return Promise.resolve()
    const before = clone(document.value)
    try { change(document.value); validateRouting(document.value) } catch (cause) { document.value = before; fail(cause); return Promise.resolve() }
    dirtyEngine = true
    const snapshot = JSON.stringify(document.value, null, 2) + '\n'
    busy.value = true; pendingWrites++
    writes = writes.then(() => { if (!writeConflict.value) return commit(snapshot) }).catch(cause => { writeConflict.value = true; fail(cause) }).finally(async () => {
      pendingWrites--; busy.value = pendingWrites > 0
      if (!pendingWrites && writeConflict.value && document.value) {
        const text = JSON.stringify(document.value, null, 2) + '\n'
        try {
          const { transfer } = await call<{ transfer: string }>('load', { action: 'begin', revision: revision.value })
          for (let offset = 0; offset < text.length; offset += 3500) await call('load', { action: 'chunk', transfer, text: text.slice(offset, offset + 3500) })
          conflictDraft.value = (await call<{ path: string }>('load', { action: 'commit', transfer, draft: true })).path
        } catch (cause) { fail(cause) }
      }
    })
    return writes
  }
  function toggleMute(id: string, isolate = false) {
    if (!writable.value || !document.value?.tracks.some(track => track.id === id)) return Promise.resolve()
    selectedTrack.value = id
    return editMix(value => trackMute.toggle(value.tracks, id, isolate))
  }
  let mixVersion = 0
  function editMix(change: (value: Composition) => void) {
    const result = edit(change)
    if (session.value && writable.value && document.value) {
      mixVersion++
      const tracks = document.value.tracks.map(({ id, muted, solo }) => ({ id, muted, solo }))
      void safe(() => engine('mix', { tracks }))
    }
    return result
  }
  function toggleSolo(id: string) {
    return editMix(value => { const track = value.tracks.find(track => track.id === id); if (track) track.solo = !track.solo })
  }
  async function loadEngine(): Promise<void> {
    if (engineLoading) return engineLoading
    if (writeConflict.value) return
    if (!document.value || !session.value) return
    const text = JSON.stringify(document.value), expectedRevision = revision.value, expectedMixVersion = mixVersion
    engineLoading = (async () => {
      const { transfer } = await call<{ transfer: string }>('load', { action: 'begin', revision: expectedRevision })
      for (let offset = 0; offset < text.length; offset += 3500) await call('load', { action: 'chunk', transfer, text: text.slice(offset, offset + 3500) })
      await call('load', { action: 'commit', transfer })
      if (mixVersion !== expectedMixVersion && document.value) await engine('mix', { tracks: document.value.tracks.map(({ id, muted, solo }) => ({ id, muted, solo })) })
      dirtyEngine = revision.value !== expectedRevision || pendingWrites > 0 || text !== JSON.stringify(document.value)
      if (!dirtyEngine) {
        if (!document.value?.tracks.some(track => track.kind === 'instrument' && track.id === midiTrack.value)) midiTrack.value = document.value?.tracks.find(track => track.kind === 'instrument')?.id ?? ''
        await engine('liveTrack', { id: midiTrack.value })
      }
    })().finally(() => { engineLoading = undefined })
    return engineLoading
  }
  async function engine(command: string, arguments_: Record<string, unknown> = {}) {
    return call<Record<string, unknown>>('engine', { command, arguments: arguments_ })
  }
  let playbackUpdates = Promise.resolve()
  function setPlaybackMode(mode: string) {
    if (mode !== 'song' && mode !== 'pattern') return Promise.resolve()
    const trackId = selectedTrack.value, patternId = selectedPattern.value
    playbackBusy.value = true
    playbackUpdates = playbackUpdates.catch(() => {}).then(async () => {
      await finishGesture(); await finishWriting(); await writes
      if (dirtyEngine) await loadEngine()
      const result = await engine('playback', { mode, track: trackId, pattern: patternId })
      status.value = { ...status.value, frame: Number(result.frame ?? status.value.frame), arrangementFrame: Number(result.arrangementFrame ?? status.value.arrangementFrame ?? status.value.frame) }
      playbackMode.value = mode
    }).finally(() => { playbackBusy.value = false })
    return playbackUpdates
  }
  watch([selectedTrack, selectedPattern], () => {
    parameterDialog.value = false
    if (session.value && playbackMode.value === 'pattern') void safe(() => setPlaybackMode(track.value?.kind === 'instrument' && pattern.value ? 'pattern' : 'song'))
  })
  async function play() {
    await playbackUpdates
    if (status.value.playing) await finishWriting()
    await writes
    if (dirtyEngine) await loadEngine()
    if (!status.value.playing && writable.value) {
      const lanes = document.value?.tracks.flatMap(track => track.automation.filter(lane => lane.mode === 'write').map(lane => ({ track, target: lane.target }))) ?? []
      if (lanes.length > 256) throw Error('At most 256 automation lanes can be written at once')
      for (const lane of lanes) {
        const value = parameterValue(lane.track, lane.target)
        const result = await call<{ id: string }>('gesture', { action: 'begin', track: lane.track.id, target: lane.target, value })
        writingGestures.set(result.id, { id: result.id, track: lane.track.id, target: lane.target, mode: 'write', before: value, value })
      }
    }
    await engine(status.value.playing ? 'pause' : 'play')
  }
  async function prepareSave() {
    if (writeConflict.value) throw Error('Resolve the document conflict before saving')
    if (documentGesture.value) throw Error('Finish or cancel the current edit before saving')
    try {
      await finishGesture(); await finishWriting()
      if (midiRecording.value) await midiRecord()
      if (status.value.recording) await recordAudio()
      await writes
      const hasPlugins = document.value?.tracks.some(track => track.instrument.kind === 'vst3' || track.effects.some(effect => effect.kind === 'vst3'))
      if (hasPlugins && !engineUnavailable) {
        if (dirtyEngine) await loadEngine()
        type State = { track: string; effect: string; state: string; parameters: Record<string, number> }
        const result: { states: State[] } = { states: [] }
        for (const track of document.value?.tracks ?? []) {
          if (track.instrument.kind === 'vst3') result.states.push(...(await call<{ states: State[] }>('state', { track: track.id })).states)
          for (const effect of track.effects) if (effect.kind === 'vst3') result.states.push(...(await call<{ states: State[] }>('state', { track: track.id, effect: effect.id })).states)
        }
        await edit(value => {
          for (const state of result.states) {
            const track = value.tracks.find(track => track.id === state.track)
            const descriptor = state.effect === 'instrument' ? track?.instrument : track?.effects.find(effect => effect.id === state.effect)
            if (descriptor) { descriptor.state = state.state; descriptor.parameters = state.parameters }
          }
        })
        await loadEngine()
      }
    } catch (cause) {
      if (!engineFailed(cause)) throw cause
      fail(cause)
    }
    if (engineUnavailable) {
      // The workspace owns the score. A dead audio process cannot veto saving it.
      // Keep the last valid state paths; commit any locally previewed parameters.
      await writes
      if (writeConflict.value) throw Error('Resolve the document conflict before saving')
      await commit()
    }
    await sdk.call('document', { action: 'activity', dirty: false })
  }
  const unsubscribeSave = sdk.onBeforeDocumentSave(prepareSave)
  async function save() { await writes; if (writeConflict.value) throw Error('Resolve the document conflict before saving'); await sdk.call('document', { action: 'save' }); dirty.value = false }
  async function saveAs() { await writes; if (writable.value) await prepareSave(); await sdk.call('document', { action: 'saveAs', path: saveAsPath.value, revision: revision.value }) }
  async function resolveConflict(keepLocal: boolean) {
    await writes
    if (keepLocal) { revision.value = (await sdk.call<DocumentStatus>('document', { action: 'status' })).revision; await commit() }
    writeConflict.value = false
    if (!keepLocal) await readDocument()
    conflictDraft.value = ''; error.value = ''
  }
  async function history(action: 'undo' | 'redo') { await writes; await sdk.call('document', { action }); await readDocument() }
  function addTrack(kind: Track['kind'] = 'instrument', instrument: Track['instrument']['kind'] = 'synth', plugin?: { id: string; name: string }) {
    return edit(value => {
      const result = makeTrack(plugin?.name ?? `${instrument} ${value.tracks.length + 1}`, kind)
      if (kind !== 'bus' && value.tracks.some(track => track.id === 'master_bus')) result.output = 'master_bus'
      result.instrument.kind = instrument
      if (plugin) result.instrument.plugin = plugin.id
      value.tracks.push(result); selectedTrack.value = result.id
    })
  }
  function masterInserts() {
    return edit(value => {
      let master = value.tracks.find(track => track.id === 'master_bus')
      if (!master) {
        master = makeTrack('Master', 'bus'); master.id = 'master_bus'; master.gain = 1
        value.tracks.forEach(track => { if (track.output === 'master') track.output = master!.id }); value.tracks.push(master)
      }
      selectedTrack.value = master.id; dock.tools.properties!.visible = true; dock.tools.properties!.pinned = true; dock.selected.right = 'properties'
    })
  }
  function deleteTrack() { return edit(value => { const id = selectedTrack.value; value.tracks = value.tracks.filter(track => track.id !== id); value.tracks.forEach(track => { if (track.output === id) track.output = 'master'; track.sends = track.sends.filter(send => send.track !== id) }); selectedTrack.value = value.tracks[0]?.id ?? '' }) }
  function addPattern(copy = false) {
    return edit(value => {
      const next = copy && pattern.value ? clone(pattern.value) : { id: '', name: `Pattern ${value.patterns.length + 1}`, length: 3840, notes: [], controllers: [], events: [] }
      next.id = uid('pattern'); if (copy) next.name += ' copy'
      value.patterns.push(next); selectedPattern.value = next.id
    })
  }
  function placePattern(trackId: string, position: number) {
    const source = pattern.value, destination = document.value?.tracks.find(track => track.id === trackId)
    if (!source || destination?.kind !== 'instrument') return
    return edit(() => {
      const clip = { id: uid('clip'), tick: quantize(position, 960), length: source.length, pattern: source.id, sourceFrame: 0, gain: 1, fadeIn: 0, fadeOut: 0 }
      destination.clips.push(clip); selectedTrack.value = trackId; selectedClip.value = clip.id
    })
  }
  function addNote(position: number, pitch: number) {
    if (!pattern.value) return
    return edit(() => {
      const start = Math.min(pattern.value!.length - grid.value, quantize(position, grid.value, swing.value))
      const note = { id: uid('note'), pitch: Math.max(0, Math.min(127, pitch)), tick: Math.max(0, start), duration: Math.min(grid.value, pattern.value!.length - Math.max(0, start)), velocity: 100, channel: inputChannel.value ?? 0 }
      pattern.value!.notes.push(note); selectedNotes.value = [note.id]
    })
  }
  function deleteNotes() { return edit(() => { if (pattern.value) pattern.value.notes = pattern.value.notes.filter(note => !selectedNotes.value.includes(note.id)) }) }
  function transpose(amount: number) { return edit(() => { pattern.value?.notes.forEach(note => { if (selectedNotes.value.includes(note.id)) note.pitch = Math.max(0, Math.min(127, note.pitch + amount)) }) }) }
  function quantizeNotes() { return edit(() => { pattern.value?.notes.forEach(note => { if (!selectedNotes.value.length || selectedNotes.value.includes(note.id)) note.tick = Math.min(pattern.value!.length - note.duration, quantize(note.tick, grid.value, swing.value)) }) }) }
  function copyNotes() { noteClipboard.value = clone(pattern.value?.notes.filter(note => selectedNotes.value.includes(note.id)) ?? []) }
  function pasteNotes() { return edit(() => { if (pattern.value) for (const note of noteClipboard.value) { const duration = Math.min(note.duration, pattern.value.length); pattern.value.notes.push({ ...note, id: uid('note'), duration, tick: Math.max(0, Math.min(pattern.value.length - duration, note.tick + grid.value)) }) } }) }
  async function midiRecord() {
    if (!pattern.value) return
    if (!midiRecording.value) { if (playbackMode.value !== 'song') await setPlaybackMode('song'); await writes; if (dirtyEngine) await loadEngine(); takePattern = pattern.value.id; takeOverdub = overdub.value; await call('take', { action: 'start', channel: inputChannel.value, countIn: countIn.value }); midiRecording.value = true }
    else {
      const result = await call<{ notes: Note[]; controllers: PatternControllers; events: Composition['patterns'][number]['events'] }>('take', { action: 'stop' }); midiRecording.value = false
      await edit(doc => {
        const target = doc.patterns.find(pattern => pattern.id === takePattern)
        if (!target) throw Error('The recording pattern was removed')
        if (!takeOverdub) { target.notes = []; target.controllers = []; target.events = [] }
        for (const note of result.notes) {
          if (recordQuantize.value) note.tick = quantize(note.tick, grid.value, swing.value)
          note.tick %= target.length
          note.duration = Math.max(1, Math.min(note.duration, target.length - note.tick))
          target.notes.push(note)
        }
        target.controllers.push(...result.controllers.map(cc => ({ ...cc, tick: cc.tick % target.length })))
        target.events ??= []
        target.events.push(...result.events.map(event => ({ ...event, tick: event.tick % target.length })))
      })
    }
  }
  async function configure() {
    await engine('configure', { sampleRate: sampleRate.value, blockSize: blockSize.value, output: output.value ?? -1, input: input.value ?? -1, capture: input.value !== null, exclusive: exclusive.value })
    dirtyEngine = true; await loadEngine()
  }
  async function recordAudio() {
    if (!status.value.recording) {
      if (playbackMode.value !== 'song') await setPlaybackMode('song')
      if (!document.value?.tracks.some(track => track.kind === 'audio' && track.id === armedTrack.value)) throw Error('Arm an audio track before recording')
      if (dirtyEngine) await loadEngine()
      recordingTrack.value = armedTrack.value
      recordingStart.value = Math.round(tick.value)
      const result = await call<{ path: string; startFrame: number; latencyFrames: number; sampleRate: number }>('record', { action: 'start', channels: captureChannels.value })
      recordingTrim.value = Math.max(0, result.latencyFrames - result.startFrame)
      recordingStart.value = Math.round(frameToTick(Math.max(0, result.startFrame - result.latencyFrames), result.sampleRate, document.value!.tempos))
      recordingAsset.value = result.path; status.value.recording = true
    } else {
      const result = await call<{ frames: number; sampleRate: number }>('record', { action: 'stop' })
      status.value.recording = false
      if (!result.frames) throw Error('The input returned no audio frames')
      await edit(value => {
        const existing = value.tracks.find(track => track.kind === 'audio' && track.id === recordingTrack.value)
        const audio = existing ?? makeTrack('Recording', 'audio')
        const trim = Math.min(recordingTrim.value, Math.max(0, result.frames - 1))
        const end = frameToTick(tickToFrame(recordingStart.value, result.sampleRate, value.tempos) + result.frames - trim, result.sampleRate, value.tempos)
        audio.clips.push({ id: uid('clip'), tick: recordingStart.value, length: Math.max(1, Math.round(end - recordingStart.value)), asset: recordingAsset.value, sourceFrame: trim, gain: 1, fadeIn: 0, fadeOut: 0 })
        if (!existing) value.tracks.push(audio)
        selectedTrack.value = audio.id
      })
    }
  }
  async function render() {
    await save(); if (dirtyEngine) await loadEngine()
    const result = await call<{ id: string }>('render', { format: exportFormat.value, region: exportRegion.value, bits: exportBits.value, tail: Number(exportTail.value), crossfadeMs: Number(exportCrossfade.value), overwrite: exportOverwrite.value, startTick: Number(exportStart.value), endTick: Number(exportEnd.value), pattern: selectedPattern.value, track: selectedTrack.value, ...(exportPath.value ? { path: exportPath.value } : {}) })
    job.value = { id: result.id, status: 'queued' }
  }
  async function importFile() {
    if (/\.midi?$/i.test(importPath.value)) {
      const imported = await call<Composition>('midiFile', { action: 'import', path: importPath.value })
      const ids = new Map(imported.patterns.map(pattern => [pattern.id, uid('pattern')]))
      imported.patterns.forEach(pattern => { pattern.id = ids.get(pattern.id)!; pattern.notes.forEach(note => { note.id = uid('note') }) })
      imported.tracks.forEach(track => { track.id = uid('track'); track.clips.forEach(clip => { clip.id = uid('clip'); if (clip.pattern) clip.pattern = ids.get(clip.pattern)! }) })
      await edit(value => { value.patterns.push(...imported.patterns); value.tracks.push(...imported.tracks); if (!value.patterns.some(pattern => pattern.notes.length && !imported.patterns.includes(pattern))) value.tempos = imported.tempos })
    } else if (/\.(wav|ogg)$/i.test(importPath.value)) {
      const info = await engine('inspect', { path: importPath.value }) as unknown as { frames: number; sampleRate: number }
      await edit(value => {
        const audio = makeTrack(importPath.value.split('/').pop() ?? 'Audio', 'audio')
        audio.clips.push({ id: uid('clip'), tick: 0, length: Math.max(1, Math.round(frameToTick(info.frames, info.sampleRate, value.tempos))), asset: importPath.value, sourceFrame: 0, gain: 1, fadeIn: 0, fadeOut: 0 })
        value.tracks.push(audio); selectedTrack.value = audio.id
      })
    } else throw Error('Supported imports: WAV, OGG, MID, MIDI')
  }
  async function scanPlugins() {
    const result = await call<{ id: string }>('plugins', { action: 'scan', retry: retryPlugins.value, ...(scanDirectory.value ? { directories: [scanDirectory.value] } : {}) })
    scanJob.value = { id: result.id, status: 'queued' }
  }
  async function readPlugins() {
    const result: typeof plugins.value = []
    for (let offset = 0; offset < 4096;) {
      const page = await call<{ plugins: typeof plugins.value; total: number; nextOffset: number; failed: number }>('plugins', { offset })
      result.push(...page.plugins); failedPlugins.value = page.failed
      if (page.nextOffset >= page.total || page.nextOffset <= offset) break
      offset = page.nextOffset
    }
    plugins.value = result
  }
  async function plugin(command: string, arguments_: Record<string, unknown> = {}, effect = 'instrument') {
    if (dirtyEngine) await loadEngine()
    return call<Record<string, unknown>>('plugin', { track: selectedTrack.value, effect, arguments: { ...arguments_, command } })
  }
  function openPluginParameters(effect = 'instrument') {
    pluginParametersEffect.value = effect; pluginParameters.value = []; pluginParameterTotal.value = 0; parameterDialog.value = true
  }
  let parameterRequest = 0
  async function readPluginParameters(effect = 'instrument', offset = 0, query = '') {
    const trackId = selectedTrack.value, request = ++parameterRequest
    const page = await plugin('parameters', { offset, query }, effect) as unknown as { total: number; parameters: typeof pluginParameters.value }
    if (request !== parameterRequest || !parameterDialog.value || trackId !== selectedTrack.value || effect !== pluginParametersEffect.value) return
    pluginParameters.value = page.parameters; pluginParameterTotal.value = page.total
  }
  async function setPluginParameter(id: number, value: number, effect = 'instrument') {
    await plugin('parameter', { id, value }, effect)
    await edit(() => {
      const descriptor = effect === 'instrument' ? track.value?.instrument : track.value?.effects.find(item => item.id === effect)
      if (descriptor) descriptor.parameters[String(id)] = value
    })
    dirtyEngine = false
  }
  async function poll() {
    if (!session.value || polling || !active || engineUnavailable || !visible.value && Date.now() - lastStatusCheck < 500) return
    polling = true
    try {
      status.value = await call<AudioStatus>('poll')
      if (status.value.engineError) throw Error(status.value.engineError)
      const healthError = (status.value.plugins ?? []).filter(plugin => plugin.error || plugin.failed).map(plugin => plugin.error ?? `VST3 stopped: ${plugin.id ?? ''}`).join('\n').slice(0, 1000)
      if (healthError && healthError !== lastHealthError) fail(Error(healthError))
      lastHealthError = healthError
      if (status.value.pluginDirty || midiRecording.value || status.value.recording || writingGestures.size) await sdk.call('document', { action: 'activity', dirty: true })
      if (!visible.value) { lastStatusCheck = Date.now(); return }
      if (!status.value.playing && writingGestures.size) await finishWriting()
      if (dirtyEngine && !busy.value && !reading && !gesture) await loadEngine()
      for (const event of status.value.midi) {
        if (inputChannel.value !== null && inputChannel.value !== (event.status & 15)) continue
        const on = (event.status & 0xf0) === 0x90 && event.data2 > 0, off = (event.status & 0xf0) === 0x80 || (event.status & 0xf0) === 0x90 && !event.data2
        if (on) heldNotes.add(event.data1)
        if (off) heldNotes.delete(event.data1)
        if (stepInput.value && !midiRecording.value) {
          if (on) { stepHeld.add(event.data1); await addNote(stepCursor.value, event.data1) }
          if (off && stepHeld.delete(event.data1) && !stepHeld.size) stepCursor.value = (stepCursor.value + grid.value) % (pattern.value?.length ?? 3840)
        }
      }
      if (status.value.heldNotes) { heldNotes.clear(); status.value.heldNotes.forEach(note => heldNotes.add(note)) }
      if (status.value.midiConnected === false) stepHeld.clear()
      if (job.value && ['queued', 'running'].includes(job.value.status)) job.value = await call('job', { id: job.value.id })
      if (job.value?.status === 'failed') { error.value = job.value.error ?? 'Render failed'; job.value.status = 'reported' }
      if (scanJob.value && ['queued', 'running'].includes(scanJob.value.status)) {
        scanJob.value = await call('job', { id: scanJob.value.id })
        if (scanJob.value?.status === 'completed') await readPlugins()
        if (scanJob.value?.status === 'failed') { fail(Error(scanJob.value.error ?? 'VST3 scan failed')); scanJob.value.status = 'reported' }
      }
      if (!busy.value && Date.now() - lastStatusCheck > 800) {
        lastStatusCheck = Date.now()
        const current = await sdk.call<DocumentStatus>('document', { action: 'status' })
        if (current.revision !== revision.value) await readDocument()
        dirty.value = current.dirty; writable.value = current.writable
      }
    } catch (cause) { fail(cause) }
    finally { polling = false }
  }
  const unsubscribe = sdk.onContextChanged(context => { const shown = context.visible && !visible.value; visible.value = context.visible; if (shown) void safe(readDocument); if (shown && midiInput.value && session.value) void safe(() => engine('midiSelectName', { name: midiInput.value })) })
  watch(midiInput, value => { if (session.value) void safe(() => engine(value === null ? 'midiClose' : 'midiSelectName', value === null ? {} : { name: value })) })
  watch(monitoring, value => { if (session.value) void safe(() => engine('monitor', { enabled: value })) })
  watch([inputChannel, metronome], () => { if (session.value) void safe(() => engine('transport', { channel: inputChannel.value ?? -1, metronome: metronome.value })) })
  watch([midiOutput, midiClock], () => { if (session.value) void safe(() => engine('midiClock', { index: midiClock.value ? midiOutput.value ?? -1 : -1 })) })
  watch(selectedTrack, value => { if (document.value?.tracks.find(track => track.id === value)?.kind === 'instrument') midiTrack.value = value })
  watch(midiTrack, value => { if (session.value && !dirtyEngine) void safe(() => engine('liveTrack', { id: value })) })
  const saved = sdk.getState() as { dock?: DesignerDockState<string>; selectedTrack?: string; selectedPattern?: string } | undefined
  if (saved?.dock?.tools && Object.keys(dock.tools).every(key => saved.dock!.tools[key])) Object.assign(dock, saved.dock)
  watch(dock, value => sdk.setState({ dock: clone(value), selectedTrack: selectedTrack.value, selectedPattern: selectedPattern.value }), { deep: true })
  function preferenceValue() { return { dock: clone(dock), selectedTrack: selectedTrack.value, selectedPattern: selectedPattern.value, grid: grid.value, swing: swing.value } }
  let preferenceTimer: ReturnType<typeof setTimeout> | undefined
  watch([dock, selectedTrack, selectedPattern, grid, swing], () => {
    if (!preferencesReady) return
    clearTimeout(preferenceTimer); preferenceTimer = setTimeout(() => { void safe(() => call('settings', { value: preferenceValue() })) }, 600)
  }, { deep: true })
  async function waveform(path: string) {
    if (!waveforms[path]) waveforms[path] = await engine('inspect', { path }) as unknown as typeof waveforms[string]
    return waveforms[path]
  }
  async function exportMidi() { await writes; if (dirtyEngine) await loadEngine(); await call('midiFile', { action: 'export', path: exportPath.value || sdk.getContext().document!.path.replace(/\.dlmusic$/i, '.mid') }) }
  async function readGameTargets() {
    const result = await sdk.call<{ revision: number; entities: typeof gameTargets.value }>('document', { action: 'audioTargets', path: gameLevel.value })
    gameTargets.value = result.entities; gameRevision.value = result.revision; gameEntity.value = result.entities[0]?.id ?? null
  }
  async function assignGameAudio() {
    const asset = job.value?.output
    if (!asset || job.value?.status !== 'completed' || asset.includes(';')) throw Error('Choose a completed single-file export')
    const result = await sdk.call<{ path: string; revision: number }>('document', { action: 'assignAudio', path: gameLevel.value, revision: gameRevision.value, entity: gameEntity.value, event: gameEvent.value, asset, loop: gameLoop.value })
    gameRevision.value = result.revision; gameAssigned.value = result.path
  }
  async function recoverRecording(recording: typeof recoveries.value[number]) {
    const result = await call<{ frames: number; sampleRate: number }>('record', { action: 'recover', path: recording.path })
    await edit(value => {
      const audio = makeTrack('Recovered recording', 'audio')
      const start = Math.max(0, recording.startFrame - recording.latencyFrames)
      const trim = Math.min(Math.max(0, recording.latencyFrames - recording.startFrame), Math.max(0, result.frames - 1))
      const tick = Math.round(frameToTick(start, result.sampleRate, value.tempos))
      audio.clips.push({ id: uid('clip'), tick, length: Math.max(1, Math.round(frameToTick(start + result.frames - trim, result.sampleRate, value.tempos) - tick)), asset: recording.path, sourceFrame: trim, gain: 1, fadeIn: 0, fadeOut: 0 })
      value.tracks.push(audio); selectedTrack.value = audio.id
    })
    recoveries.value = recoveries.value.filter(item => item.path !== recording.path)
  }
  function parameterValue(track: Track, target: string, value?: number): number {
    const parts = target.split('/'), descriptor = parts[0] === 'fx' ? track.effects.find(effect => effect.id === parts[1]) : track.instrument
    if (target === 'gain' || target === 'pan') { if (value !== undefined) track[target] = value; return track[target] }
    if (!descriptor) return 0
    const key = parts.at(-1)!
    if (value !== undefined) descriptor.parameters[key] = value
    return descriptor.parameters[key] ?? (pluginParametersEffect.value === (parts[0] === 'fx' ? parts[1] : 'instrument') ? pluginParameters.value.find(parameter => String(parameter.id) === key)?.value : undefined) ?? 0
  }
  function beginGesture(track: Track, target: string) {
    if (gesture || gestureFinishing || !writable.value) return
    const writing = [...writingGestures.values()].find(item => item.track === track.id && item.target === target)
    if (writing) { gesture = writing; gesturePending = Promise.resolve(); return }
    const before = parameterValue(track, target)
    const value = displayParameter(track, target)
    gesture = { id: '', track: track.id, target, mode: 'read', before, value }
    const current = gesture
    gesturePending = (async () => {
      await writes; if (dirtyEngine) await loadEngine()
      const result = await call<{ id: string; mode: string }>('gesture', { action: 'begin', track: track.id, target, value })
      current.id = result.id; current.mode = result.mode
    })().catch(fail)
  }
  function previewParameter(track: Track, target: string, value: number) {
    if (!gesture) beginGesture(track, target)
    if (!gesture || gesture.track !== track.id || gesture.target !== target) return
    gesture.value = value; parameterValue(track, target, value)
    if (Date.now() - previewAt < 50) return
    previewAt = Date.now()
    const current = gesture
    gesturePending = gesturePending.then(async () => { if (current.id) await call('gesture', { action: 'change', id: current.id, value }) }).catch(fail)
  }
  async function completeGesture(current: Gesture, cancel = false) {
    const result = await call<{ points: Track['automation'][number]['points'] }>('gesture', { action: cancel ? 'cancel' : 'end', id: current.id })
    const target = document.value?.tracks.find(track => track.id === current.track)
    if (!target) return
    parameterValue(target, current.target, current.before)
    if (cancel) { dirtyEngine = true; return }
    await edit(() => {
      parameterValue(target, current.target, current.value)
      const lane = target.automation.find(lane => lane.target === current.target)
      if (lane && result.points.length) {
        const first = result.points[0]!.tick, last = result.points.at(-1)!.tick
        const restore = current.mode === 'touch' ? [{ tick: last + 1, value: automationAt(lane.points, last + 1, current.before), curve: 'linear' as const }] : []
        const anchor = first > 0 ? [{ tick: first - 1, value: automationAt(lane.points, first - 1, current.before), curve: 'step' as const }] : []
        lane.points = [...new Map([...lane.points.filter(point => point.tick < first || point.tick > last), ...anchor, ...result.points, ...restore].map(point => [point.tick, point])).values()].sort((a, b) => a.tick - b.tick)
      }
    })
  }
  let gestureFinishing: Promise<void> | undefined
  function finishGesture(cancel = false): Promise<void> {
    if (gestureFinishing) return gestureFinishing
    const current = gesture
    if (!current) return Promise.resolve()
    gestureFinishing = (async () => {
      await gesturePending; gesture = undefined
      if (!current.id) return
      await call('gesture', { action: 'change', id: current.id, value: cancel ? current.before : current.value })
      if (current.mode === 'write' && status.value.playing && !cancel) {
        const target = document.value?.tracks.find(track => track.id === current.track)
        if (target) { parameterValue(target, current.target, current.before); await edit(() => parameterValue(target, current.target, current.value)) }
        writingGestures.set(current.id, current)
      } else await completeGesture(current, cancel)
    })().finally(() => { gestureFinishing = undefined })
    return gestureFinishing
  }
  async function finishWriting() {
    for (const [id, current] of writingGestures) { writingGestures.delete(id); await completeGesture(current) }
  }
  function displayParameter(track: Track, target: string) {
    const lane = track.automation.find(lane => lane.target === target)
    const manual = gesture?.track === track.id && gesture.target === target || [...writingGestures.values()].some(item => item.track === track.id && item.target === target)
    return status.value.playing && lane && !manual ? automationAt(lane.points, tick.value, parameterValue(track, target)) : parameterValue(track, target)
  }
  void safe(async () => {
    const opened = await sdk.call<{ session: string }>('open', { path: sdk.getContext().document?.path })
    session.value = opened.session
    await readDocument()
    await loadEngine()
    devices.value = await engine('devices') as unknown as Devices
    await readPlugins()
    recoveries.value = (await call<{ recordings: typeof recoveries.value }>('record', { action: 'list' })).recordings
    const preferences = await call<ReturnType<typeof preferenceValue> & StudioPreferences>('settings')
    if (preferences.dock?.tools && Object.keys(dock.tools).every(key => preferences.dock.tools[key])) Object.assign(dock, preferences.dock)
    if (preferences.selectedTrack && document.value?.tracks.some(track => track.id === preferences.selectedTrack)) selectedTrack.value = preferences.selectedTrack
    if (preferences.selectedPattern && document.value?.patterns.some(pattern => pattern.id === preferences.selectedPattern)) selectedPattern.value = preferences.selectedPattern
    if ([120,240,480,960].includes(preferences.grid)) grid.value = preferences.grid
    followPlayhead.value = preferences.followPlayhead ?? true;
    swing.value = preferences.swing ?? 0; sampleRate.value = preferences.sampleRate ?? 48000; blockSize.value = preferences.blockSize ?? 256; exclusive.value = preferences.exclusive ?? false
    inputChannel.value = preferences.inputChannel ?? null; countIn.value = preferences.countIn ?? false; metronome.value = preferences.metronome ?? false
    output.value = devices.value.outputs.find(device => device.name === preferences.outputName)?.index ?? null
    input.value = devices.value.inputs.find(device => device.name === preferences.inputName)?.index ?? null
    midiOutput.value = devices.value.midiOutputs.find(device => device.name === preferences.midiOutputName)?.index ?? null
    await safe(configure)
    const akai = devices.value.midi.find(device => device.name === preferences.midiName)
    if (akai) midiInput.value = akai.name
    else if (preferences.midiName) midiInput.value = preferences.midiName
    preferencesReady = true
  })
  const timer = setInterval(() => { void poll() }, 50)
  onBeforeUnmount(() => { active = false; clearInterval(timer); clearTimeout(preferenceTimer); unsubscribe(); unsubscribeSave() })
  return { setPlaybackMode, followPlayhead, playbackMode, playbackBusy, trackAppearance, parameterDialog, document, revision, writable, dirty, session, error, busy, documentGesture, selectedTrack, selectedPattern, selectedNotes, grid, swing, main,
    status, devices, midiInput, midiOutput, midiClock, midiTrack, armedTrack, heldNotes, stepCursor, selectedClip, clip, waveforms, waveform, exportMidi, beginGesture, previewParameter, finishGesture, finishWriting, displayParameter, inputChannel, output, input, sampleRate, blockSize, exclusive, monitoring, midiRecording, overdub, recordQuantize, countIn, metronome, stepInput,
    importPath, exportPath, exportFormat, exportRegion, exportBits, exportTail, exportCrossfade, exportOverwrite, exportStart, exportEnd, gameLevel, gameEntity, gameEvent, gameLoop, gameTargets, gameAssigned, readGameTargets, assignGameAudio, captureChannels, recoveries, recoverRecording, writeConflict, conflictDraft, resolveConflict, job, plugins, pluginParameters, pluginParametersEffect, presetPath, scanJob, scanDirectory, retryPlugins, failedPlugins, saveAsPath, saveAs, dock, track, pattern, tick, arrangementTick, safe, call, edit, toggleMute, toggleSolo, engine, play, save, history, addTrack, addPattern,
    placePattern, addNote, deleteNotes, transpose, quantizeNotes, copyNotes, pasteNotes, masterInserts, deleteTrack, midiRecord, configure, recordAudio, render, importFile, scanPlugins, plugin, openPluginParameters, pluginParameterTotal, readPluginParameters, setPluginParameter,
  }
}
type PatternControllers = Array<{ tick: number; channel: number; controller: number; value: number }>
