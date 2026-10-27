<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UICheckbox, UIIcon, UIInput, UISelect, UISlider, UISpoiler, UIPropertyColumns, UIPropertyRow } from '@devline/ui-web/controls'
import type { useStudio } from '../useStudio'
import { uid, type Track } from '../model'
const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n()
const patternName = computed({ get: () => s.pattern.value?.name ?? '', set: name => { void s.edit(() => { if (s.pattern.value) s.pattern.value.name = name }) } })
const trackName = computed({ get: () => s.track.value?.name ?? '', set: name => { void s.edit(() => { if (s.track.value) s.track.value.name = name }) } })
const asset = computed({ get: () => s.track.value?.instrument.asset ?? '', set: path => { void s.edit(() => { if (s.track.value) s.track.value.instrument.asset = path || undefined }) } })
const clipBars = computed({ get: () => String((s.clip.value?.length ?? 3840) / 3840), set: value => {
  const length = Math.round(Number(value) * 3840)
  if (!Number.isFinite(length) || length < 240 || length > 960 * 60 * 60 * 24) return
  void s.edit(() => { const clip = s.clip.value; if (clip) { clip.length = length; clip.fadeIn = Math.min(clip.fadeIn, length); clip.fadeOut = Math.min(clip.fadeOut, length) } })
} })
function fitPattern() {
  const length = s.document.value?.patterns.find(pattern => pattern.id === s.clip.value?.pattern)?.length
  if (length) clipBars.value = String(length / 3840)
}
function selectPlugin(value: string | number | null) {
  void s.edit(() => { const instrument = s.track.value?.instrument; if (instrument && instrument.plugin !== value) { instrument.plugin = value === null ? undefined : String(value); delete instrument.state; instrument.parameters = {}; s.pluginParameters.value = [] } })
}
const instruments = ['synth', 'sampler', 'drums', 'sfx'] as const
function selectInstrument(value: string | number | null) {
  if (![...instruments, 'vst3'].includes(String(value))) return
  void s.edit(() => { s.track.value!.instrument.kind = value as Track['instrument']['kind'] })
}
const patternLength = computed({ get: () => String(s.pattern.value?.length ?? 3840), set: value => { const length = Math.max(240, Math.min(960 * 60 * 60, Math.round(Number(value)))); if (!Number.isFinite(length)) return; void s.edit(() => { if (s.pattern.value) { s.pattern.value.length = length; s.pattern.value.notes = s.pattern.value.notes.filter(note => note.tick < length).map(note => ({ ...note, duration: Math.min(note.duration, length - note.tick) })); s.pattern.value.controllers = s.pattern.value.controllers.filter(event => event.tick < length); s.pattern.value.events = s.pattern.value.events.filter(event => event.tick < length) } }) } })
const effectKinds = ['filter', 'eq', 'compressor', 'limiter', 'distortion', 'delay', 'reverb']
function effect(kind: string) {
  void s.edit(() => s.track.value?.effects.push({ id: uid('fx'), kind, bypass: false, parameters: kind === 'filter' ? { cutoff: 4000 } : kind === 'eq' ? { low: 0, mid: 0, high: 0 } : kind === 'distortion' ? { drive: 3 } : kind === 'compressor' ? { threshold: .25, ratio: 4 } : kind === 'vst3' ? {} : kind === 'reverb' ? { wet: .25, room: .6 } : { wet: .25, feedback: .35 } }))
}
</script>
<template>
<UIPropertyColumns v-if="s.track.value && s.document.value" class="ui-form-properties studio-property-grid" data-ui-hover-scope="properties" :label="t('resizeColumns')">
<UISpoiler :label="t('track')">
<template #actions><UIButton variant="quiet" :aria-label="t('deleteTrack')" :disabled="!s.writable.value || s.midiRecording.value || s.status.value.recording" @click="s.deleteTrack()"><UIIcon name="trash" :size="13" /></UIButton></template>
<UIPropertyRow :label="(t('name'))"><UIInput :aria-label="(t('name'))" v-model="trackName" variant="property" :disabled="!s.writable.value" /></UIPropertyRow>
          <UIPropertyRow :label="t('trackAppearance')"><UIButton variant="property" :disabled="!s.writable.value" @click="s.trackAppearance.value = s.selectedTrack.value"><span>{{ t('change') }}</span><UIIcon name="three-dots" :size="13" /></UIButton></UIPropertyRow>
          <UIPropertyRow v-if="s.track.value.kind === 'audio'" :label="t('armRecording')"><UICheckbox :model-value="s.armedTrack.value === s.selectedTrack.value" :disabled="s.status.value.recording || !s.writable.value" @update:model-value="value => s.armedTrack.value = value ? s.selectedTrack.value : ''" :aria-label="t('armRecording')" /></UIPropertyRow>
</UISpoiler>
<UISpoiler :label="t('clip')" v-if="s.clip.value">
<UIPropertyRow :label="t('clipBars')"><UIInput v-model="clipBars" variant="property" type="number" :min="0.0625" :step="0.25" :aria-label="t('clipBars')" :disabled="!s.writable.value" /></UIPropertyRow>
<UIPropertyRow v-if="s.clip.value?.pattern" :label="t('pattern')"><UIButton variant="property" :disabled="!s.writable.value" @click="fitPattern">{{ t('fitPatternLength') }}</UIButton></UIPropertyRow>
<template v-if="s.clip.value?.asset">
            <UIPropertyRow :label="(t('gain'))"><UIInput variant="property" :aria-label="(t('gain'))" :model-value="String(s.clip.value.gain)" type="number" @update:model-value="value => s.edit(() => { s.clip.value!.gain = Math.max(0, Math.min(4, Number(value))) })" /></UIPropertyRow>
            <UIPropertyRow :label="(t('fadeIn'))"><UIInput variant="property" :aria-label="(t('fadeIn'))" :model-value="String(s.clip.value.fadeIn)" type="number" @update:model-value="value => s.edit(() => { s.clip.value!.fadeIn = Math.max(0, Math.min(s.clip.value!.length, Math.round(Number(value)))) })" /></UIPropertyRow>
            <UIPropertyRow :label="(t('fadeOut'))"><UIInput variant="property" :aria-label="(t('fadeOut'))" :model-value="String(s.clip.value.fadeOut)" type="number" @update:model-value="value => s.edit(() => { s.clip.value!.fadeOut = Math.max(0, Math.min(s.clip.value!.length, Math.round(Number(value)))) })" /></UIPropertyRow>
          </template>
</UISpoiler>
<UISpoiler :label="t('instrument')" >
<UIPropertyRow :label="(t('instrument'))"><UISelect :aria-label="(t('instrument'))" :model-value="s.track.value.instrument.kind" :options="[...instruments, 'vst3'].map(value => ({ label: t(value), value }))" :disabled="!s.writable.value" @update:model-value="selectInstrument" /></UIPropertyRow>
          <UIPropertyRow v-if="s.track.value.instrument.kind === 'synth'" :label="(t('waveform'))"><UISelect :aria-label="(t('waveform'))" :model-value="s.track.value.instrument.waveform" :options="['sine','saw','square','triangle','noise'].map(value => ({ label: t(value), value }))" @update:model-value="value => s.edit(() => { s.track.value!.instrument.waveform = String(value) })" /></UIPropertyRow>
          <UIPropertyRow v-if="s.track.value.instrument.kind === 'sampler'" :label="(t('sample'))"><UIInput variant="property" :aria-label="(t('sample'))" v-model="asset" :placeholder="'src/resources/sample.wav'" /></UIPropertyRow>
          <template v-if="['synth','sfx'].includes(s.track.value.instrument.kind)">
            <UIPropertyRow v-for="parameter in ['attack','release', ...(s.track.value.instrument.kind === 'sfx' ? ['noise','sweep'] : [])]" :key="parameter" :label="(t(parameter))"><UIInput variant="property" :aria-label="(t(parameter))" :model-value="String(s.track.value.instrument.parameters[parameter] ?? (parameter === 'attack' ? .005 : parameter === 'release' ? .04 : parameter === 'noise' ? .4 : 350))" type="number" @update:model-value="value => s.edit(() => { s.track.value!.instrument.parameters[parameter] = Math.max(0, Math.min(parameter === 'sweep' ? 4000 : parameter === 'noise' ? 1 : 10, Number(value))) })" /></UIPropertyRow>
          </template>
          <template v-if="s.track.value.instrument.kind === 'drums'"><UIPropertyRow v-for="pitch in [36,38,42,46]" :key="pitch" :label="'MIDI ' + pitch"><UIInput variant="property" :aria-label="'MIDI ' + pitch" :model-value="s.track.value.instrument.pads?.[pitch] ?? ''" :placeholder="t('sample')" @update:model-value="value => s.edit(() => { const pads = s.track.value!.instrument.pads ??= {}; if (value) pads[pitch] = value; else delete pads[pitch] })" /></UIPropertyRow></template>
          <template v-if="s.track.value.instrument.kind === 'vst3'">
            <UIPropertyRow :label="t('vst3')"><UISelect :model-value="s.track.value.instrument.plugin" :options="s.plugins.value.filter(plugin => plugin.instrument).map(plugin => ({ label: plugin.name, value: plugin.id }))" :aria-label="t('vst3')" @update:model-value="selectPlugin" /></UIPropertyRow>
            <UIPropertyRow :label="t('pluginEditor')"><UIButton variant="property" :aria-label="t('pluginEditor')" @click="s.safe(() => s.plugin('editor'))"><span>{{ t('openProperty') }}</span><UIIcon name="three-dots" :size="13" /></UIButton></UIPropertyRow><UIPropertyRow :label="t('parameters')"><UIButton variant="property" :aria-label="t('parameters')" @click="s.openPluginParameters()"><span>{{ t('openProperty') }}</span><UIIcon name="three-dots" :size="13" /></UIButton></UIPropertyRow>
            
          </template>
</UISpoiler>
<UISpoiler :label="t('pattern')" >
<UIPropertyRow :label="(t('name'))"><UIInput :aria-label="(t('name'))" v-model="patternName" variant="property" :disabled="!s.pattern.value || !s.writable.value" /></UIPropertyRow>
          <UIPropertyRow :label="(t('length'))"><UIInput :aria-label="(t('length'))" v-model="patternLength" variant="property" type="number" :disabled="!s.pattern.value || !s.writable.value" /></UIPropertyRow>
          <UIPropertyRow :label="(t('swing'))"><UISlider v-model="s.swing.value" :min="0" :max=".75" :step=".01" :aria-label="t('swing')" /></UIPropertyRow>
          <UIPropertyRow :label="(t('loopStart'))"><UIInput variant="property" :aria-label="(t('loopStart'))" :model-value="String(s.document.value.loop.start)" type="number" @update:model-value="value => s.edit(doc => { doc.loop.start = Math.max(0, Math.min(doc.loop.end - 1, Math.round(Number(value)))) })" /></UIPropertyRow>
          <UIPropertyRow :label="(t('loopEnd'))"><UIInput variant="property" :aria-label="(t('loopEnd'))" :model-value="String(s.document.value.loop.end)" type="number" @update:model-value="value => s.edit(doc => { doc.loop.end = Math.max(doc.loop.start + 1, Math.round(Number(value))) })" /></UIPropertyRow>
</UISpoiler>
<UISpoiler :label="t('sends')" >
<div v-for="(send, index) in s.track.value.sends" :key="index" class="studio-effect">
            <UIPropertyRow :label="t('output')"><UISelect :model-value="send.track" :options="s.document.value.tracks.filter(track => track.id !== s.selectedTrack.value && (send.sidechain || track.kind === 'bus')).map(track => ({ label: track.name, value: track.id }))" :aria-label="t('output')" @update:model-value="value => s.edit(() => { send.track = String(value) })" /></UIPropertyRow>
            <UIPropertyRow :label="t('gain')"><UIInput variant="property" type="number" :model-value="String(send.gain)" :aria-label="t('gain')" @update:model-value="value => s.edit(() => { send.gain = Math.max(0, Math.min(2, Number(value))) })" /></UIPropertyRow>
            <UIPropertyRow :label="(t('sidechain'))"><UICheckbox :model-value="send.sidechain" @update:model-value="value => s.edit(() => { if (!value && s.document.value!.tracks.find(track => track.id === send.track)?.kind !== 'bus') return; send.sidechain = value })" :aria-label="(t('sidechain'))" /></UIPropertyRow>
            <UIButton variant="quiet" :aria-label="t('delete')" @click="s.edit(() => { s.track.value!.sends.splice(index, 1) })"><UIIcon name="x" /></UIButton>
          </div>
          <UIButton variant="property" :disabled="!s.document.value.tracks.some(track => track.id !== s.selectedTrack.value)" @click="s.edit(() => { const destination = s.document.value!.tracks.find(track => track.id !== s.selectedTrack.value); if (destination) s.track.value!.sends.push({ track: destination.id, gain: 1, sidechain: destination.kind !== 'bus' }) })">+ {{ t('sends') }}</UIButton>
</UISpoiler>
<UISpoiler :label="t('effects')" >
<div v-for="fx in s.track.value.effects" :key="fx.id" class="studio-effect">
            <UIPropertyRow :label="(t(fx.kind))"><UICheckbox :model-value="!fx.bypass" @update:model-value="value => s.edit(() => { fx.bypass = !value })" :aria-label="(t(fx.kind))" /><UIButton variant="quiet" :aria-label="t('delete')" @click="s.edit(() => { s.track.value!.effects = s.track.value!.effects.filter(effect => effect !== fx) })"><UIIcon name="x" /></UIButton></UIPropertyRow>
            <template v-if="fx.kind === 'vst3'"><UIPropertyRow :label="t('vst3')"><UISelect :model-value="fx.plugin" :options="s.plugins.value.filter(plugin => !plugin.instrument).map(plugin => ({ label: plugin.name, value: plugin.id }))" :aria-label="t('vst3')" @update:model-value="value => s.edit(() => { fx.plugin = String(value); delete fx.state; fx.parameters = {} })" /></UIPropertyRow><UIPropertyRow :label="t('pluginEditor')"><UIButton variant="property" :aria-label="t('pluginEditor')" @click="s.safe(() => s.plugin('editor', {}, fx.id))"><span>{{ t('openProperty') }}</span><UIIcon name="three-dots" :size="13" /></UIButton></UIPropertyRow><UIPropertyRow :label="t('parameters')"><UIButton variant="property" :aria-label="t('parameters')" @click="s.openPluginParameters(fx.id)"><span>{{ t('openProperty') }}</span><UIIcon name="three-dots" :size="13" /></UIButton></UIPropertyRow></template>
            <template v-else><UIPropertyRow v-for="(_value, parameter) in fx.parameters" :key="parameter" :label="(t(parameter))"><UISlider :model-value="fx.parameters[parameter]!" :min="['low','mid','high'].includes(parameter) ? -24 : 0" :max="parameter === 'cutoff' ? 18000 : parameter === 'drive' ? 12 : parameter === 'ratio' ? 20 : ['low','mid','high'].includes(parameter) ? 24 : 1" :step="parameter === 'cutoff' ? 10 : .01" :aria-label="t(parameter)" @pointerdown="s.beginGesture(s.track.value!, `fx/${fx.id}/${parameter}`)" @update:model-value="value => s.previewParameter(s.track.value!, `fx/${fx.id}/${parameter}`, value)" @change="s.safe(() => s.finishGesture())" @keydown.esc="s.safe(() => s.finishGesture(true))" /></UIPropertyRow></template>
          </div>
          <UIPropertyRow :label="t('addEffect')"><UISelect :aria-label="t('addEffect')" :model-value="null" :options="[...effectKinds, 'vst3'].map(value => ({ label: t(value), value }))" :placeholder="t('chooseEffect')" :disabled="!s.writable.value" @update:model-value="value => value && effect(String(value))" /></UIPropertyRow>
</UISpoiler>
<UISpoiler v-if="s.track.value.instrument.kind === 'vst3' || s.track.value.effects.some(effect => effect.kind === 'vst3')" :label="t('preset')"><UIPropertyRow :label="t('projectPath')"><UIInput variant="property" v-model="s.presetPath.value" :aria-label="t('projectPath')" placeholder="src/audio/presets/Lead.dlpreset" /></UIPropertyRow><div class="studio-toolbar"><UIButton variant="property" :disabled="!s.presetPath.value || !s.writable.value" @click="s.safe(() => s.plugin('presetSave', { path: s.presetPath.value }, s.pluginParametersEffect.value))">{{ t('save') }}</UIButton><UIButton variant="property" :disabled="!s.presetPath.value || !s.writable.value" @click="s.safe(() => s.plugin('presetLoad', { path: s.presetPath.value }, s.pluginParametersEffect.value))">{{ t('loadPreset') }}</UIButton></div></UISpoiler>
</UIPropertyColumns>
</template>
