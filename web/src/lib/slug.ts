/**
 * URL slugs for country x gender pages.
 *
 * Shared by the prerenderer (which writes `/brazil-men/index.html`) and the app
 * (which resolves that path back to a slice), so a link can never point at a
 * page the other side would not produce.
 */

import type { Gender } from '../schema';

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics: "Côte d'Ivoire" -> "Cote d'Ivoire"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const GENDER_SLUG: Record<Gender, string> = { M: 'men', W: 'women' };

/** e.g. ("Brazil", "M") -> "brazil-men" */
export function sliceSlug(countryName: string, gender: Gender): string {
  return `${slugify(countryName)}-${GENDER_SLUG[gender]}`;
}

/** Absolute site path for a slice, honouring the deploy base ("/" or "/repo/"). */
export function slicePath(base: string, countryName: string, gender: Gender): string {
  return `${base}${sliceSlug(countryName, gender)}/`;
}

/**
 * Resolve a pathname back to a slug, ignoring the deploy base and any
 * trailing "index.html". Returns null for the site root.
 */
export function slugFromPath(pathname: string, base: string): string | null {
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, '');
  rest = rest.replace(/index\.html$/, '').replace(/^\/+|\/+$/g, '');
  return rest === '' ? null : rest;
}
