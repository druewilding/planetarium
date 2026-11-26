// The simulated clock: a UTC instant that advances at a chosen rate, with
// smooth easing when it jumps.

export const RATES = [
  { rate: -43200, label: "−12 hours / s" },
  { rate: -21600, label: "−6 hours / s" },
  { rate: -10800, label: "−3 hours / s" },
  { rate: -3600, label: "−1 hour / s" },
  { rate: -600, label: "−10 min / s" },
  { rate: -60, label: "−1 min / s" },
  { rate: 1, label: "Real time" },
  { rate: 60, label: "1 min / s" },
  { rate: 600, label: "10 min / s" },
  { rate: 3600, label: "1 hour / s" },
  { rate: 10800, label: "3 hours / s" },
  { rate: 21600, label: "6 hours / s" },
  { rate: 43200, label: "12 hours / s" },
];
const REAL_TIME = RATES.findIndex((r) => r.rate === 1);

export class Clock {
  constructor() {
    this.ms = Date.now();
    this.rateIndex = REAL_TIME;
    this.playing = true;
    this.tween = null;
    this.listeners = new Set();
  }

  get rate() {
    return RATES[this.rateIndex].rate;
  }

  get rateLabel() {
    return this.playing ? RATES[this.rateIndex].label : "Paused";
  }

  get following() {
    return this.playing && this.rateIndex === REAL_TIME && Math.abs(this.ms - Date.now()) < 5000;
  }

  onChange(fn) {
    this.listeners.add(fn);
  }

  emit() {
    for (const fn of this.listeners) fn(this);
  }

  update(dtSeconds) {
    if (this.tween) {
      const t = this.tween;
      t.elapsed += dtSeconds;
      const k = Math.min(1, t.elapsed / t.duration);
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      this.ms = t.from + (t.to - t.from) * e;
      if (k >= 1) this.tween = null;
      // Keep the target moving while playing so we land on a live clock.
      if (this.playing) t.to += dtSeconds * this.rate * 1000;
      return;
    }
    if (this.playing) this.ms += dtSeconds * this.rate * 1000;
  }

  /** Jump to an instant. Short jumps glide; long ones snap so the sky doesn't strobe. */
  set(ms, { animate = true } = {}) {
    const delta = Math.abs(ms - this.ms);
    if (animate && delta > 1000 && delta < 3 * 86400000) {
      this.tween = { from: this.ms, to: ms, elapsed: 0, duration: Math.min(1.2, 0.35 + delta / 86400000) };
    } else {
      this.tween = null;
      this.ms = ms;
    }
    this.emit();
  }

  nudge(deltaMs) {
    this.tween = null;
    this.ms += deltaMs;
    this.emit();
  }

  now() {
    this.rateIndex = REAL_TIME;
    this.playing = true;
    this.set(Date.now());
  }

  /** Back to real speed, if it's going faster or backwards (paused stays paused). */
  realSpeed() {
    if (this.rateIndex === REAL_TIME) return;
    this.rateIndex = REAL_TIME;
    this.emit();
  }

  togglePlay() {
    this.playing = !this.playing;
    this.emit();
  }

  faster() {
    if (!this.playing) this.playing = true;
    else this.rateIndex = Math.min(RATES.length - 1, this.rateIndex + 1);
    this.emit();
  }

  slower() {
    if (!this.playing) this.playing = true;
    else this.rateIndex = Math.max(0, this.rateIndex - 1);
    this.emit();
  }
}
