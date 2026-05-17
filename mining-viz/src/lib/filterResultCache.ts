const MAX_ENTRIES = 48;

export class FilterResultCache<T> {
  private readonly store = new Map<string, T>();

  get(key: string): T | undefined {
    const hit = this.store.get(key);
    if (hit === undefined) return undefined;
    this.store.delete(key);
    this.store.set(key, hit);
    return hit;
  }

  set(key: string, value: T): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, value);
  }

  clear(): void {
    this.store.clear();
  }
}
