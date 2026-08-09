/**
 * Shared setup for the smoke suite.
 *
 * Two things every test gets for free:
 *
 * 1. A JS-error guard. Any uncaught exception or `console.error` fails the
 *    test at teardown. This is the single highest-value assertion here — most
 *    ways the page can "break" show up as a thrown error long before they show
 *    up as a missing element anyone thought to assert on.
 *
 * 2. Portrait requests stubbed. `playerPhotoUrl` points at FIVB's image
 *    service, which 404s for the many players with no photo on file (the UI
 *    falls back to initials by design). Those failures log as console errors
 *    and would drown the guard above in noise that means nothing — worse, a CI
 *    runner without egress would fail every test for the wrong reason.
 *
 *    Fulfilled with a stub image rather than aborted: an aborted request still
 *    logs `net::ERR_FAILED`, so blocking them would mean widening the error
 *    filter until it could hide a genuine failed fetch. A 200 makes the noise
 *    not exist instead of teaching the guard to ignore it, and keeps the suite
 *    free of outbound network calls either way.
 */

import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { GraphFile, Manifest, PlayersFile } from '../web/src/schema.js';

const DATA = path.resolve(import.meta.dirname, '../web/public/v1');

const read = <T>(...segments: string[]): T =>
  JSON.parse(readFileSync(path.join(DATA, ...segments), 'utf8')) as T;

export const manifest = () => read<Manifest>('manifest.json');
export const graph = (code: string, gender: string) =>
  read<GraphFile>('graphs', `${code}-${gender}.json`);
export const players = (code: string, gender: string) =>
  read<PlayersFile>('players', `${code}-${gender}.json`);

/** FIVB's portrait host — stubbed, see the header comment. */
const PHOTO_HOST = 'sharp.fivb.com';

/** 1x1 transparent PNG. */
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export const test = base.extend<{ jsErrors: string[] }>({
  jsErrors: [
    async ({ page }, use) => {
      await page.route(`**://${PHOTO_HOST}/**`, (route) =>
        route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG }),
      );

      const errors: string[] = [];
      page.on('pageerror', (err) => errors.push(`uncaught: ${err.message}`));
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });

      await use(errors);

      expect(errors, 'the page logged JavaScript errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
