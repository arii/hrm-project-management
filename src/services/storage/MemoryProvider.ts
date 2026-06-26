
import { StorageProvider } from './types';

export class MemoryProvider implements StorageProvider {
  private cache: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.cache[key] || null;
  }
  setItem(key: string, value: string): void {
    this.cache[key] = value;
  }
  removeItem(key: string): void {
    delete this.cache[key];
  }
}
