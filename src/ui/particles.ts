import { TUNING } from '../app/tuning/index.ts';

export interface BurstOptions {
  count: number;
  colors: readonly string[];
  /** Pixels per second. */
  speed: readonly [number, number];
  /** Center direction in radians (0 points right, positive turns down). */
  angle?: number;
  /** Full cone width in radians. 2π is a full circle. */
  spread?: number;
  gravity?: number;
  /** Seconds. */
  life: readonly [number, number];
  /** Diameter, in CSS pixels. */
  size: readonly [number, number];
  /** Random start offset around (x, y), in CSS pixels. */
  jitter?: number;
}

/** Side of one dot of the sprite, in sprite pixels: sharp up to a 16 CSS px dot at a ratio of 2. */
const DOT_PX = 32;

/**
 * Round particles from a fixed pool, in screen space (CSS pixels). One sprite holds one pre-rendered dot for each
 * color, so a frame is only `drawImage` calls from one source, never a path per particle.
 */
export class ParticleField {
  enabled = true;
  private readonly capacity: number;
  private readonly x: Float32Array;
  private readonly y: Float32Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly gravity: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly color: Uint8Array;
  private readonly palette: string[] = [];
  private readonly paletteIndex = new Map<string, number>();
  private sprite: HTMLCanvasElement | null = null;
  private spriteCtx: CanvasRenderingContext2D | null = null;
  private count = 0;

  constructor(capacity: number = TUNING.particles.budget) {
    this.capacity = capacity;
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.color = new Uint8Array(capacity);
  }

  get alive(): boolean {
    return this.count > 0;
  }

  burst(x: number, y: number, options: BurstOptions): void {
    if (!this.enabled || options.colors.length === 0) return;
    const spread = options.spread ?? Math.PI * 2;
    const angle = options.angle ?? 0;
    const jitter = options.jitter ?? 0;
    const total = Math.min(options.count, this.capacity - this.count);
    for (let n = 0; n < total; n++) {
      const slot = this.colorSlot(options.colors[n % options.colors.length]);
      if (slot < 0) return;
      const i = this.count++;
      const direction = angle + (Math.random() - 0.5) * spread;
      const speed = between(options.speed);
      this.x[i] = x + (Math.random() - 0.5) * jitter;
      this.y[i] = y + (Math.random() - 0.5) * jitter;
      this.vx[i] = Math.cos(direction) * speed;
      this.vy[i] = Math.sin(direction) * speed;
      this.gravity[i] = options.gravity ?? TUNING.particles.gravity;
      this.maxLife[i] = this.life[i] = between(options.life);
      this.size[i] = between(options.size);
      this.color[i] = slot;
    }
  }

  /** Returns true while a particle is alive. */
  step(dt: number): boolean {
    let i = 0;
    while (i < this.count) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.removeAt(i);
        continue;
      }
      this.vy[i] += this.gravity[i] * dt;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      i++;
    }
    if (this.count === 0) this.resetPalette();
    return this.count > 0;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const sprite = this.sprite;
    if (this.count === 0 || !sprite) return;
    const smoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    for (let i = 0; i < this.count; i++) {
      const side = this.size[i] * Math.min(1, (this.life[i] / this.maxLife[i]) * 1.6);
      if (side < 0.25) continue;
      ctx.drawImage(sprite, this.color[i] * DOT_PX, 0, DOT_PX, DOT_PX, this.x[i] - side / 2, this.y[i] - side / 2, side, side);
    }
    ctx.imageSmoothingEnabled = smoothing;
  }

  clear(): void {
    this.count = 0;
    this.resetPalette();
  }

  /** The sprite slot of a color, drawn on first use; -1 when no sprite can exist. */
  private colorSlot(color: string): number {
    const known = this.paletteIndex.get(color);
    if (known !== undefined) return known;
    const ctx = this.spriteContext();
    if (!ctx) return -1;
    if (this.palette.length >= TUNING.particles.maxColors) return this.palette.length - 1;
    const slot = this.palette.length;
    this.palette.push(color);
    this.paletteIndex.set(color, slot);
    ctx.clearRect(slot * DOT_PX, 0, DOT_PX, DOT_PX);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(slot * DOT_PX + DOT_PX / 2, DOT_PX / 2, DOT_PX / 2 - 1, 0, Math.PI * 2);
    ctx.fill();
    return slot;
  }

  private spriteContext(): CanvasRenderingContext2D | null {
    if (this.spriteCtx) return this.spriteCtx;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = DOT_PX * TUNING.particles.maxColors;
    canvas.height = DOT_PX;
    this.spriteCtx = canvas.getContext('2d');
    this.sprite = this.spriteCtx ? canvas : null;
    return this.spriteCtx;
  }

  private resetPalette(): void {
    this.palette.length = 0;
    this.paletteIndex.clear();
  }

  private removeAt(i: number): void {
    const last = --this.count;
    this.x[i] = this.x[last];
    this.y[i] = this.y[last];
    this.vx[i] = this.vx[last];
    this.vy[i] = this.vy[last];
    this.gravity[i] = this.gravity[last];
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.size[i] = this.size[last];
    this.color[i] = this.color[last];
  }
}

function between(range: readonly [number, number]): number {
  return range[0] + Math.random() * (range[1] - range[0]);
}
