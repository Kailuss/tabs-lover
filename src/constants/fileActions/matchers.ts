import * as path from 'path';
import type { FileAction } from './types';

/** Genera un matcher por extensiones (case-insensitive). */
export function byExtension(...exts: string[]): FileAction['match'] {
  const set = new Set(exts.map(e => e.toLowerCase()));
  return (fileName: string) => set.has(path.extname(fileName).toLowerCase());
}

/** Genera un matcher por nombre exacto del archivo (case-insensitive). */
export function byName(...names: string[]): FileAction['match'] {
  const set = new Set(names.map(n => n.toLowerCase()));
  return (fileName: string) => set.has(fileName.toLowerCase());
}

/** Genera un matcher por patrón en el nombre (case-insensitive). */
export function byPattern(regex: RegExp): FileAction['match'] {
  return (fileName: string) => regex.test(fileName);
}
