export class RingBuffer<T> {
  private readonly values: (T | undefined)[];
  private cursor = 0;
  private count = 0;
  public constructor(private readonly capacity: number) { this.values = new Array<T | undefined>(capacity); }
  public push(value: T): void { this.values[this.cursor] = value; this.cursor = (this.cursor + 1) % this.capacity; this.count = Math.min(this.count + 1, this.capacity); }
  public snapshot(): readonly T[] {
    const result: T[] = [];
    const start = this.count === this.capacity ? this.cursor : 0;
    for (let i = 0; i < this.count; i += 1) { const value = this.values[(start + i) % this.capacity]; if (value !== undefined) result.push(value); }
    return result;
  }
}
