<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UIIcon, UISelect, UISlider } from '@devline/ui-web/controls'
import { clone, type Note } from '../model'
import type { useStudio } from '../useStudio'
import { useFollowPlayhead } from '../useFollowPlayhead'

const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n()
const canvas = ref<HTMLElement>()
const scroll = ref<HTMLElement>()
const viewport = reactive({ top: 992, left: 0, width: 700, height: 240 })
function updateViewport() { if (scroll.value) Object.assign(viewport, { top: scroll.value.scrollTop, left: scroll.value.scrollLeft, width: scroll.value.clientWidth, height: scroll.value.clientHeight }) }
onMounted(() => { if (scroll.value) scroll.value.scrollTop = (high - 60) * rowHeight - 80; updateViewport() })
const scale = 24
useFollowPlayhead(scroll, () => (s.tick.value % (s.pattern.value?.length ?? 3840)) / 240 * scale, 44, () => s.followPlayhead.value && s.status.value.playing && !s.documentGesture.value)
const high = 127, low = 0, rowHeight = 16
const pitches = Array.from({ length: high - low + 1 }, (_, i) => high - i)
const width = computed(() => Math.max(480, (s.pattern.value?.length ?? 3840) / 240 * scale))
const height = pitches.length * rowHeight
const selected = computed(() => s.pattern.value?.notes.find(note => s.selectedNotes.value.includes(note.id)))
const visibleNotes = computed(() => s.pattern.value?.notes.filter(note => note.tick / 240 * scale < viewport.left + viewport.width && (note.tick + note.duration) / 240 * scale > viewport.left - 48 && (high - note.pitch) * rowHeight >= viewport.top - rowHeight && (high - note.pitch) * rowHeight < viewport.top + viewport.height + rowHeight).slice(0, 5000) ?? [])
const name = (pitch: number) => ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'][pitch % 12] + String(Math.floor(pitch / 12) - 1)
const black = (pitch: number) => [1, 3, 6, 8, 10].includes(pitch % 12)
let drag: { pointer: number; x: number; y: number; resize: boolean; original: Note[] } | undefined
function add(event: MouseEvent) {
  if (!canvas.value || event.target !== canvas.value || !s.writable.value) return
  const rect = canvas.value.getBoundingClientRect()
  void s.addNote((event.clientX - rect.left) / width.value * (s.pattern.value?.length ?? 3840), high - Math.floor((event.clientY - rect.top) / rowHeight))
}
function start(event: PointerEvent, note: Note, resize = false) {
  if (!s.writable.value || s.busy.value || event.button !== 0) return
  event.preventDefault(); event.stopPropagation()
  ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
  if (event.ctrlKey) s.selectedNotes.value = s.selectedNotes.value.includes(note.id) ? s.selectedNotes.value.filter(id => id !== note.id) : [...s.selectedNotes.value, note.id]
  else if (!s.selectedNotes.value.includes(note.id)) s.selectedNotes.value = [note.id]
  drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, resize, original: clone(s.pattern.value!.notes) }
  s.documentGesture.value = true
  canvas.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag || !s.pattern.value || event.pointerId !== drag.pointer) return
  const deltaTick = Math.round((event.clientX - drag.x) / scale * 240 / s.grid.value) * s.grid.value
  const deltaPitch = Math.round((drag.y - event.clientY) / rowHeight)
  for (const original of drag.original) {
    if (!s.selectedNotes.value.includes(original.id)) continue
    const note = s.pattern.value.notes.find(note => note.id === original.id)!
    if (drag.resize) note.duration = Math.max(s.grid.value, Math.min(s.pattern.value.length - original.tick, original.duration + deltaTick))
    else {
      note.tick = Math.max(0, Math.min(s.pattern.value.length - note.duration, original.tick + deltaTick))
      note.pitch = Math.max(0, Math.min(127, original.pitch + deltaPitch))
    }
  }
}
function finish(cancel = false) {
  if (!drag || !s.pattern.value) return
  const final = clone(s.pattern.value.notes), original = drag.original
  const pointer = drag.pointer; drag = undefined
  s.documentGesture.value = false
  s.pattern.value.notes = original
  if (canvas.value?.hasPointerCapture(pointer)) canvas.value.releasePointerCapture(pointer)
  if (!cancel && JSON.stringify(final) !== JSON.stringify(original)) void s.edit(() => { s.pattern.value!.notes = final })
}
function key(event: KeyboardEvent) {
  if ((event.target as Element)?.closest('input,select,[role="combobox"]')) return
  if (event.key === 'Escape') { finish(true); return }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); void s.deleteNotes() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); s.selectedNotes.value = s.pattern.value?.notes.map(note => note.id) ?? [] }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); s.copyNotes() }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); void s.pasteNotes() }
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); void s.transpose((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 12 : 1)) }
}
const auditionHeld = new Set<number>()
let velocityBefore: { note: Note; value: number } | undefined
function velocity(value: number) {
  if (!selected.value || !s.writable.value) return
  velocityBefore ??= { note: selected.value, value: selected.value.velocity }
  s.documentGesture.value = true; selected.value.velocity = value
}
function finishVelocity(cancel = false) {
  const original = velocityBefore; if (!original) return
  velocityBefore = undefined; s.documentGesture.value = false
  const value = original.note.velocity; original.note.velocity = original.value
  if (!cancel && value !== original.value) void s.edit(() => { original.note.velocity = value })
}
function audition(pitch: number, on: boolean) {
  if (on) auditionHeld.add(pitch); else if (!auditionHeld.delete(pitch)) return
  void s.safe(() => s.engine('midi', { status: on ? 144 : 128, data1: pitch, data2: on ? 100 : 0 }))
}
onBeforeUnmount(() => { finish(true); finishVelocity(true); for (const pitch of [...auditionHeld]) audition(pitch, false) })
</script>

<template>
  <section class="studio-piano" @keydown="key">
    <div class="studio-toolbar">
      <strong>{{ s.pattern.value?.name ?? t('piano') }}</strong>
      <UISelect v-model="s.grid.value" :options="[{ label: '1/4', value: 960 }, { label: '1/8', value: 480 }, { label: '1/16', value: 240 }, { label: '1/32', value: 120 }]" :aria-label="t('grid')" />
      <UIButton :disabled="!s.writable.value" @click="s.quantizeNotes">{{ t('quantize') }}</UIButton>
      <UIButton :aria-label="t('transposeDown')" @click="s.transpose(-1)"><UIIcon name="arrow-down" /></UIButton>
      <UIButton :aria-label="t('transposeUp')" @click="s.transpose(1)"><UIIcon name="arrow-up" /></UIButton>
      <span v-if="selected">{{ name(selected.pitch) }}</span>
      <label v-if="selected" class="studio-velocity">{{ t('velocity') }}<UISlider :model-value="selected.velocity" :min="1" :max="127" :step="1" :disabled="!s.writable.value" :aria-label="t('velocity')" @update:model-value="velocity" @change="finishVelocity()" @keydown.esc="finishVelocity(true)" @pointercancel="finishVelocity(true)" /></label>
    </div>
    <div ref="scroll" class="studio-piano-scroll" @scroll="updateViewport">
      <div class="studio-piano-keys">
        <button v-for="pitch in pitches" :key="pitch" :class="{ black: black(pitch), selected: s.heldNotes.has(pitch) }" :aria-label="name(pitch)"
          @pointerdown="audition(pitch, true)" @pointerup="audition(pitch, false)" @pointerleave="audition(pitch, false)" @pointercancel="audition(pitch, false)">{{ pitch % 12 === 0 ? name(pitch) : '' }}</button>
      </div>
      <div ref="canvas" class="studio-piano-grid" :style="{ width: `${width}px`, height: `${height}px` }" role="group" :aria-label="t('piano')"
        @dblclick="add" @pointermove="move" @pointerup="finish()" @pointercancel="finish(true)" @lostpointercapture="finish(true)">
        <div v-for="bar in Math.ceil((s.pattern.value?.length ?? 3840) / 3840)" :key="bar" class="studio-piano-bar" :style="{ left: `${(bar - 1) * 3840 / 240 * scale}px` }">{{ bar }}</div>
        <button v-for="note in visibleNotes" :key="note.id" class="studio-note" :class="{ selected: s.selectedNotes.value.includes(note.id) }"
          :style="{ left: `${note.tick / 240 * scale}px`, top: `${(high - note.pitch) * rowHeight}px`, width: `${Math.max(4, note.duration / 240 * scale)}px`, opacity: .45 + note.velocity / 127 * .55 }"
          :aria-label="`${name(note.pitch)}, ${t('velocity')} ${note.velocity}`" @pointerdown="start($event, note)">
          {{ name(note.pitch) }}<span class="studio-note-resize" @pointerdown.stop="start($event, note, true)"></span>
        </button>
        <div class="studio-playhead" :style="{ left: `${(s.tick.value % (s.pattern.value?.length ?? 3840)) / 240 * scale}px` }"></div>
      </div>
    </div>
  </section>
</template>
