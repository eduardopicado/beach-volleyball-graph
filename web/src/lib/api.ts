/**
 * Data access for the published `/v1/` files.
 *
 * Everything is a static JSON fetch against the same origin, so there is no
 * client, no auth and no retry policy worth speaking of — but slices are
 * memoised because switching country back and forth is the common interaction.
 */

import type { GraphFile, Manifest, PlayersFile, Gender } from '../schema';
import { graphPath, manifestPath, playersPath } from '../schema';

/** Vite rewrites this to the deploy base ("/" or "/<repo>/"). */
const BASE = import.meta.env.BASE_URL;

const cache = new Map<string, Promise<unknown>>();

function load<T>(url: string): Promise<T> {
  let hit = cache.get(url) as Promise<T> | undefined;
  if (!hit) {
    hit = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return res.json() as Promise<T>;
    });
    // A failed fetch must not be cached, or a transient blip is permanent.
    hit.catch(() => cache.delete(url));
    cache.set(url, hit);
  }
  return hit;
}

export const fetchManifest = () => load<Manifest>(manifestPath(BASE));

export const fetchGraph = (country: string, gender: Gender) =>
  load<GraphFile>(graphPath(BASE, country, gender));

export const fetchPlayers = (country: string, gender: Gender) =>
  load<PlayersFile>(playersPath(BASE, country, gender));
