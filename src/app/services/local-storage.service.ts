import { Injectable } from '@angular/core';
import { openDB, IDBPDatabase } from 'idb';

@Injectable({
  providedIn: 'root',
})
export class LocalStorageService {
  private dbPromise = openDB('my-database', 1, {
    upgrade(db: IDBPDatabase) {
      db.createObjectStore('keyval');
    },
  });

  async setItem(key: string, value: any): Promise<void> {
    const db = await this.dbPromise;
    await db.put('keyval', value, key);
  }

  async getItem(key: string): Promise<any> {
    const db = await this.dbPromise;
    return db.get('keyval', key);
  }

  async removeItem(key: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete('keyval', key);
  }

  async clear(): Promise<void> {
    const db = await this.dbPromise;
    await db.clear('keyval');
  }
}
