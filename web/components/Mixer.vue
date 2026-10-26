<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { UIButton, UISelect, UISlider, vUITooltip as vTippy } from '@devline/ui-web'
import TrackHeader from './TrackHeader.vue'
import type { useStudio } from '../useStudio'

const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n()
const db = (gain: number) => gain > 0 ? `${(20 * Math.log10(gain)).toFixed(1)} dB` : '−∞ dB'
let masterBefore: number | undefined, masterPreviewAt = 0
function previewMaster(value: number) {
  if (!s.document.value || !s.writable.value) return
  masterBefore ??= s.document.value.masterGain ?? 1
  s.documentGesture.value = true; s.document.value.masterGain = value
  if (Date.now() - masterPreviewAt >= 50) { masterPreviewAt = Date.now(); void s.safe(() => s.engine('parameter', { track: 'master', target: 'gain', value })) }
}
function finishMaster(cancel = false) {
  if (masterBefore === undefined || !s.document.value) return
  const before = masterBefore, value = cancel ? before : s.document.value.masterGain ?? 1
  masterBefore = undefined; s.documentGesture.value = false; s.document.value.masterGain = before
  void s.safe(() => s.engine('parameter', { track: 'master', target: 'gain', value }))
  if (!cancel && value !== before) void s.edit(doc => { doc.masterGain = value })
}
</script>

<template>
  <div class="studio-mixer">
    <section v-if="s.document.value" class="studio-mixer-channel studio-master">
      <strong>Master</strong>
      <div class="studio-mixer-strip"><UISlider :model-value="s.document.value.masterGain ?? 1" :min="0" :max="2" :step=".01" orientation="vertical" :disabled="!s.writable.value" :aria-label="t('gain') + ' Master'" @update:model-value="previewMaster" @change="finishMaster()" @keydown.esc="finishMaster(true)" @pointercancel="finishMaster(true)" /><div class="studio-meter"><i :style="{ height: `${Math.min(1, s.status.value.meters.master ?? 0) * 100}%` }"></i></div></div>
      <output>{{ db(s.document.value.masterGain ?? 1) }}</output>
      <UIButton :disabled="!s.writable.value" @click="s.masterInserts()">{{ t('effects') }}</UIButton>
    </section>
    <section v-for="track in s.document.value?.tracks ?? []" :key="track.id" class="studio-mixer-channel" :class="{ selected: s.selectedTrack.value === track.id }" @click="s.selectedTrack.value = track.id">
      <TrackHeader :studio="s" :track="track" compact />
      <div class="studio-mixer-strip">
        <UISlider :model-value="s.displayParameter(track, 'gain')" :min="0" :max="2" :step=".01" orientation="vertical" :disabled="!s.writable.value" :aria-label="`${t('gain')} ${track.name}`" @pointerdown="s.beginGesture(track, 'gain')" @update:model-value="value => s.previewParameter(track, 'gain', value)" @change="s.safe(() => s.finishGesture())" @keydown.esc="s.safe(() => s.finishGesture(true))" />
        <div class="studio-meter" role="meter" :aria-label="track.name" :aria-valuenow="Math.round((s.status.value.meters[track.id] ?? 0) * 100)" aria-valuemin="0" aria-valuemax="100"><i :style="{ height: `${Math.min(1, s.status.value.meters[track.id] ?? 0) * 100}%` }"></i></div>
      </div>
      <output>{{ db(track.gain) }}</output>
      <UISlider :model-value="s.displayParameter(track, 'pan')" :min="-1" :max="1" :step=".01" :disabled="!s.writable.value" :aria-label="`${t('pan')} ${track.name}`" @pointerdown="s.beginGesture(track, 'pan')" @update:model-value="value => s.previewParameter(track, 'pan', value)" @change="s.safe(() => s.finishGesture())" @keydown.esc="s.safe(() => s.finishGesture(true))" />
      <div class="studio-mixer-actions"><UIButton :aria-pressed="track.muted" :aria-label="`${t('mute')} ${track.name}`" :disabled="!s.writable.value" v-tippy="t('muteHint')" @click="s.toggleMute(track.id, $event.altKey)">M</UIButton><UIButton :aria-pressed="track.solo" :aria-label="`${t('solo')} ${track.name}`" :disabled="!s.writable.value" @click="s.toggleSolo(track.id)">S</UIButton></div>
      <UISelect :model-value="track.output" :options="[{ label: 'Master', value: 'master' }, ...(s.document.value?.tracks.filter(bus => bus.kind === 'bus' && bus.id !== track.id).map(bus => ({ label: bus.name, value: bus.id })) ?? [])]" :aria-label="t('output')" @update:model-value="value => s.edit(() => { track.output = String(value) })" />
    </section>
  </div>
</template>
