<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { UISkeleton, UIButton, UIContextMenu, UIIcon, UIInfoTip, UIInput, UISelect, UIToolDock, vUITooltip as vTippy } from '@devline/ui-web/controls'
import { useStudio } from '../useStudio'
import { uid } from '../model'
import { sdk } from '../sdk'
import TrackAppearanceDialog from './TrackAppearanceDialog.vue'
import PluginParametersDialog from './PluginParametersDialog.vue'
import Arrangement from './Arrangement.vue'
import PianoRoll from './PianoRoll.vue'
import Mixer from './Mixer.vue'
import Automation from './Automation.vue'
import StudioProperties from './StudioProperties.vue'
import StudioDevices from './StudioDevices.vue'
import StudioInstruments from './StudioInstruments.vue'

const s = useStudio(), { t, locale } = useI18n()
watch(s.error, message => { void sdk.call('document', { action: 'notice', message: (message && s.status.value.engineError ? `${message} ${t('engineSaveAvailable')}` : message).slice(0, 1000) }).catch(() => {}) })
const statusItems = computed(() => s.status.value.engineError ? [{ id: 'audio-error', text: t('engineStopped'), title: `${s.status.value.engineError} ${t('engineSaveAvailable')}`, severity: 'error' }] : [
  { id: 'audio-format', text: `${s.status.value.sampleRate / 1000} kHz · ${t('stereo')}` },
  { id: 'audio-latency', text: `${s.status.value.latencyEstimated ? '~' : ''}${((s.status.value.latencyMs ?? 0) + (s.status.value.processingLatencyFrames ?? 0) / s.status.value.sampleRate * 1000).toFixed(1)} ms`, title: t('latency') },
  { id: 'audio-drops', text: `${t('droppedShort')}: ${s.status.value.dropped + (s.status.value.pluginMisses ?? 0)}`, title: t('dropped') },
  ...(s.status.value.renderStale ? [{ id: 'render-stale', text: t('renderStale'), severity: 'warning' }] : []),
])
let lastStatus = ''
watch(statusItems, items => { const text = JSON.stringify(items); if (text !== lastStatus) { lastStatus = text; void sdk.call('document', { action: 'statusItems', items }).catch(() => {}) } }, { immediate: true })
sdk.onContextChanged(context => { locale.value = context.locale.startsWith('ru') ? 'ru' : 'en' })
const tempo = computed({ get: () => String(s.document.value?.tempos[0]?.bpm ?? 112), set: value => { const bpm = Number(value); if (bpm >= 20 && bpm <= 999) void s.edit(doc => { doc.tempos[0]!.bpm = bpm }) } })
const dock = ref<InstanceType<typeof UIToolDock>>(), panelMenu = ref<{ x: number; y: number }>()
const dockItems = computed(() => ['piano', 'mixer', 'patterns', 'properties', 'instruments', 'devices', 'automation'].map(id => ({ id, label: t(id), icon: id === 'piano' ? 'music-note-beamed' : id === 'mixer' ? 'sliders' : id === 'properties' ? 'sliders' : id === 'automation' ? 'bezier2' : 'grid' })))
const dockLabels = computed(() => Object.fromEntries(['properties','components','structure','move','resize','left','right','top','bottom','close','pin','unpin','hideTab','showTab','contextMenu','autoHide'].map(key => [key, t(key)])) as { properties: string; components: string; move: string; left: string; right: string; top: string; bottom: string })
function toggleStep(pitch: number, step: number) {
  void s.edit(() => {
    const pattern = s.pattern.value
    if (!pattern) return
    const tick = step * 240, existing = pattern.notes.find(note => note.pitch === pitch && note.tick === tick)
    if (tick >= pattern.length) return
    if (existing) pattern.notes = pattern.notes.filter(note => note !== existing)
    else pattern.notes.push({ id: uid('note'), pitch, tick, duration: Math.min(120, pattern.length - tick), velocity: 100, channel: 9 })
  })
}
const panelItems = computed(() => dockItems.value.map(item => ({ id: item.id, label: item.label, checked: s.dock.tools[item.id]?.visible ?? false })))
function showPanels(event: MouseEvent) { const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect(); panelMenu.value = { x: bounds.left, y: bounds.bottom } }
function restore(id: string) { dock.value?.show(id) }
async function openSettings() { await sdk.call('host.openSettings', {}) }
function togglePanel(id: string) { if (!s.dock.tools[id]) return; if (s.dock.tools[id]!.visible) dock.value?.hide(id); else restore(id) }
async function stop() { await s.finishGesture(); await s.finishWriting(); if (s.midiRecording.value) await s.midiRecord(); if (s.status.value.recording) await s.recordAudio(); await s.engine('stop'); s.heldNotes.clear() }
function key(event: KeyboardEvent) {
  const target = event.target as Element
  if (target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"],[role="dialog"]')) return
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') { event.preventDefault(); if (event.shiftKey) restore('devices'); else void s.safe(s.save) }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') { event.preventDefault(); void s.safe(() => s.history(event.shiftKey ? 'redo' : 'undo')) }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') { event.preventDefault(); void s.safe(() => s.history('redo')) }
  if (event.code === 'Space' && !event.repeat) { event.preventDefault(); void s.safe(s.play) }
}
</script>

<template>
  <main class="sound-studio" tabindex="0" @keydown="key" @pointerdown="event => { if (!(event.target as Element).closest('input,textarea,select,button,[role=combobox]')) (event.currentTarget as HTMLElement).focus({ preventScroll: true }) }">
    <div v-if="s.writeConflict.value" class="studio-toolbar" role="alert"><span>{{ t('documentConflict') }}</span><span class="is-selectable">{{ s.conflictDraft.value }}</span><UIButton @click="s.safe(() => s.resolveConflict(false))">{{ t('useWorkspace') }}</UIButton><UIButton @click="s.safe(() => s.resolveConflict(true))">{{ t('useLocal') }}</UIButton></div>
    <header class="studio-toolbar studio-transport">
      <UIButton :aria-label="s.status.value.playing ? t('pause') : t('play')" v-tippy="s.status.value.playing ? t('pause') : t('play')" :disabled="!s.document.value" @click="s.safe(s.play)"><UIIcon :name="s.status.value.playing ? 'pause-fill' : 'play-fill'" /></UIButton>
      <UIButton :aria-label="t('stop')" v-tippy="t('stop')" @click="s.safe(stop)"><UIIcon name="stop-fill" /></UIButton>
      <UIButton :aria-label="t('recordMidi')" v-tippy="t('recordMidi')" :aria-pressed="s.midiRecording.value" :disabled="!s.writable.value" @click="s.safe(s.midiRecord)"><UIIcon name="record-circle" /></UIButton>
      <UIButton :aria-label="t('recordAudio')" v-tippy="t('recordAudio')" :aria-pressed="s.status.value.recording" :disabled="!s.writable.value || s.input.value === null || !s.document.value?.tracks.some(track => track.kind === 'audio' && track.id === s.armedTrack.value)" @click="s.safe(s.recordAudio)"><UIIcon name="mic" /></UIButton>
      <UIButton :aria-label="t('panic')" v-tippy="t('panic')" @click="s.safe(() => s.engine('panic'))"><UIIcon name="volume-mute" /></UIButton>
      <span class="studio-divider"></span>
      <UISelect class="studio-playback-mode" v-tippy="t('playbackModeHelp')" :model-value="s.playbackMode.value" :options="[{ value: 'song', label: t('songPlayback') }, { value: 'pattern', label: t('patternPlayback'), disabled: s.track.value?.kind !== 'instrument' || !s.pattern.value }]" :aria-label="t('playbackMode')" :disabled="s.playbackBusy.value || s.midiRecording.value || s.status.value.recording" @update:model-value="value => s.safe(() => s.setPlaybackMode(String(value)))" />
      <output class="studio-position">{{ String(Math.floor(s.tick.value / 3840) + 1).padStart(3, '0') }} : {{ String(Math.floor(s.tick.value / 960) % 4 + 1).padStart(2, '0') }}</output>
      <label class="studio-tempo"><UIInput v-model="tempo" type="number" :aria-label="t('tempo')" :disabled="!s.writable.value" />BPM</label>
      <UIButton v-if="s.document.value" :aria-label="t('loop')" :aria-pressed="s.document.value.loop.enabled" @click="s.edit(doc => { doc.loop.enabled = !doc.loop.enabled })"><UIIcon name="repeat" /></UIButton>
      <UIButton :aria-label="t('followPlayhead')" v-tippy="t('followPlayhead')" :aria-pressed="s.followPlayhead.value" @click="s.followPlayhead.value = !s.followPlayhead.value"><UIIcon name="cursor" /></UIButton>
      <span class="studio-spacer"></span>
      <UIButton :aria-label="t('settings')" v-tippy="t('settings')" @click="s.safe(openSettings)"><UIIcon name="gear" /></UIButton>
      <UIButton :aria-label="t('undo')" v-tippy="t('undo')" @click="s.safe(() => s.history('undo'))"><UIIcon name="arrow-counterclockwise" /></UIButton>
      <UIButton :aria-label="t('redo')" v-tippy="t('redo')" @click="s.safe(() => s.history('redo'))"><UIIcon name="arrow-clockwise" /></UIButton>
      <UIButton :disabled="!s.document.value" aria-haspopup="menu" :aria-expanded="!!panelMenu" @click="showPanels"><UIIcon name="layout-sidebar" />{{ t('panels') }}</UIButton>
      <UIButton :disabled="!s.document.value" @click="restore('devices')"><UIIcon name="hdd" />{{ t('export') }}</UIButton>
    </header>
    <UIToolDock v-if="s.document.value" ref="dock" :state="s.dock" side-panels-full-height :tool-items="dockItems" :labels="dockLabels">
      <template #main>
        <div class="studio-main">
          <nav class="studio-toolbar" :aria-label="t('editors')">
            <UIButton :aria-pressed="s.main.value === 'arrangement'" @click="s.main.value = 'arrangement'">{{ t('arrangement') }}</UIButton>
            <UIButton :aria-pressed="s.main.value === 'piano'" @click="s.main.value = 'piano'">{{ t('piano') }}</UIButton>
            <span class="studio-spacer"></span>
            <UISelect v-model="s.selectedPattern.value" :options="s.document.value.patterns.map(pattern => ({ label: pattern.name, value: pattern.id }))" :aria-label="t('pattern')" />
            <UIInfoTip :label="t('pattern')" :text="t('patternPlacementHelp')" />
            <UIButton :aria-label="t('addPattern')" @click="s.addPattern()"><UIIcon name="plus" /></UIButton>
            <UIButton :aria-label="t('duplicatePattern')" @click="s.addPattern(true)"><UIIcon name="copy" /></UIButton>
          </nav>
          <Arrangement v-if="s.main.value === 'arrangement'" :studio="s" />
          <PianoRoll v-else :studio="s" />
        </div>
      </template>
      <template #piano><PianoRoll :studio="s" /></template>
      <template #mixer><Mixer :studio="s" /></template>
      <template #automation><Automation :studio="s" /></template>
      <template #patterns>
        <section class="studio-patterns">
          <div class="studio-toolbar"><UIButton :disabled="!s.writable.value" @click="s.addPattern()"><UIIcon name="plus" /></UIButton><UIButton :disabled="!s.pattern.value || !s.writable.value" @click="s.addPattern(true)"><UIIcon name="copy" /></UIButton></div>
          <button v-for="pattern in s.document.value.patterns" :key="pattern.id" class="studio-pattern-row" :class="{ selected: pattern.id === s.selectedPattern.value }" @click="s.selectedPattern.value = pattern.id"><UIIcon name="music-note-list" />{{ pattern.name }}<small>{{ pattern.notes.length }}</small></button>
          <div v-if="s.pattern.value" class="studio-step-sequencer">
            <div v-for="pitch in [36,38,42,46]" :key="pitch" class="studio-step-row"><span>{{ pitch }}</span><button v-for="step in 16" :key="step" :aria-label="`${t('step')} ${step}, MIDI ${pitch}`" :aria-pressed="s.pattern.value.notes.some(note => note.pitch === pitch && note.tick === (step - 1) * 240)" @click="toggleStep(pitch, step - 1)"></button></div>
          </div>
        </section>
      </template>
      <template #properties><StudioProperties :studio="s" /></template>
      <template #instruments><StudioInstruments :studio="s" /></template>
      <template #devices><StudioDevices :studio="s" /></template>
    </UIToolDock>
    <div v-else-if="s.error.value" class="studio-loading" role="alert">{{ s.error.value }}</div><UISkeleton v-else variant="settings" :label="t('loading')" />
    <UIContextMenu v-if="panelMenu" :x="panelMenu.x" :y="panelMenu.y" :items="panelItems" :label="t('panels')" @select="togglePanel" @close="panelMenu = undefined" />
    <TrackAppearanceDialog :studio="s" />
    <PluginParametersDialog :studio="s" />
  </main>
</template>
