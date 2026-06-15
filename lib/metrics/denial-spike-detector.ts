export class DenialSpikeDetector {
  private events: Array<{ id: string; ts: number }> = [];
  private readonly WINDOW_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SPIKE_THRESHOLD = 10; // >10 denials

  record(event: { id: string; timestamp: string }): void {
    const ts = new Date(event.timestamp).getTime();
    this.events.push({ id: event.id, ts });
    this.pruneOldEvents();
  }

  private pruneOldEvents(): void {
    const now = Date.now();
    const cutoff = now - this.WINDOW_MS;
    this.events = this.events.filter(event => event.ts >= cutoff);
  }

  isSpiking(): boolean {
    this.pruneOldEvents();
    return this.events.length > this.SPIKE_THRESHOLD;
  }

  getSpikePayload(): {
    count: number;
    window_start: string;
    window_end: string;
    audit_row_ids: string[];
  } {
    this.pruneOldEvents();
    const now = Date.now();
    const windowStart = new Date(now - this.WINDOW_MS).toISOString();
    const windowEnd = new Date(now).toISOString();
    
    return {
      count: this.events.length,
      window_start: windowStart,
      window_end: windowEnd,
      audit_row_ids: this.events.map(e => e.id)
    };
  }
}