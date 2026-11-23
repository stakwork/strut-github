/**
 * What every step of stadeum/github shares: who may call it, the person's
 * own token, GitHub's API through strut's `http`, and what that token
 * reaches, for strut's `git/repositories`.
 *
 * Every token is a person's own. A step reads and writes the run's
 * person's own `GITHUB_TOKEN` (`secrets.own`, which strut gives a package
 * for the secrets it provides) and never `secrets.get`, which would fall
 * back to a deployment's value. A token goes to GitHub's API alone, in a
 * header, and never into an output, an error or anything kept: the package
 * keeps nothing of its own.
 */

/** This package's own app: where a person's token is changed, and where an admin sees the box's GitHub orgs. */
export const APP = "stadeum/github/github";
/** The secret a person's GitHub token is, as strut's github.com git entry and the connect seam name it. */
export const SECRET = "GITHUB_TOKEN";
/** GitHub's API: the only address a token is sent to. */
export const API = "https://api.github.com";
/** GitHub's own pages, which links open. */
export const WEB = "https://github.com";

const HEADERS = {
  accept: "application/vnd.github+json",
  "x-github-api-version": "2022-11-28",
  "user-agent": "stadeum-github",
};

/** A page of GitHub's lists: its largest. */
const PER_PAGE = 100;
/** How many pages of one list are read: 1,000 entries. */
const PAGES = 10;

interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  body: unknown;
}
type Http = (
  url: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: unknown; query?: Record<string, string | number | boolean>; timeout?: number },
) => Promise<HttpResponse>;

interface Scope {
  get(name: string): Promise<string | undefined>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<boolean>;
}

interface StepDef {
  input: { parse(v: unknown): unknown };
  run(cfg: unknown, ctx: unknown): Promise<unknown>;
}

/** The part of strut's step context these steps read. */
export interface Ctx {
  /** Set by strut's app door on a page's call: the app (its name from the
   *  identity strut signed for the page, so no other app can take this
   *  package's) and `admin` when its viewer is an admin. */
  app?: { name: string; version?: string; admin?: boolean };
  /** Set when a host (a host key) made the call, not a page. */
  host?: unknown;
  registry?: Record<string, StepDef | undefined>;
  services?: {
    http?: Http;
    /** `own`: the run's person's own values of what the package provides,
     *  present wherever the run has a person. */
    secrets?: { own?: Scope };
  };
}

export const asCtx = (ctx: unknown): Ctx => ctx as Ctx;

// ── who may call ──────────────────────────────────────────────────────────

/** A call from this package's own GitHub app, its published version (not a
 *  builder's preview), and a page's, not a host's. Strut's app door names
 *  the app from the identity it signed for the page, and no other app may
 *  take a name under an installed package's prefix. */
export function fromOwnApp(ctx: Ctx): boolean {
  const app = ctx.app;
  return app?.name === APP && !app.version?.startsWith("preview-") && !ctx.host;
}

/** An admin's call from the GitHub app: what the admin's parts need, held
 *  as stadeum/code holds its own changes. Any app may list these steps
 *  among its grants, so an admin's call from another app sees nothing. */
export const mayAdmin = (ctx: Ctx): boolean => fromOwnApp(ctx) && ctx.app?.admin === true;

/** A person's own token changes only by their own click in the GitHub app. */
export function requireOwnApp(ctx: Ctx, doing: string): void {
  if (fromOwnApp(ctx)) return;
  const from = ctx.app ? (ctx.app.name === APP ? "a preview of it" : ctx.app.name) : ctx.host ? "a host" : undefined;
  throw new Error(`${doing} is a person's own click in the GitHub app (${APP})${from ? `, not from ${from}` : ""}`);
}

export function requireAdmin(ctx: Ctx): void {
  if (mayAdmin(ctx)) return;
  if (ctx.app?.admin === true || ctx.host) {
    const from = ctx.app?.name === APP ? "a preview of it" : (ctx.app?.name ?? "a host");
    throw new Error(`the box's GitHub orgs are seen in the GitHub app (${APP}), not from ${from}`);
  }
  throw new Error("only an admin sees the box's GitHub orgs, in the GitHub app");
}

// ── the person's own token ────────────────────────────────────────────────

/** The run's person's own secrets, or why there are none: a call that is nobody's. */
export function own(ctx: Ctx): Scope {
  const scope = ctx.services?.secrets?.own;
  if (!scope) throw new Error("this call is nobody's: a GitHub account is a person's own, connected by them in the GitHub app, signed in");
  return scope;
}

/** The person's own token, never the deployment's, or none. */
export const tokenOf = (ctx: Ctx): Promise<string | undefined> => own(ctx).get(SECRET);

/**
 * How the token came to the box. A GitHub App's user token (`ghu_`) only
 * comes through the box's connect seam: a person's paste refuses one
 * (`pasted`). Anything else is a token the person made and pasted, which
 * may be in use elsewhere. Read off the token's own prefix, so nothing is
 * kept beside it.
 */
export type Kind = "app" | "pasted";
export const kindOf = (token: string): Kind => (token.startsWith("ghu_") ? "app" : "pasted");

/** Where a person deletes a token they made, on GitHub. */
export const tokensPage = (token: string): string =>
  token.startsWith("ghp_") ? `${WEB}/settings/tokens` : `${WEB}/settings/personal-access-tokens`;

const APP_TOKEN = /^gh[ousr]_/;
const PASTED = /^(?:github_pat_[A-Za-z0-9_]{20,255}|ghp_[A-Za-z0-9]{20,255})$/;

/** A token a person pastes, checked: one they made themselves. Says why
 *  not without repeating it. */
export function pasted(raw: unknown): string {
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) throw new Error("paste a GitHub personal access token: a fine-grained one starts github_pat_");
  if (APP_TOKEN.test(token)) {
    throw new Error("that is a token GitHub gave an app, not one you made: paste a personal access token of your own (a fine-grained one starts github_pat_), or connect GitHub");
  }
  if (!PASTED.test(token)) throw new Error("that is not a GitHub personal access token: a fine-grained one starts github_pat_, a classic one ghp_");
  return token;
}

// ── GitHub, through strut's http ──────────────────────────────────────────

const TOKEN_LIKE = /\b(?:gh[pousr]_[A-Za-z0-9]{6,}|github_pat_[A-Za-z0-9_]{6,})/g;

/** Text from GitHub or the network, safe to show: no token in it, short. */
export function scrub(text: string, ...secrets: Array<string | undefined>): string {
  let out = text;
  for (const s of secrets) if (s) out = out.split(s).join("[a token]");
  return out.replace(TOKEN_LIKE, "[a token]").replace(/\s+/g, " ").trim().slice(0, 300);
}

const said = (res: HttpResponse, token?: string): string => {
  const m = res.body && typeof res.body === "object" ? (res.body as { message?: unknown }).message : undefined;
  return typeof m === "string" && m ? scrub(m, token) : `HTTP ${res.status}`;
};

/**
 * One call of GitHub's API: `path` under https://api.github.com, through
 * the run's `http`, with the person's token in its header when given.
 * Nothing else is reached and nothing is followed elsewhere.
 */
export async function github(ctx: Ctx, path: string, opts: { token?: string; method?: string; body?: unknown; query?: Record<string, string | number> } = {}): Promise<HttpResponse> {
  const http = ctx.services?.http;
  if (!http) throw new Error("stadeum/github reaches GitHub through strut's http, and this call has none");
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`not a path of GitHub's API: ${path}`);
  const headers: Record<string, string> = { ...HEADERS, ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) };
  try {
    return await http(`${API}${path}`, {
      method: opts.method ?? "GET",
      headers,
      ...(opts.body !== undefined ? { body: opts.body } : {}),
      ...(opts.query ? { query: opts.query } : {}),
      timeout: 20_000,
    });
  } catch (e) {
    throw new Error(`GitHub can't be reached (${scrub(e instanceof Error ? e.message : String(e), opts.token)}): try again`);
  }
}

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

export interface Who {
  login: string;
  name?: string;
}

/** Whom a token is: GitHub's `GET /user` with it. `refused` when GitHub
 *  no longer takes it (wrong, expired or revoked). */
export async function whoIs(ctx: Ctx, token: string): Promise<Who | { refused: true }> {
  const res = await github(ctx, "/user", { token });
  if (res.status === 401) return { refused: true };
  if (!res.ok) throw new Error(`GitHub did not say whom the token is: ${said(res, token)}`);
  const body = (res.body ?? {}) as { login?: unknown; name?: unknown };
  const login = typeof body.login === "string" ? body.login : "";
  if (!LOGIN.test(login)) throw new Error("GitHub's answer to whom the token is names no account");
  return { login, ...(typeof body.name === "string" && body.name.trim() ? { name: scrub(body.name).slice(0, 100) } : {}) };
}

/**
 * Revoke a token at GitHub: `POST /credentials/revoke`, which takes any
 * token and no authentication (an authenticated call is refused), revokes
 * it for good and emails its owner. `revoked: false` says why, never
 * throws: a token is removed from the box whether or not GitHub answered.
 */
export async function revoke(ctx: Ctx, token: string): Promise<{ revoked: true } | { revoked: false; why: string }> {
  try {
    const res = await github(ctx, "/credentials/revoke", { method: "POST", body: { credentials: [token] } });
    if (res.ok) return { revoked: true };
    return { revoked: false, why: `GitHub answered ${res.status}: ${said(res, token)}` };
  } catch (e) {
    return { revoked: false, why: scrub(e instanceof Error ? e.message : String(e), token) };
  }
}

/** A refusal of a call made with the person's token, said so they can act on it. */
function refused(res: HttpResponse, token: string, what: string): Error {
  if (res.status === 401) return new Error("GitHub no longer accepts your token (it was revoked or it expired): disconnect, then connect again");
  if (res.status === 403 && kindOf(token) === "pasted") {
    return new Error(`GitHub shows ${what} only to a token its App gave you, and yours is one you pasted: disconnect, then connect GitHub`);
  }
  return new Error(`GitHub did not show ${what}: ${said(res, token)}`);
}

/** Every page of one of GitHub's lists, up to `PAGES` of them. */
async function pages<T>(ctx: Ctx, token: string, path: string, field: string, what: string): Promise<{ items: T[]; total: number }> {
  const items: T[] = [];
  let total = 0;
  for (let page = 1; page <= PAGES; page++) {
    const res = await github(ctx, path, { token, query: { per_page: PER_PAGE, page } });
    if (!res.ok) throw refused(res, token, what);
    const body = (res.body ?? {}) as Record<string, unknown>;
    const got = Array.isArray(body[field]) ? (body[field] as T[]) : [];
    total = typeof body["total_count"] === "number" ? body["total_count"] : items.length + got.length;
    items.push(...got);
    if (got.length < PER_PAGE || items.length >= total) break;
  }
  return { items, total: Math.max(total, items.length) };
}

export interface Installation {
  /** GitHub's id for the installation. */
  id: number;
  /** The org or person it is installed on. */
  account: string;
  type: "Organization" | "User";
  /** Every repository of the account, or the ones picked on GitHub. */
  repositories: "all" | "selected";
  suspended?: true;
  /** GitHub's own page for the installation, where its repositories are changed. */
  manage: string;
}

/** The installations a person's token sees: GitHub's `GET /user/installations`,
 *  which answers only a token a GitHub App issued. Orgs and people only. */
export async function installationsOf(ctx: Ctx, token: string): Promise<Installation[]> {
  const { items } = await pages<Record<string, unknown>>(ctx, token, "/user/installations", "installations", "an App's orgs");
  const out: Installation[] = [];
  for (const i of items) {
    const id = i["id"];
    const account = (i["account"] ?? {}) as { login?: unknown; type?: unknown };
    const login = typeof account.login === "string" ? account.login : "";
    const type = account.type === "Organization" || account.type === "User" ? account.type : undefined;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || !LOGIN.test(login) || !type) continue;
    const manage = type === "Organization" ? `${WEB}/organizations/${login}/settings/installations/${id}` : `${WEB}/settings/installations/${id}`;
    out.push({
      id,
      account: login,
      type,
      repositories: i["repository_selection"] === "selected" ? "selected" : "all",
      ...(i["suspended_at"] ? { suspended: true as const } : {}),
      manage,
    });
  }
  return out.sort((a, b) => (a.type === b.type ? a.account.localeCompare(b.account) : a.type === "Organization" ? -1 : 1));
}

const FULL_NAME = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

/**
 * One repository a person's token reaches, in strut's `git/repositories`
 * contract (stakwork/strut#851): `{ url, name, private?, pushed?,
 * description? }`, and `picked` when it was granted one by one.
 */
export interface Reached {
  /** Its https address. */
  url: string;
  name: string;
  private: boolean;
  /** When it was last pushed to, ISO 8601. */
  pushed?: string;
  description?: string;
  /** Picked for an installation of selected repositories, not granted
   *  with all of its owner's. */
  picked?: true;
}

/** A repository as GitHub's lists give it, in the contract's shape; none
 *  for an archived one (nothing is pushed there) or a name that is not one. */
function reached(r: Record<string, unknown>, picked: boolean): Reached | undefined {
  const m = FULL_NAME.exec(typeof r["full_name"] === "string" ? r["full_name"] : "");
  if (!m || m[2] === "." || m[2] === ".." || r["archived"] === true) return undefined;
  const pushed = typeof r["pushed_at"] === "string" && !Number.isNaN(Date.parse(r["pushed_at"])) ? r["pushed_at"] : undefined;
  const description = typeof r["description"] === "string" ? scrub(r["description"]).slice(0, 200) : "";
  return {
    url: `${WEB}/${m[1]}/${m[2]}`,
    name: m[2]!,
    private: r["private"] === true,
    ...(pushed ? { pushed } : {}),
    ...(description ? { description } : {}),
    ...(picked ? { picked: true as const } : {}),
  };
}

/** One repository an org grants the App, as the GitHub app lists it. */
export interface Granted {
  /** Its https address. */
  url: string;
  owner: string;
  name: string;
  private: boolean;
  archived?: true;
}

/** The repositories one installation grants a person's token: GitHub's
 *  `GET /user/installations/{id}/repositories`, by name, archived ones
 *  marked. A read-only list of what the connection reaches; it names no
 *  other package and says nothing of the box's workspaces. */
export async function grantedBy(ctx: Ctx, token: string, installation: number): Promise<{ repositories: Granted[]; total: number }> {
  const { items, total } = await pages<Record<string, unknown>>(ctx, token, `/user/installations/${installation}/repositories`, "repositories", "that org's repositories");
  const out: Granted[] = [];
  for (const r of items) {
    const m = FULL_NAME.exec(typeof r["full_name"] === "string" ? r["full_name"] : "");
    if (!m || m[2] === "." || m[2] === "..") continue;
    out.push({ url: `${WEB}/${m[1]}/${m[2]}`, owner: m[1]!, name: m[2]!, private: r["private"] === true, ...(r["archived"] === true ? { archived: true as const } : {}) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name) || a.owner.localeCompare(b.owner));
  return { repositories: out, total };
}

/**
 * Every repository a person's own token reaches, for strut's
 * `git/repositories`. A token the App gave: each installation it sees
 * (GitHub's `GET /user/installations/{id}/repositories`), a suspended one
 * left out, each repository `picked` when its installation was given
 * selected repositories. A token the person pasted: GitHub's `GET
 * /user/repos`, which lists what a personal token reaches. Archived
 * repositories are left out; each list is read to 1,000.
 */
export async function reachable(ctx: Ctx, token: string): Promise<Reached[]> {
  const seen = new Map<string, Reached>();
  const add = (r: Record<string, unknown>, picked: boolean) => {
    const one = reached(r, picked);
    const key = one?.url.toLowerCase();
    if (one && key && !seen.has(key)) seen.set(key, one);
  };
  if (kindOf(token) === "app") {
    for (const i of await installationsOf(ctx, token)) {
      if (i.suspended) continue;
      const { items } = await pages<Record<string, unknown>>(ctx, token, `/user/installations/${i.id}/repositories`, "repositories", `${i.account}'s repositories`);
      for (const r of items) add(r, i.repositories === "selected");
    }
  } else {
    const items = await listed(ctx, token, "/user/repos", { affiliation: "owner,collaborator,organization_member", sort: "pushed" }, "the repositories your token reaches");
    for (const r of items) add(r, false);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));
}

/** Every page of one of GitHub's plain lists (an array, not an object),
 *  up to `PAGES` of them. */
async function listed(ctx: Ctx, token: string, path: string, query: Record<string, string>, what: string): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= PAGES; page++) {
    const res = await github(ctx, path, { token, query: { ...query, per_page: PER_PAGE, page } });
    if (!res.ok) throw refused(res, token, what);
    const got = Array.isArray(res.body) ? (res.body as Array<Record<string, unknown>>) : [];
    items.push(...got);
    if (got.length < PER_PAGE) break;
  }
  return items;
}
