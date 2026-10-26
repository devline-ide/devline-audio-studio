import type { Track } from './model'

export const trackIcons = ['music-note-beamed', 'keyboard', 'soundwave', 'mic', 'disc', 'lightning', 'controller', 'sliders', 'speaker']
export const trackColor = (track: Track) => /^#[0-9a-f]{6}$/i.test(track.color ?? '') ? track.color! : 'var(--color-accent)'
export const trackIcon = (track: Track) => trackIcons.includes(track.icon ?? '') ? track.icon! : track.kind === 'audio' ? 'soundwave' : track.kind === 'bus' ? 'sliders' : 'music-note-beamed'
