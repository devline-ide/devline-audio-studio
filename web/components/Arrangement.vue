<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { UIButton, UIIcon, UIContextMenu } from '@devline/ui-web'
import { clone, quantize, uid, tickToFrame, frameToTick, type Clip, type Track } from '../model'
import type { useStudio } from '../useStudio'
import { useFollowPlayhead } from '../useFollowPlayhead'
import TrackHeader from './TrackHeader.vue'
import ArrangementMarkers from './ArrangementMarkers.vue'
import ArrangementPlayhead from './ArrangementPlayhead.vue'
import { trackColor } from '../trackAppearance'

const { studio: s } = defineProps<{ studio: ReturnType<typeof useStudio> }>()
const { t } = useI18n()
const stage = ref<HTMLElement>()
const markers = ref<InstanceType<typeof ArrangementMarkers>>()
const scale = 60 / 3840
const scroll = ref<HTMLElement>()
useFollowPlayhead(scroll, () => s.arrangementTick.value * scale, 170, () => s.playbackMode.value === 'song' && s.followPlayhead.value && s.status.value.playing && !s.documentGesture.value)
const viewportWidth = ref(0)
const contentBars = computed(() => Math.max(16, Math.ceil(Math.max(0, ...s.document.value!.tracks.flatMap(track => track.clips.map(clip => clip.tick + clip.length)), ...s.document.value!.markers.map(marker => marker.tick)) / 3840) + 4))
const timelineWidth = computed(() => Math.max(viewportWidth.value, 170 + contentBars.value * 60))
const bars = computed(() => Math.ceil((timelineWidth.value - 170) / 60))
let observer: ResizeObserver | undefined
onMounted(() => {
  if (!scroll.value) return
  observer = new ResizeObserver(() => { viewportWidth.value = scroll.value?.clientWidth ?? 0 })
  observer.observe(scroll.value)
})
onBeforeUnmount(() => observer?.disconnect())
const menu = ref<{ x: number; y: number; track: Track; clip: Clip }>()
const menuItems = computed(() => [
  { id: 'unique', label: t('makeUnique'), disabled: !menu.value?.clip.pattern },
  { id: 'duplicate', label: t('duplicate') }, { id: 'split', label: t('split') }, { id: 'delete', label: t('delete'), danger: true },
])
let drag: { pointer: number; x: number; clip: Clip; original: Clip; mode: 'move' | 'end' | 'start'; track: Track; destination: Track } | undefined
function revealMarker(tick: number) {
  const viewport = scroll.value
  if (!viewport) return
  const x = 170 + tick * scale
  if (x < viewport.scrollLeft + 170 || x > viewport.scrollLeft + viewport.clientWidth - 40) viewport.scrollTo({ left: Math.max(0, x - 170 - (viewport.clientWidth - 170) / 3), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })
}
function add(event: MouseEvent, track: Track) {
  if (track.kind !== 'instrument' || (event.target as HTMLElement).closest('.studio-clip')) return
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()
  void s.placePattern(track.id, (event.clientX - bounds.left) / scale)
}
function start(event: PointerEvent, track: Track, clip: Clip, mode: 'move' | 'end' | 'start' = 'move') {
  if (event.button !== 0 || !s.writable.value || s.busy.value) return
  event.preventDefault(); event.stopPropagation()
  ;(event.currentTarget as HTMLElement).focus({ preventScroll: true })
  s.selectedTrack.value = track.id
  s.selectedClip.value = clip.id
  if (clip.pattern) s.selectedPattern.value = clip.pattern
  if (mode === 'start' && clip.asset && !s.waveforms[clip.asset]) return
  drag = { pointer: event.pointerId, x: event.clientX, clip, original: clone(clip), mode, track, destination: track }
  s.documentGesture.value = true
  stage.value?.setPointerCapture(event.pointerId)
}
function move(event: PointerEvent) {
  if (!drag) return
  const delta = Math.round((event.clientX - drag.x) / scale / s.grid.value) * s.grid.value
  if (drag.mode === 'end') drag.clip.length = Math.max(s.grid.value, drag.original.length + delta)
  else if (drag.mode === 'start') {
    const rate = drag.clip.asset ? s.waveforms[drag.clip.asset]!.sourceRate : s.status.value.sampleRate
    const minimum = drag.clip.asset ? frameToTick(Math.max(0, tickToFrame(drag.original.tick, rate, s.document.value!.tempos) - drag.original.sourceFrame), rate, s.document.value!.tempos) : drag.original.tick - (drag.original.patternOffset ?? 0)
    const next = Math.max(0, Math.ceil(minimum), Math.min(drag.original.tick + drag.original.length - s.grid.value, drag.original.tick + delta))
    drag.clip.tick = next; drag.clip.length = drag.original.length - (next - drag.original.tick)
    if (drag.clip.asset) drag.clip.sourceFrame = drag.original.sourceFrame + tickToFrame(next, rate, s.document.value!.tempos) - tickToFrame(drag.original.tick, rate, s.document.value!.tempos)
    else drag.clip.patternOffset = (drag.original.patternOffset ?? 0) + next - drag.original.tick
  } else {
    drag.clip.tick = quantize(drag.original.tick + delta, s.grid.value)
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-track-id]')
    const destination = s.document.value?.tracks.find(track => track.id === row?.dataset.trackId)
    if (destination && destination.kind !== 'bus' && (drag.clip.asset || destination.kind === 'instrument')) drag.destination = destination
  }
  drag.clip.fadeIn = Math.min(drag.clip.fadeIn, drag.clip.length); drag.clip.fadeOut = Math.min(drag.clip.fadeOut, drag.clip.length)
}
function finish(cancel = false) {
  if (!drag) return
  const { clip, original, pointer, track, destination } = drag, final = clone(clip)
  drag = undefined; s.documentGesture.value = false; Object.assign(clip, original)
  if (stage.value?.hasPointerCapture(pointer)) stage.value.releasePointerCapture(pointer)
  if (!cancel && (track !== destination || JSON.stringify(original) !== JSON.stringify(final))) void s.edit(() => {
    Object.assign(clip, final)
    if (track !== destination) { track.clips = track.clips.filter(item => item.id !== clip.id); destination.clips.push(clip); s.selectedTrack.value = destination.id }
  })
}
function action(id: string) {
  const item = menu.value; menu.value = undefined
  if (!item) return
  void s.edit(value => {
    if (id === 'delete') item.track.clips = item.track.clips.filter(clip => clip.id !== item.clip.id)
    if (id === 'duplicate') item.track.clips.push({ ...clone(item.clip), id: uid('clip'), tick: item.clip.tick + item.clip.length })
    if (id === 'split') {
      const split = quantize(s.arrangementTick.value - item.clip.tick, s.grid.value)
      if (split <= 0 || split >= item.clip.length) return
      const right = { ...clone(item.clip), id: uid('clip'), tick: item.clip.tick + split, length: item.clip.length - split }
      if (right.asset) right.sourceFrame += tickToFrame(item.clip.tick + split, s.waveforms[right.asset]?.sourceRate ?? s.status.value.sampleRate, value.tempos) - tickToFrame(item.clip.tick, s.waveforms[right.asset]?.sourceRate ?? s.status.value.sampleRate, value.tempos)
      else right.patternOffset = (right.patternOffset ?? 0) + split
      right.fadeIn = 0; item.clip.fadeOut = 0
      item.clip.length = split; item.track.clips.push(right)
    }
    if (id === 'unique' && item.clip.pattern) {
      const source = value.patterns.find(pattern => pattern.id === item.clip.pattern)!
      const pattern = { ...clone(source), id: uid('pattern'), name: source.name + ' copy' }
      value.patterns.push(pattern); item.clip.pattern = pattern.id; s.selectedPattern.value = pattern.id
    }
  })
}
function clipName(clip: Clip) { return clip.pattern ? s.document.value?.patterns.find(pattern => pattern.id === clip.pattern)?.name : clip.asset?.split('/').pop() }
function patternLength(clip: Clip) { return s.document.value?.patterns.find(pattern => pattern.id === clip.pattern)?.length ?? 0 }
function repeatBoundaries(clip: Clip) {
  const length = patternLength(clip)
  if (!length || length * scale < 4) return ''
  const offset = (clip.patternOffset ?? 0) % length, paths: string[] = []
  for (let tick = length - offset; tick < clip.length && paths.length < 1500; tick += length) paths.push(`M${tick / clip.length * 100} 0v18`)
  return paths.join(' ')
}
function clipDescription(clip: Clip) {
  return clip.pattern ? t('patternClipDescription', { name: clipName(clip), clipBars: +(clip.length / 3840).toFixed(3), patternBars: +(patternLength(clip) / 3840).toFixed(3) }) : clipName(clip)
}
const miniature = computed(() => {
  const result = new Map<string, string>(), patterns = new Map(s.document.value?.patterns.map(pattern => [pattern.id, pattern]))
  for (const track of s.document.value?.tracks ?? []) for (const clip of track.clips) {
    const pattern = patterns.get(clip.pattern ?? ''); if (!pattern?.notes.length) continue
    const offset = (clip.patternOffset ?? 0) % pattern.length, count = Math.ceil((clip.length + offset) / pattern.length) * pattern.notes.length
    const paths: string[] = [], stride = Math.max(1, Math.ceil(count / 1500))
    for (let index = 0; index < count; index += stride) {
      const note = pattern.notes[index % pattern.notes.length]!, start = Math.floor(index / pattern.notes.length) * pattern.length - offset + note.tick
      const left = Math.max(0, start), right = Math.min(clip.length, start + note.duration)
      if (right > left) paths.push(`M${left / clip.length * 100} ${18 - note.pitch % 12}h${(right - left) / clip.length * 100}`)
    }
    result.set(clip.id, paths.join(' '))
  }
  return result
})
watch(() => s.document.value?.tracks.flatMap(track => track.clips.map(clip => clip.asset)).filter((path): path is string => !!path) ?? [], paths => { for (const path of new Set(paths)) void s.safe(() => s.waveform(path)) }, { immediate: true })
function waveform(clip: Clip) {
  const wave = clip.asset ? s.waveforms[clip.asset] : undefined
  if (!wave || !wave.frames) return ''
  const start = clip.sourceFrame * wave.sampleRate / wave.sourceRate
  const duration = tickToFrame(clip.tick + clip.length, wave.sampleRate, s.document.value!.tempos) - tickToFrame(clip.tick, wave.sampleRate, s.document.value!.tempos)
  return Array.from({ length: 100 }, (_, i) => { const frame = start + duration * i / 100, peak = frame >= wave.frames ? 0 : wave.peaks[Math.floor(frame / wave.frames * wave.peaks.length)] ?? 0; return `M${i},${9 - peak * 9}v${peak * 18}` }).join(' ')
}
</script>

<template>
  <section class="studio-arrangement">
    <div class="studio-toolbar">
      <UIButton :disabled="!s.writable.value" @click="s.addTrack()"><UIIcon name="plus" />{{ t('instrumentTrack') }}</UIButton>
      <UIButton :disabled="!s.writable.value" @click="s.addTrack('audio')"><UIIcon name="plus" />{{ t('audioTrack') }}</UIButton>
      <UIButton :disabled="!s.writable.value" @click="s.addTrack('bus')"><UIIcon name="plus" />{{ t('bus') }}</UIButton>
      <UIButton :aria-label="t('addMarker')" :disabled="!s.writable.value" @click="markers?.addAt(s.arrangementTick.value)"><UIIcon name="bookmark" /></UIButton>
      <span class="studio-spacer"></span><span>{{ t('bars') }}: {{ bars }}</span>
    </div>
    <div ref="scroll" class="studio-arrangement-scroll">
      <div ref="stage" class="studio-timeline" :style="{ width: `${timelineWidth}px` }" @pointermove="move" @pointerup="finish()" @pointercancel="finish(true)" @lostpointercapture="finish(true)" @keydown.esc="finish(true)">
        <ArrangementMarkers ref="markers" :studio="s" @navigate="revealMarker" />
        <div class="studio-timeline-ruler"><span>{{ t('tracks') }}</span><button v-for="bar in bars" :key="bar" @click="s.safe(() => s.engine('seek', { arrangement: true, frame: tickToFrame((bar - 1) * 3840, s.status.value.sampleRate, s.document.value!.tempos) }))">{{ bar }}</button></div>
        <div v-for="track in s.document.value?.tracks ?? []" :key="track.id" class="studio-timeline-row" :data-track-id="track.id" :style="{ '--track-color': trackColor(track) }" :class="{ selected: s.selectedTrack.value === track.id }">
          <TrackHeader :studio="s" :track="track" />
          <div class="studio-timeline-lane" @dblclick="add($event, track)">
            <button v-for="clip in track.clips" :key="clip.id" class="studio-clip" :class="{ audio: !!clip.asset }" :title="clipDescription(clip)"
              :style="{ left: `${clip.tick * scale}px`, width: `${Math.max(12, clip.length * scale)}px` }"
              @pointerdown="start($event, track, clip)" @contextmenu.prevent="menu = { x: $event.clientX, y: $event.clientY, track, clip }"
              @dblclick.stop="s.selectedPattern.value = clip.pattern ?? s.selectedPattern.value; s.main.value = clip.pattern ? 'piano' : 'arrangement'">
              <span>{{ clipName(clip) }}</span>
              <svg v-if="clip.pattern" class="studio-clip-repeats" preserveAspectRatio="none" viewBox="0 0 100 18" aria-hidden="true"><path :d="repeatBoundaries(clip)" /></svg>
              <svg v-if="clip.pattern" class="studio-clip-notes" preserveAspectRatio="none" viewBox="0 0 100 18" aria-hidden="true"><path :d="miniature.get(clip.id)" /></svg>
              <svg v-else class="studio-clip-notes" preserveAspectRatio="none" viewBox="0 0 100 18" aria-hidden="true"><path :d="waveform(clip)" /></svg>
              <span class="studio-clip-trim" @pointerdown.stop="start($event, track, clip, 'start')"></span><span class="studio-clip-resize" @pointerdown.stop="start($event, track, clip, 'end')"></span>
            </button>
          </div>
        </div>
        <ArrangementPlayhead :studio="s" :scale="scale" />
      </div>
    </div>
    <UIContextMenu v-if="menu" :x="menu.x" :y="menu.y" :items="menuItems" :label="t('clip')" @select="action" @close="menu = undefined" />
  </section>
</template>
