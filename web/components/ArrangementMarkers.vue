<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UIColorPicker, UIContextMenu, UIIcon, UIInfoTip, UIInput, UIModal, UIPropertyColumns, UIPropertyRow } from '@devline/ui-web/controls'
import { quantize, tickToFrame, uid, type Composition } from '../model'
import type { useStudio } from '../useStudio'

type Marker = Composition['markers'][number]
const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const emit = defineEmits<{ navigate: [tick: number] }>()
const { t } = useI18n(), dialogId = useId(), lane = ref<HTMLElement>()
const scale = 60 / 3840, selected = ref(''), editing = ref(''), name = ref(''), position = ref('1'), color = ref('')
const draft = ref<Marker>()
const markers = computed(() => [...s.document.value?.markers ?? []].sort((a, b) => a.tick - b.tick))
const previous = computed(() => markers.value.filter(marker => marker.tick < s.arrangementTick.value - 1).at(-1))
const next = computed(() => markers.value.find(marker => marker.tick > s.arrangementTick.value + 1))
const target = computed(() => draft.value?.id === editing.value ? draft.value : s.document.value?.markers.find(marker => marker.id === editing.value))
const positionTick = computed(() => Math.round((Number(position.value) - 1) * 3840))
const valid = computed(() => !!name.value.trim() && name.value.trim().length <= 200 && Number(position.value) >= 1 && Number.isSafeInteger(positionTick.value) && (!color.value || /^#[0-9a-f]{6}$/i.test(color.value)))
const menu = ref<{ x: number; y: number; marker?: Marker; tick: number }>()
const menuItems = computed(() => menu.value?.marker ? [
  { id: 'seek', label: t('goToMarker') },
  { id: 'edit', label: t('editMarker'), disabled: !s.writable.value },
  { id: 'delete', label: t('delete'), danger: true, disabled: !s.writable.value },
] : [{ id: 'add', label: t('addMarkerHere'), disabled: !s.writable.value }])
const drag = ref<{ marker: Marker; x: number; tick: number; preview: number; pointer: number; element: HTMLElement; moved: boolean }>()
let ignoreClick = false
function tick(marker: Marker) { return drag.value?.marker.id === marker.id ? drag.value.preview : marker.tick }
function labelWidth(marker: Marker) {
  const following = markers.value.find(item => tick(item) > tick(marker))
  return Math.max(12, Math.min(160, following ? (tick(following) - tick(marker)) * scale - 2 : 160))
}
function seek(marker: Marker) {
  selected.value = marker.id; emit('navigate', marker.tick)
  void s.safe(() => s.engine('seek', { arrangement: true, frame: tickToFrame(marker.tick, s.status.value.sampleRate, s.document.value!.tempos) }))
}
function click(marker: Marker) { if (ignoreClick) ignoreClick = false; else seek(marker) }
function open(marker: Marker, create = false) {
  if (!s.writable.value) return
  draft.value = create ? marker : undefined
  selected.value = marker.id; editing.value = marker.id; name.value = marker.name; position.value = String(1 + marker.tick / 3840); color.value = marker.color ?? ''
}
function close() {
  if (draft.value?.id === selected.value) selected.value = ''
  editing.value = ''; draft.value = undefined
}
function addAt(position: number) {
  if (!s.writable.value || s.busy.value || !s.document.value) return
  const at = quantize(position, s.grid.value), existing = markers.value.find(marker => marker.tick === at)
  if (existing) { open(existing); return }
  let number = 1
  while (markers.value.some(marker => marker.name === `${t('marker')} ${number}`)) number++
  const marker = { id: uid('marker'), tick: at, name: `${t('marker')} ${number}` }
  open(marker, true)
}
function save() {
  if (!valid.value || !target.value || !s.writable.value) return
  const marker = target.value, at = positionTick.value, text = name.value.trim(), chosenColor = color.value || undefined
  if (draft.value) void s.edit(doc => doc.markers.push({ ...marker, name: text, tick: at, color: chosenColor }))
  else if (marker.tick !== at || marker.name !== text || marker.color !== chosenColor) void s.edit(() => { marker.name = text; marker.tick = at; marker.color = chosenColor })
  editing.value = ''; draft.value = undefined; emit('navigate', at)
}
function remove(marker: Marker) {
  if (!s.writable.value) return
  if (draft.value?.id === marker.id) { close(); return }
  void s.edit(doc => { doc.markers = doc.markers.filter(item => item.id !== marker.id) })
  if (selected.value === marker.id) selected.value = ''
  if (editing.value === marker.id) editing.value = ''
}
function laneTick(event: MouseEvent) { return quantize((event.clientX - lane.value!.getBoundingClientRect().left) / scale, s.grid.value) }
function context(event: MouseEvent, marker?: Marker) {
  menu.value = { x: event.clientX, y: event.clientY, marker, tick: marker?.tick ?? laneTick(event) }
}
function action(id: string) {
  const item = menu.value; menu.value = undefined
  if (!item) return
  if (id === 'add') addAt(item.tick)
  if (!item.marker) return
  if (id === 'seek') seek(item.marker)
  if (id === 'edit') open(item.marker)
  if (id === 'delete') remove(item.marker)
}
function start(event: PointerEvent, marker: Marker) {
  ignoreClick = false
  if (event.button !== 0 || !s.writable.value || s.busy.value) return
  const element = event.currentTarget as HTMLElement
  element.focus({ preventScroll: true }); element.setPointerCapture(event.pointerId)
  selected.value = marker.id; s.documentGesture.value = true
  drag.value = { marker, x: event.clientX, tick: marker.tick, preview: marker.tick, pointer: event.pointerId, element, moved: false }
}
function move(event: PointerEvent) {
  const current = drag.value
  if (!current || event.pointerId !== current.pointer) return
  if (Math.abs(event.clientX - current.x) >= 3) current.moved = true
  if (current.moved) current.preview = quantize(current.tick + (event.clientX - current.x) / scale, s.grid.value)
}
function finish(cancel = false) {
  const current = drag.value
  if (!current) return
  drag.value = undefined; s.documentGesture.value = false; ignoreClick = current.moved || cancel
  if (current.element.hasPointerCapture(current.pointer)) current.element.releasePointerCapture(current.pointer)
  if (!cancel && current.preview !== current.tick && s.writable.value) void s.edit(() => { current.marker.tick = current.preview })
}
function key(event: KeyboardEvent, marker: Marker) {
  if (['Delete', 'Backspace', 'F2', 'Escape', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(event.key)) event.stopPropagation()
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); remove(marker) }
  if (event.key === 'F2') { event.preventDefault(); open(marker) }
  if (event.key === 'Escape') { event.preventDefault(); finish(true) }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault()
    if (s.writable.value && !drag.value) {
      const at = Math.max(0, marker.tick + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 3840 : s.grid.value))
      if (at !== marker.tick) void s.edit(() => { marker.tick = at })
      emit('navigate', at)
    }
  }
}
onBeforeUnmount(() => finish(true))
defineExpose({ addAt })
</script>

<template>
  <div class="studio-marker-ruler">
    <div class="studio-marker-heading">
      <span>{{ t('markers') }}</span>
      <UIButton :aria-label="t('previousMarker')" :title="t('previousMarker')" :disabled="!previous" @click="previous && seek(previous)"><UIIcon name="chevron-left" /></UIButton>
      <UIButton :aria-label="t('nextMarker')" :title="t('nextMarker')" :disabled="!next" @click="next && seek(next)"><UIIcon name="chevron-right" /></UIButton>
      <UIInfoTip :label="t('markers')" :text="t('markerHelp')" />
    </div>
    <div ref="lane" class="studio-marker-lane" :aria-label="t('markers')" @dblclick.self="addAt(laneTick($event))" @contextmenu.self.prevent.stop="context($event)">
      <button v-for="marker in markers" :key="marker.id" type="button" class="studio-marker-flag" :style="{ left: `${tick(marker) * scale}px`, maxWidth: `${labelWidth(marker)}px`, '--marker-color': marker.color }" :aria-label="t('markerPosition', { name: marker.name, bar: +(1 + tick(marker) / 3840).toFixed(4) })" :title="t('markerPosition', { name: marker.name, bar: +(1 + tick(marker) / 3840).toFixed(4) })" :aria-pressed="selected === marker.id"
        @pointerdown.stop="start($event, marker)" @pointermove.stop="move" @pointerup.stop="finish()" @pointercancel.stop="finish(true)" @lostpointercapture="finish(true)" @click.stop="click(marker)" @dblclick.stop="open(marker)" @contextmenu.prevent.stop="context($event, marker)" @keydown="key($event, marker)">
        <UIIcon name="bookmark-fill" /><span>{{ marker.name }}</span>
      </button>
    </div>
  </div>
  <div v-for="marker in markers" :key="marker.id" class="studio-marker-line" :style="{ left: `${170 + tick(marker) * scale}px`, '--marker-color': marker.color }" aria-hidden="true"></div>
  <UIContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" :label="t('marker')" @select="action" @close="menu = undefined" />
  <UIModal :id="dialogId" :open="!!target" :title="draft ? t('addMarker') : t('editMarker')" size="sm" @update:open="value => { if (!value) close() }">
    <div class="studio-dialog-form" @keydown.enter.prevent="save">
      <UIPropertyColumns class="ui-form-properties" :label="t('resizeColumns')">
        <UIPropertyRow :label="t('name')"><UIInput v-model="name" variant="property" :aria-label="t('name')" :error-message="!name.trim() || name.trim().length > 200 ? t('invalidMarkerName') : undefined" /></UIPropertyRow>
        <UIPropertyRow :label="t('markerBar')"><UIInput v-model="position" type="number" min="1" :step="s.grid.value / 3840" variant="property" :aria-label="t('markerBar')" :error-message="Number(position) < 1 || !Number.isSafeInteger(positionTick) ? t('invalidMarkerPosition') : undefined" /></UIPropertyRow>
        <UIPropertyRow :label="t('markerColor')"><UIColorPicker v-model="color" :aria-label="t('markerColor')" /><UIInput v-model="color" variant="property" :aria-label="t('markerColor')" /><UIButton variant="property" :disabled="!color" @click="color = ''">{{ t('reset') }}</UIButton></UIPropertyRow>
      </UIPropertyColumns>
      <div class="studio-dialog-actions"><UIButton v-if="!draft" :disabled="!s.writable.value" @click="target && remove(target)">{{ t('delete') }}</UIButton><span class="studio-spacer"></span><UIButton @click="close">{{ t('cancel') }}</UIButton><UIButton :disabled="!valid || !s.writable.value" @click="save">{{ t('save') }}</UIButton></div>
    </div>
  </UIModal>
</template>
