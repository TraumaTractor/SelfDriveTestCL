/** Small seeded PRNG (mulberry32) so every scenario is reproducible. */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximately normal (sum of uniforms), mean 0, sd ~1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732;
  }

  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }

  weighted<T extends string>(weights: Record<T, number>): T {
    const keys = Object.keys(weights) as T[];
    let total = 0;
    for (const k of keys) total += Math.max(0, weights[k]);
    if (total <= 0) return keys[0];
    let r = this.next() * total;
    for (const k of keys) {
      r -= Math.max(0, weights[k]);
      if (r <= 0) return k;
    }
    return keys[keys.length - 1];
  }

  fork(): Rng {
    return new Rng(Math.floor(this.next() * 4294967296));
  }
}
