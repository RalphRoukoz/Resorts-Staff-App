// Short synthesized feedback tones for the reception scanner.
// Uses the Web Audio API so there are no audio asset files to load.

let ctx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const AC =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AC) return null
    ctx = new AC()
  }
  return ctx
}

/**
 * Resume/unlock the audio context. Call this from a user gesture (e.g. a button
 * press) so later programmatic tones are allowed to play.
 */
export function primeAudio(): void {
  const c = getCtx()
  if (c && c.state === 'suspended') void c.resume()
}

function tone(
  c: AudioContext,
  freq: number,
  startAt: number,
  duration: number,
  type: OscillatorType,
  peak: number,
): void {
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.value = freq

  // Soft attack/release envelope to avoid clicks.
  gain.gain.setValueAtTime(0.0001, startAt)
  gain.gain.exponentialRampToValueAtTime(peak, startAt + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration)

  osc.connect(gain)
  gain.connect(c.destination)
  osc.start(startAt)
  osc.stop(startAt + duration + 0.02)
}

/** Bright two-note rising chime for a successful validation. */
export function playSuccess(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime
  tone(c, 784, t, 0.12, 'sine', 0.25) // G5
  tone(c, 1175, t + 0.12, 0.18, 'sine', 0.25) // D6
}

/** Low buzzing two-note fall for any failure. */
export function playError(): void {
  const c = getCtx()
  if (!c) return
  if (c.state === 'suspended') void c.resume()
  const t = c.currentTime
  tone(c, 220, t, 0.18, 'square', 0.18) // A3
  tone(c, 160, t + 0.16, 0.28, 'square', 0.18) // ~E3
}
