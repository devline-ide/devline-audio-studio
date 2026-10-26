export const PPQ = 960
export interface Note { id: string; pitch: number; tick: number; duration: number; velocity: number; channel: number }
export interface Pattern { id: string; name: string; length: number; notes: Note[]; controllers: Array<{ tick: number; channel: number; controller: number; value: number }>; events: Array<{ tick: number; status: number; data1: number; data2: number }> }
export interface Clip { id: string; tick: number; length: number; pattern?: string; asset?: string; sourceFrame: number; gain: number; fadeIn: number; fadeOut: number; patternOffset?: number }
export interface Point { tick: number; value: number; curve: 'step' | 'linear' | 'smooth' }
export function automationAt(points: Point[], tick: number, fallback: number): number {
  if (!points.length) return fallback
  let right = points.findIndex(point => point.tick > tick)
  if (right === 0) return points[0]!.value
  if (right < 0) return points.at(-1)!.value
  const a = points[right - 1]!, b = points[right]!
  let mix = a.curve === 'step' ? 0 : (tick - a.tick) / (b.tick - a.tick)
  if (a.curve === 'smooth') mix = mix * mix * (3 - 2 * mix)
  return a.value * (1 - mix) + b.value * mix
}
export interface Track {
  id: string; name: string; color?: string; icon?: string; kind: 'instrument' | 'audio' | 'bus'
  instrument: { kind: 'synth' | 'sampler' | 'drums' | 'sfx' | 'vst3'; waveform: string; asset?: string; plugin?: string; state?: string; parameters: Record<string, number>; pads?: Record<string, string> }
  clips: Clip[]; gain: number; pan: number; muted: boolean; solo: boolean; output: string
  sends: Array<{ track: string; gain: number; sidechain: boolean }>
  effects: Array<{ id: string; kind: string; bypass: boolean; parameters: Record<string, number>; plugin?: string; state?: string }>
  automation: Array<{ target: string; points: Point[]; mode: 'read' | 'touch' | 'write' }>
}
export interface Composition {
  schemaVersion: 1; ppq: 960; name: string
  tempos: Array<{ tick: number; bpm: number; numerator: number; denominator: number }>
  patterns: Pattern[]; tracks: Track[]; loop: { start: number; end: number; enabled: boolean }
  markers: Array<{ id: string; tick: number; name: string; color?: string }>
  masterGain?: number
}
export const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
export const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export function validateRouting(document: Composition) {
  const visiting = new Set<string>(), visited = new Set<string>(), tracks = new Map(document.tracks.map(track => [track.id, track]))
  function visit(id: string) {
    if (id === 'master' || visited.has(id)) return
    if (visiting.has(id)) throw Error('Audio routing must not contain feedback cycles')
    const track = tracks.get(id); if (!track) throw Error('Routing destination is missing')
    visiting.add(id); visit(track.output); track.sends.forEach(send => visit(send.track)); visiting.delete(id); visited.add(id)
  }
  document.tracks.forEach(track => visit(track.id))
}
export function makeTrack(name: string, kind: Track['kind'] = 'instrument'): Track {
  return { id: uid('track'), name, kind, instrument: { kind: 'synth', waveform: 'sine', parameters: {} }, clips: [], gain: .7, pan: 0, muted: false, solo: false, output: 'master', sends: [], effects: [], automation: [] }
}
export function quantize(tick: number, grid: number, swing = 0) {
  const step = Math.max(0, Math.round(tick / grid))
  return step * grid + (step % 2 ? Math.round(grid * swing) : 0)
}
export function frameToTick(frame: number, rate: number, tempos: Composition['tempos']) {
  let remaining = frame / rate
  for (let i = 0; i < tempos.length; i++) {
    const tempo = tempos[i]!, next = tempos[i + 1]
    const span = next ? (next.tick - tempo.tick) * 60 / (PPQ * tempo.bpm) : Infinity
    if (remaining < span) return tempo.tick + remaining * PPQ * tempo.bpm / 60
    remaining -= span
  }
  return 0
}
export function tickToFrame(tick: number, rate: number, tempos: Composition['tempos']) {
  let seconds = 0
  for (let i = 0; i < tempos.length && tick > tempos[i]!.tick; i++) {
    const tempo = tempos[i]!, end = Math.min(tick, tempos[i + 1]?.tick ?? tick)
    seconds += (end - tempo.tick) * 60 / (PPQ * tempo.bpm)
  }
  return Math.round(seconds * rate)
}
