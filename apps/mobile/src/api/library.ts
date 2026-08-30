/**
 * api/library.ts — client untuk /library (liked songs & playlists akun).
 * Endpoint butuh cookie; 401 dari proxy = belum login.
 */
import { api } from './client';
import type { HomeResponse } from './types';

export type LibraryResponse = HomeResponse;

/** 401 → throw Error('login') — ditangkap caller untuk render empty-login state. */
export async function library(): Promise<LibraryResponse> {
  try {
    return await api<LibraryResponse>('/library');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('proxy 401')) throw new Error('login');
    throw err;
  }
}
