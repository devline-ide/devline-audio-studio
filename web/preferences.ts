export interface StudioPreferences {
  outputName: string | null
  inputName: string | null
  midiName: string | null
  midiOutputName: string | null
  sampleRate: number
  blockSize: number
  exclusive: boolean
  inputChannel: number | null
  countIn: boolean
  metronome: boolean
  followPlayhead: boolean
}
export const defaultPreferences = (): StudioPreferences => ({ outputName: null, inputName: null, midiName: null, midiOutputName: null, sampleRate: 48000, blockSize: 256, exclusive: false, inputChannel: null, countIn: false, metronome: false, followPlayhead: true })
