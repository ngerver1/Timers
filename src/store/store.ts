// The app's state: one document, kept in localStorage on the phone and saved on
// every change. Swap load/save for a sync backend later.
import { useSyncExternalStore } from 'react';
import { seedData, validateData, type StoreData } from './schema';

const KEY = 'outTheDoor';

export interface StorageStatus {
  /** Saved data existed but couldn't be read; a copy was kept under another key. */
  unreadable: boolean;
  /** The last save failed (storage full or blocked). */
  saveFailed: boolean;
}

const status: StorageStatus = { unreadable: false, saveFailed: false };

function load(): StoreData {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return seedData();
  }
  if (!raw) return seedData();
  try {
    return validateData(JSON.parse(raw));
  } catch {
    // Keep the unreadable copy rather than lose it, and start afresh.
    status.unreadable = true;
    try {
      localStorage.setItem(`${KEY}.unreadable.${Date.now()}`, raw);
    } catch {
      // Nothing more we can do.
    }
    return seedData();
  }
}

function save(data: StoreData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    status.saveFailed = false;
  } catch {
    status.saveFailed = true;
  }
}

let data: StoreData = load();
const listeners = new Set<() => void>();

export function getData(): StoreData {
  return data;
}

export function update(change: (d: StoreData) => StoreData): void {
  const next = change(data);
  if (next === data) return;
  data = next;
  save(data);
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useData(): StoreData {
  return useSyncExternalStore(subscribe, getData);
}

export function storageStatus(): StorageStatus {
  return { ...status };
}

/** Asks Chrome not to clear this site's storage when space runs low. Installed apps usually get it. */
export async function requestPersistence(): Promise<boolean | undefined> {
  try {
    if (!navigator.storage?.persist) return undefined;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return undefined;
  }
}

// Keep tabs in sync if the app is open twice.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue) return;
    try {
      data = validateData(JSON.parse(e.newValue));
      listeners.forEach((l) => l());
    } catch {
      // Ignore a half-written or foreign value.
    }
  });
}
