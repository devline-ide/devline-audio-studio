<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UISelect } from '@devline/ui-web/controls'
import { clone, quantize, type Point } from '../model'
import type { useStudio } from '../useStudio'

const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n()
const target = ref<string | number | null>('gain'), selected = ref(-1)
const lane = computed(() => s.track.value?.automation.find(lane => lane.target === target.value))
const targets = computed(() => [{ label: t('gain'), value: 'gain', min: 0, max: 2 }, { label: t('pan'), value: 'pan', min: -1, max: 1 },
  ...Object.keys(s.track.value?.instrument.parameters ?? {}).map(key => ({ label: `${t('instrument')}: ${key}`, value: `instrument/${key}`, min: 0, max: 1 })),
  ...s.pluginParameters.value.map(parameter => ({ label: parameter.name, value: s.pluginParametersEffect.value === 'instrument' ? `instrument/${parameter.id}` : `fx/${s.pluginParametersEffect.value}/${parameter.id}`, min: 0, max: 1 })),
  ...(s.track.value?.effects.flatMap(effect => Object.keys(effect.parameters).map(key => ({ label: `${t(effect.kind)}: ${t(key)}`, value: `fx/${effect.id}/${key}`, min: ['low','mid','high'].includes(key) ? -24 : 0, max: key === 'cutoff' ? 18000 : key === 'drive' ? 12 : key === 'ratio' ? 20 : ['low','mid','high'].includes(key) ? 24 : 1 }))) ?? [])])
const range = computed(() => targets.value.find(item => item.value === target.value) ?? targets.value[0]!)
const extent = computed(() => Math.max(15360, ...s.track.value?.clips.map(clip => clip.tick + clip.length) ?? []))
const y = (value: number) => 150 - (value - range.value.min) / (range.value.max - range.value.min) * 140
const x = (tick: number) => tick / extent.value * 600
const path = computed(() => {
  const points = lane.value?.points ?? []
  return points.map((point, i) => {
    if (!i) return `M${x(point.tick)},${y(point.value)}`
    const previous = points[i - 1]!
    return previous.curve === 'step' ? `H${x(point.tick)}V${y(point.value)}` : previous.curve === 'smooth' ? `C${(x(previous.tick) + x(point.tick)) / 2},${y(previous.value)} ${(x(previous.tick) + x(point.tick)) / 2},${y(point.value)} ${x(point.tick)},${y(point.value)}` : `L${x(point.tick)},${y(point.value)}`
  }).join(' ')
})
function add(event: MouseEvent) {
  const bounds = (event.currentTarget as SVGElement).getBoundingClientRect()
  const tick = quantize((event.clientX - bounds.left) / bounds.width * extent.value, s.grid.value)
  const value = range.value.min + Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height)) * (range.value.max - range.value.min)
  void s.edit(() => {
    if (!s.track.value) return
    if (!lane.value) s.track.value.automation.push({ target: String(target.value), points: [], mode: 'read' })
    const current = s.track.value.automation.find(l => l.target === target.value)!
    current.points = [...current.points.filter(point => point.tick !== tick), { tick, value, curve: 'linear' as const }].sort((a, b) => a.tick - b.tick)
  })
}
let drag: { points: Point[]; index: number; element: SVGSVGElement } | undefined
function begin(event: PointerEvent, index: number) {
  if (!lane.value || !s.writable.value) return
  event.preventDefault(); event.stopPropagation()
  const element = (event.currentTarget as SVGCircleElement).ownerSVGElement!
  drag = { points: clone(lane.value.points), index, element }; selected.value = index; s.documentGesture.value = true; element.focus(); element.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag || !lane.value) return
  const bounds = drag.element.getBoundingClientRect(), point = lane.value.points[drag.index]!
  point.tick = quantize(Math.max(0, Math.min(extent.value, (event.clientX - bounds.left) / bounds.width * extent.value)), s.grid.value)
  point.value = range.value.min + Math.max(0, Math.min(1, 1 - (event.clientY - bounds.top) / bounds.height)) * (range.value.max - range.value.min)
}
function finish(cancel = false) {
  if (!drag || !lane.value) return
  const final = clone(lane.value.points), original = drag.points; drag = undefined; s.documentGesture.value = false
  lane.value.points = original
  if (!cancel) void s.edit(() => { lane.value!.points = [...new Map(final.map(point => [point.tick, point])).values()].sort((a, b) => a.tick - b.tick) })
}
</script>

<template>
  <section class="studio-automation" @keydown.esc="finish(true)">
    <div class="studio-toolbar"><UISelect v-model="target" :options="targets" :aria-label="t('parameter')" />
      <UISelect v-if="lane" v-model="lane.mode" :options="['read','touch','write'].map(value => ({ label: value, value }))" :aria-label="t('mode')" @update:model-value="s.edit(() => {})" />
      <UIButton :disabled="!lane || selected < 0" @click="s.edit(() => { lane!.points.splice(selected, 1); selected = -1 })">{{ t('delete') }}</UIButton>
      <UISelect v-if="lane?.points[selected]" :model-value="lane.points[selected]!.curve" :options="['step','linear','smooth'].map(value => ({ label: t(value), value }))" :aria-label="t('curve')" @update:model-value="value => s.edit(() => { lane!.points[selected]!.curve = value as Point['curve'] })" />
    </div>
    <svg viewBox="0 0 600 160" tabindex="0" preserveAspectRatio="none" role="img" :aria-label="t('automation')" @dblclick="add" @pointermove="move" @pointerup="finish()" @pointercancel="finish(true)" @lostpointercapture="finish(true)">
      <path :d="path" class="studio-automation-line" />
      <circle v-for="(point, i) in lane?.points ?? []" :key="i" :cx="x(point.tick)" :cy="y(point.value)" r="5" @pointerdown="begin($event, i)" />
    </svg>
  </section>
</template>
