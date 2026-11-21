/**
 * Where the GitHub app sends a person: the box's connect seam. A plain
 * function, so the package's test reads it as the page does.
 */

/** The box's connect seam for GitHub, stadeum's route (its plans/software.md §2.1). */
const SEAM = "/api/connect/github";

/**
 * The box's connect seam, on the host's own page's origin, coming back to
 * that page: `https://<box>/api/connect/github?return=<page>`, with
 * `install=1` to start from GitHub's install page (Add a GitHub org). Or
 * none, when that page cannot be shown to be the box's.
 *
 * `page` is what strut hands an app as `strut/page` (@strut/kit
 * `useShareLink`). Framed by Stadeum it is the box's own page for the app,
 * `https://<box>/apps/<name>`. But strut takes that address from its embed
 * URL's `embed_page` and `embed_origin` (web/src/embed.ts), checks it
 * against nothing it was told to trust, and lets any page frame it; a page
 * on the same site as strut (any `*.<the box's domain>`) frames it signed
 * in. So `page` alone may name any origin at all.
 *
 * `strut` is the address strut's own page was loaded from: the app's
 * document is a `srcdoc` inside it, whose base URL is that page's
 * (`document.baseURI`), set by the browser, never by a URL's parameters. A
 * box serves strut at `strut.<box>` and Stadeum, with its seam, at `<box>`
 * (stadeum's compose; the seam's own `return` rule names the same pair). So
 * the seam is offered only when the page is on that `<box>`: the host whose
 * strut this is. Anywhere else (another origin, strut's own UI at
 * `strut.<box>`, a strut not served at `strut.…`, a native app's web view)
 * there is none, and the app offers Paste. Ports may differ, as on a
 * developer's machine: a port of the box's own host is still the box's.
 */
export function seamLink(page: string | undefined, strut: string | undefined, opts: { install?: boolean } = {}): string | undefined {
  const at = parse(page);
  const self = parse(strut);
  if (!at || !self) return undefined;
  if (!self.hostname.startsWith("strut.")) return undefined;
  const box = self.hostname.slice("strut.".length);
  if (!box.includes(".") || at.hostname !== box || at.protocol !== self.protocol) return undefined;
  const seam = new URL(SEAM, at.origin);
  seam.searchParams.set("return", at.href);
  if (opts.install) seam.searchParams.set("install", "1");
  return seam.href;
}

const parse = (raw: string | undefined): URL | undefined => {
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url : undefined;
  } catch {
    return undefined;
  }
};
