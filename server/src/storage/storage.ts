import type { FamilyData } from '../types.js';

/** Where tree.json and photos live. Local folder today; GCS / R2 later with the same interface. */
export interface Storage {
  readData(): Promise<FamilyData>;
  writeData(data: FamilyData): Promise<void>;
  savePhoto(name: string, bytes: Buffer): Promise<void>;
  readPhoto(name: string): Promise<Buffer | null>;
  deletePhoto(name: string): Promise<void>;
  listPhotos(): Promise<string[]>;
}
