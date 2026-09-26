export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'CLOSED';

  public constructor(private readonly cooldownMs = 5000, private readonly now = () => Date.now()) {}
  public get currentState(): CircuitState { return this.state; }
  public allow(): boolean {
    if (this.state !== 'OPEN') return true;
    if (this.now() - this.openedAt < this.cooldownMs) return false;
    this.state = 'HALF_OPEN';
    return true;
  }
  public success(): void { this.failures = 0; this.state = 'CLOSED'; }
  public failure(): void {
    this.failures += 1;
    if (this.failures >= 3) { this.state = 'OPEN'; this.openedAt = this.now(); }
  }
}
