import type { Track } from './model'

/** Temporary isolation restores the mix that existed before the first Alt+M. */
export function createTrackMute() {
  let isolated = '', before: Map<string, { muted: boolean; solo: boolean }> | undefined
  function reset() { isolated = ''; before = undefined }
  function toggle(tracks: Track[], id: string, isolate = false) {
    const selected = tracks.find(track => track.id === id)
    if (!selected) return
    if (!isolate) { selected.muted = !selected.muted; return }
    if (isolated === id && before) {
      for (const track of tracks) { const previous = before.get(track.id); if (previous) Object.assign(track, previous) }
      reset(); return
    }
    before ??= new Map(tracks.map(track => [track.id, { muted: track.muted, solo: track.solo }]))
    const byId = new Map(tracks.map(track => [track.id, track]))
    const routes = (track: Track) => [track.output, ...track.sends.filter(send => !send.sidechain).map(send => send.track)]
    function reaches(track: Track, target: string, visited = new Set<string>()): boolean {
      if (track.id === target) return true
      if (visited.has(track.id)) return false
      visited.add(track.id)
      return routes(track).some(id => { const next = byId.get(id); return next ? reaches(next, target, visited) : false })
    }
    const audible = new Set([id])
    if (selected.kind === 'bus') for (const track of tracks) if (track.kind !== 'bus' && reaches(track, id)) audible.add(track.id)
    function keepRouting(track: Track) {
      for (const id of routes(track)) {
        const bus = byId.get(id)
        if (!bus || bus.kind !== 'bus' || audible.has(id)) continue
        audible.add(id); keepRouting(bus)
      }
    }
    for (const id of [...audible]) keepRouting(byId.get(id)!)
    for (const track of tracks) { track.muted = !audible.has(track.id); track.solo = false }
    isolated = id
  }
  return { toggle, reset }
}
