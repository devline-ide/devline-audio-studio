<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UIIcon, UIContextMenu, vUITooltip as vTippy } from '@devline/ui-web/controls'
import { clone, uid, type Track } from '../model'
import { trackIcon, trackColor } from '../trackAppearance'
import type { useStudio } from '../useStudio'
const { studio: s, track, compact = false } = defineProps<{ studio: ReturnType<typeof useStudio>; track: Track; compact?: boolean }>()
const { t } = useI18n(), menu = ref<{ x: number; y: number }>()
const locked = computed(() => !s.writable.value || s.midiRecording.value || s.status.value.recording)
const items = computed(() => [
  { id: 'appearance', label: t('trackAppearance'), disabled: locked.value },
  { id: 'mute', label: t(track.muted ? 'unmute' : 'mute'), disabled: !s.writable.value },
  { id: 'solo', label: t(track.solo ? 'unsolo' : 'solo'), disabled: !s.writable.value },
  { id: 'duplicate', label: t('duplicate'), dividerBefore: true, disabled: locked.value },
  { id: 'delete', label: t('deleteTrack'), danger: true, disabled: locked.value },
])
function open(event: MouseEvent | KeyboardEvent) {
  event.preventDefault(); event.stopPropagation(); s.selectedTrack.value = track.id
  const node = event.currentTarget as HTMLElement, bounds = node.getBoundingClientRect()
  node.focus({ preventScroll: true })
  menu.value = { x: event instanceof MouseEvent ? event.clientX : bounds.left, y: event instanceof MouseEvent ? event.clientY : bounds.bottom }
}
function appearance() { if (!locked.value) { s.selectedTrack.value = track.id; s.trackAppearance.value = track.id } }
function action(id: string) {
  menu.value = undefined; s.selectedTrack.value = track.id
  if (id === 'appearance') appearance()
  else if (id === 'mute') void s.toggleMute(track.id)
  else if (id === 'solo') void s.toggleSolo(track.id)
  else if (!locked.value && id === 'delete') void s.deleteTrack()
  else if (!locked.value && id === 'duplicate') void s.edit(doc => {
    const copy = clone(track); copy.id = uid('track'); copy.name = `${track.name} (${t('copy')})`
    copy.clips.forEach(clip => { clip.id = uid('clip') }); copy.effects.forEach(effect => {
      const old = effect.id; effect.id = uid('fx')
      copy.automation.forEach(lane => { if (lane.target.startsWith(`fx/${old}/`)) lane.target = lane.target.replace(`fx/${old}/`, `fx/${effect.id}/`) })
    })
    doc.tracks.splice(doc.tracks.findIndex(item => item.id === track.id) + 1, 0, copy); s.selectedTrack.value = copy.id
  })
}
function key(event: KeyboardEvent) {
  if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') open(event)
  else if (event.key === 'F2') { event.preventDefault(); event.stopPropagation(); appearance() }
}
</script>
<template>
  <div class="studio-track-label" :class="{ compact }" :style="{ '--track-color': trackColor(track) }" tabindex="0" :aria-label="track.name" @click="s.selectedTrack.value = track.id" @contextmenu="open" @keydown="key" @keydown.enter.self="appearance">
    <button class="studio-track-name" @dblclick.stop="appearance" @click="s.selectedTrack.value = track.id"><UIIcon :name="trackIcon(track)" /><span>{{ track.name }}</span></button>
    <div v-if="!compact" class="studio-track-controls"><small>{{ t(track.kind) }}</small><UIButton :aria-pressed="track.muted" :disabled="!s.writable.value" :aria-label="`${t('mute')} ${track.name}`" v-tippy="t('muteHint')" @click.stop="s.toggleMute(track.id, $event.altKey)">M</UIButton><UIButton :aria-pressed="track.solo" :disabled="!s.writable.value" :aria-label="`${t('solo')} ${track.name}`" v-tippy="t('solo')" @click.stop="action('solo')">S</UIButton><UIButton :aria-label="t('trackAppearance')" v-tippy="t('trackAppearance')" :disabled="locked" @click.stop="appearance"><UIIcon name="three-dots" /></UIButton></div>
  </div>
  <UIContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="items" :label="t('track')" @select="action" @close="menu = undefined" />
</template>
