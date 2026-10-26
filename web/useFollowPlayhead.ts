import { onBeforeUnmount, watch, type Ref } from 'vue'

/** Follow only near the visible edge; keep native scrolling and loop/seek interruptible. */
export function useFollowPlayhead(element: Ref<HTMLElement | undefined>, position: () => number, inset: number, enabled: () => boolean) {
  let frame = 0, previous = 0, target: number | undefined, lastTime = 0
  const stop = () => { cancelAnimationFrame(frame); frame = 0; target = undefined; lastTime = 0 }
  const step = (time: number) => {
    const view = element.value
    if (!enabled() || !view?.isConnected) { stop(); return }
    if (view.clientWidth > inset && view.clientHeight > 0) {
      const x = Math.max(0, position()), width = view.clientWidth - inset
      if (x < previous - 2 || x < view.scrollLeft || x > view.scrollLeft + width * .8)
        target = Math.max(0, Math.min(view.scrollWidth - view.clientWidth, x - width * .35))
      previous = x
      if (target !== undefined) {
        const delta = target - view.scrollLeft
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        view.scrollLeft = Math.abs(delta) < 1 || reduced ? target : view.scrollLeft + delta * (1 - Math.exp(-Math.min(64, time - (lastTime || time - 16)) / 65))
        if (Math.abs(target - view.scrollLeft) < 1) target = undefined
      }
    }
    lastTime = time; frame = requestAnimationFrame(step)
  }
  watch([enabled, element], () => { stop(); if (enabled() && element.value) { previous = position(); frame = requestAnimationFrame(step) } }, { immediate: true, flush: 'post' })
  onBeforeUnmount(stop)
}
