/**
 * Where the GitHub app sends a person: the box's connect seam, and the Code
 * app. Plain functions, so the package's test reads them as the page does.
 */

/** The box's connect seam for GitHub, stadeum's route (its plans/software.md §2.1). */
const SEAM = "/api/connect/github";

/**
 * The box's connect seam, on the origin of the host's own page for this
 * app, coming back to that page: `https://<box>/api/connect/github?return=<page>`,
 * with `install=1` to start from GitHub's install page (Add a GitHub org).
 *
 * `page` is what strut hands an app as `strut/page` (@strut/kit
 * `useShareLink`): framed by Stadeum, Stadeum's own page for the app,
 * `https://<box>/apps/<name>`, on the box's origin, where the seam is;
 * in strut's own UI, strut's own address for it, `<strut>/?app=<name>`,
 * where there is none; in a native app's web view, nothing. So the seam is
 * offered only on a host's own page, never guessed on strut's: strut tells
 * an app its host's page, not whether the host has a seam.
 */
export function seamLink(page: string | undefined, opts: { install?: boolean } = {}): string | undefined {
  if (!page) return undefined;
  let at: URL;
  try {
    at = new URL(page);
  } catch {
    return undefined;
  }
  if (at.protocol !== "https:" && at.protocol !== "http:") return undefined;
  // Strut's own UI: the page names the app it opens (`?app=`); a host's page does not.
  if (at.searchParams.has("app")) return undefined;
  const seam = new URL(SEAM, at.origin);
  seam.searchParams.set("return", at.href);
  if (opts.install) seam.searchParams.set("install", "1");
  return seam.href;
}
