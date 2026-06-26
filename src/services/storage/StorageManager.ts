
import { StorageProvider } from './types';
import { LocalStorageProvider } from './LocalStorageProvider';
import { MemoryProvider } from './MemoryProvider';

class StorageManager {
  private primary: StorageProvider;
  private secondary: StorageProvider;

  constructor() {
    this.primary = new LocalStorageProvider();
    this.secondary = new MemoryProvider();
  }

  getItem(key: string): string | null {
    let value = this.primary.getItem(key);
    if (value === null) {
      value = this.secondary.getItem(key);
    }
    return value;
  }

  setItem(key: string, value: string): void {
    this.primary.setItem(key, value);
    this.secondary.setItem(key, value);
  }

  removeItem(key: string): void {
    this.primary.removeItem(key);
    this.secondary.removeItem(key);
  }
}

export const storageManager = new StorageManager();
