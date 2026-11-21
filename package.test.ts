/**
 * stadeum/github on a strut server, the way it runs on a box: installed from
 * this directory (`file:`) into a strut started in this process from a
 * checkout of stakwork/strut's main (`STRUT_DIR`, default `../strut`, with
 * its install), on a LadybugDB file. Then driven as the GitHub app's page
 * drives it: a member's call and an admin's, and an admin's call from
 * another package's app. stadeum/code (`STRUT_CODE_DIR`, default
 * `../strut-code`) is installed partway, to see a repository already on the
 * box's list marked so, read through the graph without requiring it.
 *
 * GitHub's API is stood in for through strut's own `http` (`createStrut({
 * services: { http } })`, as strut's tests stand in for it): a fetch that
 * answers https://api.github.com as GitHub does for each made-up token,
 * records every request, and refuses any other address. No real token is
 * read and nothing reaches GitHub: GITHUB_TOKEN is unset here, and the
 * deployment's GITHUB_TOKEN this test sets is one GitHub would answer for,
 * to see that no step ever sends it.
 *
 *   STRUT_DIR=../strut STRUT_CODE_DIR=../strut-code npm test
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { githubKey, kindOf, pasted, scrub } from "./steps/_github.ts";
import { seamLink } from "./apps/github/src/links.ts";

const STRUT = resolve(process.env["STRUT_DIR"] ?? "../strut");
const CODE_DIR = resolve(process.env["STRUT_CODE_DIR"] ?? "../strut-code");
// Nobody's token: not this machine's, not its git's.
for (const k of ["GITHUB_TOKEN", "GH_TOKEN", "STRUT_GIT_LOCAL"]) delete process.env[k];
const from = async <T>(path: string): Promise<T> => (await import(pathToFileURL(join(STRUT, "src", path)).href)) as T;

const HERE = resolve(".");
const APP = "stadeum/github/github";
const OTHER_APP = "acme/other/console";
const STEPS = ["stadeum/github/me", "stadeum/github/paste", "stadeum/github/disconnect", "stadeum/github/installations", "stadeum/github/repositories"];

/** Another package, whose app an admin may open, granting this package's steps: it must see and change nothing. */
const OTHER: Record<string, string> = {
  "strut.yaml": "package: acme/other\nversion: 0.1.0\n",
  "apps/console/app.yaml": ["title: Console", "grants:", `  steps: [${STEPS.join(", ")}]`, ""].join("\n"),
  "apps/console/src/App.tsx": "export default function App() { return <p>console</p>; }\n",
};

const hex = (n: number) => randomBytes(n).toString("hex");
/** Made-up tokens, each GitHub's shape: App user tokens the seam would write, personal ones a person pastes. */
const T = {
  root: `ghu_${hex(18)}`, // the admin's, through the App
  ada: `ghu_${hex(18)}`, // a member's, through the App
  carl: `ghu_${hex(18)}`, // an App token whose revocation GitHub fails to take
  bea: `github_pat_${hex(30)}`, // a member's pasted fine-grained token
  dee: `github_pat_${hex(30)}`, // an admin's pasted token
  gone: `github_pat_${hex(30)}`, // one GitHub refuses
  hive: `ghu_${hex(18)}`, // an App token from elsewhere, pasted: refused
  deployment: `ghu_${hex(18)}`, // the deployment's: no step may send it
};
const ALL_TOKENS = Object.values(T);
const LOGIN: Record<string, string> = { [T.root]: "root-gh", [T.ada]: "ada-gh", [T.carl]: "carl-gh", [T.bea]: "bea-gh", [T.dee]: "dee-gh", [T.hive]: "hive-gh", [T.deployment]: "the-box" };

/** The org on the App, its repositories: 101, so a list takes two pages. One is on the box's list in another case. */
const ACME_REPOS = [{ full_name: "acme/App", private: true }, { full_name: "acme/web", private: false, archived: true }, ...Array.from({ length: 99 }, (_, i) => ({ full_name: `acme/r${String(i).padStart(3, "0")}`, private: true }))];
const INSTALLATIONS = [
  { id: 202, account: { login: "root-gh", type: "User" }, repository_selection: "all", app_slug: "stadeum-ai" },
  { id: 101, account: { login: "acme", type: "Organization" }, repository_selection: "selected", app_slug: "stadeum-ai" },
  { id: 303, account: { slug: "big-enterprise", name: "Big" }, repository_selection: "all", app_slug: "stadeum-ai" },
];

interface Call {
  url: string;
  method: string;
  auth?: string;
  body?: string;
}

/** GitHub's API, stood in for: what strut's `http` fetches. */
function standInGitHub(calls: Call[]) {
  const revoked = new Set<string>();
  const json = (status: number, body: unknown) => ({
    status,
    ok: status >= 200 && status < 300,
    headers: { forEach: (cb: (v: string, k: string) => void) => cb("application/json; charset=utf-8", "content-type") },
    text: async () => JSON.stringify(body),
  });
  const fetch = async (raw: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    const method = init?.method ?? "GET";
    const auth = Object.entries(init?.headers ?? {}).find(([k]) => k.toLowerCase() === "authorization")?.[1];
    calls.push({ url: raw, method, ...(auth ? { auth } : {}), ...(init?.body ? { body: init.body } : {}) });
    const url = new URL(raw);
    if (url.origin !== "https://api.github.com") throw new Error(`the stand-in GitHub answers api.github.com alone, not ${url.origin}`);
    if (url.pathname === "/credentials/revoke" && method === "POST") {
      if (auth) return json(403, { message: "Must not be authenticated" });
      const { credentials } = JSON.parse(init?.body ?? "{}") as { credentials?: string[] };
      if (credentials?.includes(T.carl)) return json(422, { message: "Validation Failed" });
      for (const c of credentials ?? []) revoked.add(c);
      return json(202, {});
    }
    const token = auth?.replace(/^Bearer /, "");
    if (!token || !LOGIN[token] || revoked.has(token) || token === T.gone) return json(401, { message: "Bad credentials" });
    if (url.pathname === "/user") return json(200, { login: LOGIN[token], id: 1, name: `${LOGIN[token]} person`, type: "User" });
    if (url.pathname === "/user/installations") {
      if (!token.startsWith("ghu_")) return json(403, { message: "You must authenticate with an access token authorized to a GitHub App in order to list installations" });
      return json(200, { total_count: INSTALLATIONS.length, installations: INSTALLATIONS });
    }
    const m = /^\/user\/installations\/(\d+)\/repositories$/.exec(url.pathname);
    if (m) {
      const repos = m[1] === "101" ? ACME_REPOS : m[1] === "202" ? [{ full_name: "root-gh/dotfiles", private: false }] : undefined;
      if (!repos) return json(404, { message: "Not Found" });
      const per = Number(url.searchParams.get("per_page") ?? 30);
      const page = Number(url.searchParams.get("page") ?? 1);
      const slice = repos.slice((page - 1) * per, page * per).map((r) => ({ ...r, html_url: `https://github.com/${r.full_name}`, default_branch: "main" }));
      return json(200, { total_count: repos.length, repository_selection: "selected", repositories: slice });
    }
    return json(404, { message: "Not Found" });
  };
  return { fetch, revoked };
}

describe("the package's own rules", () => {
  it("knows a token the App gave from one a person made, by its prefix", () => {
    assert.equal(kindOf(T.ada), "app");
    assert.equal(kindOf(T.bea), "pasted");
    assert.equal(kindOf(`ghp_${hex(20)}`), "pasted");
  });

  it("takes only a personal access token to paste, and never says it back", () => {
    assert.equal(pasted(`  ${T.bea}\n`), T.bea);
    const classic = `ghp_${hex(20)}`;
    assert.equal(pasted(classic), classic);
    for (const [raw, why] of [
      ["", /paste a GitHub personal access token/],
      [T.hive, /a token GitHub gave an app, not one you made/],
      [`gho_${hex(20)}`, /a token GitHub gave an app/],
      [`github_pat_${hex(5)}`, /not a GitHub personal access token/],
      [`github_pat_${hex(20)} x`, /not a GitHub personal access token/],
      ["hunter2", /not a GitHub personal access token/],
    ] as const) {
      assert.throws(() => pasted(raw), (e: Error) => why.test(e.message) && (!raw.trim() || !e.message.includes(raw.trim())), raw);
    }
  });

  it("scrubs a token out of anything it shows", () => {
    assert.equal(scrub(`bad ${T.ada} and ${T.bea}`), "bad [a token] and [a token]");
    assert.equal(scrub("weird value 12345", "12345"), "weird value [a token]");
  });

  it("reads a github.com address one way, as GitHub's names ignore case", () => {
    assert.equal(githubKey("https://github.com/Acme/App"), "acme/app");
    assert.equal(githubKey("https://GitHub.com/acme/app.git"), "acme/app");
    assert.equal(githubKey("https://gitlab.com/acme/app"), undefined);
    assert.equal(githubKey("https://github.com/acme/app/tree/main"), undefined);
  });

  it("sends a person to the box's connect seam on the host's own page, never strut's own", () => {
    const page = "https://acme.stakwork.ai/apps/stadeum%2Fgithub%2Fgithub";
    assert.equal(seamLink(page), `https://acme.stakwork.ai/api/connect/github?return=${encodeURIComponent(page)}`);
    assert.equal(seamLink(page, { install: true }), `https://acme.stakwork.ai/api/connect/github?return=${encodeURIComponent(page)}&install=1`);
    // Strut's own UI hands its own address, which names the app: it has no seam.
    assert.equal(seamLink("https://strut.acme.stakwork.ai/?app=stadeum%2Fgithub%2Fgithub"), undefined);
    // A native app's web view hands none.
    assert.equal(seamLink(undefined), undefined);
    assert.equal(seamLink("javascript:alert(1)"), undefined);
  });
});

describe("stadeum/github on strut", { timeout: 300_000 }, () => {
  let root = "";
  // Strut's own types, loose: this test reads them from a checkout.
  let strut: any;
  let tools: any;
  let store: any;
  let appIdentity: (name: string, version: string) => string;
  let STEP_RUN: string;
  const versions: Record<string, string> = {};
  const calls: Call[] = [];
  let github: ReturnType<typeof standInGitHub>;
  /** Everything a page, an event or a log was given: no token may be in it. */
  const seen: string[] = [];
  const logged: string[] = [];
  const consoleWas = { ...console };

  /** A call from an app's page (the GitHub app's unless named), as its viewer: `admin` when strut says so. */
  const page = (actor: string, admin: boolean, app = APP) => {
    const t = tools.buildAppTools({ apps: strut.apps, registry: strut.getRegistry(), services: strut.services, actor, admin, runStepDeps: { store, workspace: strut.workspace } });
    return async (type: string, config: Record<string, unknown> = {}): Promise<{ error?: string; result?: any }> => {
      const out = await t[STEP_RUN].execute({ type, config, app: appIdentity(app, versions[app]!) }, { toolCallId: "t", messages: [] });
      seen.push(JSON.stringify(out));
      return out;
    };
  };
  const ok = async (p: Promise<{ error?: string; result?: any }>) => {
    const out = await p;
    assert.equal(out.error, undefined, out.error);
    return out.result;
  };
  /** A person's own secret, as the connect seam writes it. */
  const seam = async (actor: string, value: string) => {
    const res = await strut.app.request(`/actors/${actor}/secrets/GITHUB_TOKEN`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value }) });
    assert.equal(res.status, 200, await res.text());
  };
  const hasOwn = async (actor: string) => {
    const { secrets } = await (await strut.app.request(`/actors/${actor}/secrets`)).json();
    return (secrets as Array<string | { name: string }>).some((s) => (typeof s === "string" ? s : s.name) === "GITHUB_TOKEN");
  };
  const since = (n: number) => calls.slice(n);
  /** Install a package from a directory as a person, as a box's admin does with the deployment key and their actor. */
  const install = async (dir: string) => {
    const key = `key-${hex(8)}`;
    process.env["STRUT_API_KEY"] = key;
    try {
      const res = await strut.app.request("/packages/install", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}`, "x-strut-actor": "root" },
        body: JSON.stringify({ ref: `file:${dir}` }),
      });
      const body = await res.json();
      assert.equal(res.status, 201, JSON.stringify(body));
      return body;
    } finally {
      delete process.env["STRUT_API_KEY"];
    }
  };
  /** Run one step as a workflow of its own would: no page, no app. */
  const once = async (name: string, step: string, config: Record<string, unknown>, actor = "root") => {
    await strut.workspace.publishWorkflowByContent(`test/${name}`, `steps:\n  - id: s\n    type: ${step}\n    config: ${JSON.stringify(config)}\n`);
    const run = await strut.run(`test/${name}`, {}, { actor, principal: actor });
    seen.push(JSON.stringify(run));
    return run;
  };

  before(async () => {
    delete process.env["STRUT_API_KEY"];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      console[level] = (...args: unknown[]) => {
        logged.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === "string" ? a : JSON.stringify(a))).join(" "));
        consoleWas[level](...args);
      };
    }
    root = await mkdtemp(join(tmpdir(), "strut-github-test-"));
    store = new (await from<any>("store.ts")).MemoryRunStore();
    const { createStrut } = await from<any>("createStrut.ts");
    const { httpCapability } = await from<any>("capabilities.ts");
    const { openGraphBackend } = await from<any>("graph/backend.ts");
    const { PRIVATE_NAMESPACE } = await from<any>("graph/ladybug/namespaces.ts");
    const { GraphWorkspaceStore } = await from<any>("graph/workspace-store.ts");
    const { kitForTests } = await from<any>("test-util/app-kit.ts");
    tools = await from<any>("apps/tools.ts");
    STEP_RUN = tools.STEP_RUN_TOOL;
    appIdentity = (await from<any>("auth.ts")).appIdentity;
    github = standInGitHub(calls);
    const graph = await openGraphBackend({ kind: "ladybug", path: join(root, "graph.lbug"), namespace: PRIVATE_NAMESPACE }, { embeddings: false });
    strut = await createStrut({
      workspace: new GraphWorkspaceStore(graph, { materializeDir: join(root, "steps"), appsDir: join(root, "apps") }),
      dataDir: root,
      store,
      kit: await kitForTests(),
      serveUi: false,
      enableChat: false,
      autoResume: false,
      orchestrator: false,
      builder: false,
      systemWorkflows: false,
      browserWorkflows: false,
      privacyWorkflows: false,
      mediaWorkflows: false,
      views: false,
      concepts: { personal: false, claims: false },
      stt: false,
      jamie: false,
      earnings: false,
      staff: false,
      worker: false,
      git: { local: false },
      // GitHub's API, stood in for: what every step's `http` reaches.
      services: { http: httpCapability(github.fetch) },
    });
    await install(HERE);
    const other = join(root, "acme-other");
    for (const [rel, text] of Object.entries(OTHER)) {
      await mkdir(dirname(join(other, rel)), { recursive: true });
      await writeFile(join(other, rel), text);
    }
    await install(other);
    for (const app of [APP, OTHER_APP]) versions[app] = (await strut.apps.manifestOf(app)).version;
    // The deployment's GITHUB_TOKEN: a box sets none, and no step may read one.
    const res = await strut.app.request("/secrets/GITHUB_TOKEN", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: T.deployment }) });
    assert.ok(res.status < 300, await res.text());
  });
  after(async () => {
    Object.assign(console, consoleWas);
    await strut?.close?.().catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  it("installs whole: its app, the token it provides and serves to git, and strut's github/create-pr for the job agent", async () => {
    const { packages } = await (await strut.app.request("/packages")).json();
    const pkg = packages.find((p: any) => p.package === "stadeum/github");
    assert.ok(pkg, "installed");
    assert.equal(pkg.version, "0.1.0");
    assert.deepEqual(pkg.provides?.secrets, ["GITHUB_TOKEN"]);
    assert.deepEqual(pkg.provides?.git, [{ host: "github.com", secret: "GITHUB_TOKEN" }]);
    const job = await strut.workspace.getWorkflow("job");
    assert.ok(job.params.tools.includes("github/create-pr"), `the job agent is granted strut's github/create-pr: ${job.params.tools}`);
    assert.ok(!(job.params.approve ?? []).includes("github/create-pr"), "and it does not ask first: the pull request is the review");
    const manifest = await strut.apps.manifestOf(APP);
    assert.deepEqual([...manifest.manifest.grants.steps].sort(), [...STEPS, "graph/changes"].sort());
    assert.equal(manifest.manifest.admin, undefined, "everyone's app");
  });

  it("says a person with no token of their own is not connected, though the deployment has one, and asks GitHub nothing", async () => {
    const n = calls.length;
    assert.deepEqual(await ok(page("ada", false)("stadeum/github/me")), { connected: false, admin: false });
    assert.deepEqual(await ok(page("root", true)("stadeum/github/me")), { connected: false, admin: true });
    assert.deepEqual(since(n), [], "no call to GitHub");
  });

  it("says whom a person is connected as, with their own token alone", async () => {
    await seam("ada", T.ada);
    const n = calls.length;
    assert.deepEqual(await ok(page("ada", false)("stadeum/github/me")), { connected: true, kind: "app", login: "ada-gh", name: "ada-gh person", admin: false });
    assert.deepEqual(since(n).map((c) => [c.method, c.url, c.auth]), [["GET", "https://api.github.com/user", `Bearer ${T.ada}`]]);
    // Each person their own: the admin has none yet.
    assert.deepEqual(await ok(page("root", true)("stadeum/github/me")), { connected: false, admin: true });
    await seam("root", T.root);
    const me = await ok(page("root", true)("stadeum/github/me"));
    assert.equal(me.login, "root-gh");
    assert.equal(me.admin, true, "an admin's call from the GitHub app");
    // An admin's call from another app is not the GitHub app's.
    assert.equal((await ok(page("root", true, OTHER_APP)("stadeum/github/me"))).admin, false);
  });

  it("keeps a token a person pastes as their own, once GitHub says whom it is, and never says it back", async () => {
    const bea = page("bea", false);
    // Not a personal token: refused before GitHub is asked.
    let n = calls.length;
    for (const token of [T.hive, "hunter2"]) {
      const out = await bea("stadeum/github/paste", { token });
      assert.match(out.error ?? "", /a token GitHub gave an app|not a GitHub personal access token/);
      assert.ok(!out.error!.includes(token));
    }
    assert.deepEqual(since(n), [], "GitHub not asked");
    // One GitHub refuses: nothing kept.
    n = calls.length;
    const refused = await bea("stadeum/github/paste", { token: T.gone });
    assert.match(refused.error ?? "", /GitHub does not accept that token: it is wrong, expired or revoked\. Nothing was kept/);
    assert.equal(await hasOwn("bea"), false);
    assert.deepEqual(since(n).map((c) => [c.url, c.auth]), [["https://api.github.com/user", `Bearer ${T.gone}`]]);
    // Theirs: kept as their own, the answer the login alone.
    assert.deepEqual(await ok(bea("stadeum/github/paste", { token: `  ${T.bea} ` })), { login: "bea-gh", name: "bea-gh person", kind: "pasted" });
    assert.equal(await hasOwn("bea"), true, "their own secret");
    assert.deepEqual(await ok(bea("stadeum/github/me")), { connected: true, kind: "pasted", login: "bea-gh", name: "bea-gh person", admin: false });
    // Once connected, a second paste waits for a disconnect.
    assert.match((await bea("stadeum/github/paste", { token: T.dee })).error ?? "", /connected to GitHub already: disconnect first/);
    // The deployment's value is untouched: the box still has its own, unused.
    const { secrets } = await (await strut.app.request("/secrets")).json();
    assert.ok(JSON.stringify(secrets).includes("GITHUB_TOKEN"));
  });

  it("changes a person's token only from the GitHub app: not from another app, a workflow or a member's call elsewhere", async () => {
    // A workflow's config is kept with it: a made-up token no one has.
    const nobodys = `github_pat_${hex(30)}`;
    for (const [type, config] of [
      ["stadeum/github/paste", { token: nobodys }],
      ["stadeum/github/disconnect", {}],
    ] as const) {
      const elsewhere = await page("bea", false, OTHER_APP)(type, config);
      assert.match(elsewhere.error ?? "", /is a person's own click in the GitHub app \(stadeum\/github\/github\), not from acme\/other\/console/, type);
      const admin = await page("root", true, OTHER_APP)(type, config);
      assert.match(admin.error ?? "", /a person's own click in the GitHub app/, type);
      const run = await once(`no-app-${type.split("/").pop()}`, type, config, "bea");
      assert.equal(run.status, "error", type);
      assert.match(JSON.stringify(run.error), /a person's own click in the GitHub app/, type);
    }
    assert.equal(await hasOwn("bea"), true, "bea's token is still there");
    assert.equal(await hasOwn("dee"), false);
  });

  it("disconnects a pasted token by removing it alone: it may be in use elsewhere, so it is not revoked", async () => {
    const n = calls.length;
    const out = await ok(page("bea", false)("stadeum/github/disconnect"));
    assert.deepEqual(out, { removed: true, kind: "pasted", revoked: false, manage: "https://github.com/settings/personal-access-tokens" });
    assert.deepEqual(since(n), [], "GitHub is not asked to revoke it");
    assert.equal(github.revoked.has(T.bea), false);
    assert.equal(await hasOwn("bea"), false);
    assert.deepEqual(await ok(page("bea", false)("stadeum/github/me")), { connected: false, admin: false });
    // Again: nothing to remove.
    assert.deepEqual(await ok(page("bea", false)("stadeum/github/disconnect")), { removed: false });
  });

  it("disconnects a token the App gave by revoking it at GitHub, unauthenticated, then removing it", async () => {
    const n = calls.length;
    const out = await ok(page("ada", false)("stadeum/github/disconnect"));
    assert.deepEqual(out, { removed: true, kind: "app", revoked: true });
    const made = since(n);
    assert.deepEqual(made.map((c) => [c.method, c.url, c.auth]), [["POST", "https://api.github.com/credentials/revoke", undefined]]);
    assert.deepEqual(JSON.parse(made[0]!.body!), { credentials: [T.ada] });
    assert.equal(github.revoked.has(T.ada), true);
    assert.equal(await hasOwn("ada"), false);
    assert.deepEqual(await ok(page("ada", false)("stadeum/github/me")), { connected: false, admin: false });
  });

  it("removes an App token GitHub would not revoke, and says why without the token", async () => {
    await seam("carl", T.carl);
    const out = await ok(page("carl", false)("stadeum/github/disconnect"));
    assert.equal(out.removed, true);
    assert.equal(out.revoked, false);
    assert.equal(out.why, "GitHub answered 422: Validation Failed");
    assert.equal(await hasOwn("carl"), false);
  });

  it("says when GitHub no longer takes a person's token", async () => {
    await seam("ada", T.ada); // revoked above: GitHub refuses it now
    assert.deepEqual(await ok(page("ada", false)("stadeum/github/me")), { connected: true, kind: "app", refused: true, admin: false });
    await ok(page("ada", false)("stadeum/github/disconnect"));
  });

  it("shows an admin the box's GitHub orgs, as their own token sees them", async () => {
    const n = calls.length;
    const { installations } = await ok(page("root", true)("stadeum/github/installations"));
    assert.deepEqual(installations, [
      { id: 101, account: "acme", type: "Organization", repositories: "selected", manage: "https://github.com/organizations/acme/settings/installations/101" },
      { id: 202, account: "root-gh", type: "User", repositories: "all", manage: "https://github.com/settings/installations/202" },
    ]);
    assert.deepEqual(since(n).map((c) => [c.url, c.auth]), [["https://api.github.com/user/installations?per_page=100&page=1", `Bearer ${T.root}`]]);
  });

  it("refuses the orgs to a member, and to an admin's call from another app", async () => {
    await seam("ada", T.ada); // a member with a token: refused before it is read
    const n = calls.length;
    for (const [type, config] of [
      ["stadeum/github/installations", {}],
      ["stadeum/github/repositories", { installation: 101 }],
    ] as const) {
      assert.match((await page("ada", false)(type, config)).error ?? "", /only an admin sees the box's GitHub orgs, in the GitHub app/, type);
      assert.match((await page("root", true, OTHER_APP)(type, config)).error ?? "", /the box's GitHub orgs are seen in the GitHub app \(stadeum\/github\/github\), not from acme\/other\/console/, type);
      assert.equal((await once(`orgs-${type.split("/").pop()}`, type, config)).status, "error", "nor a workflow's");
    }
    assert.deepEqual(since(n), [], "GitHub not asked");
    await strut.app.request("/actors/ada/secrets/GITHUB_TOKEN", { method: "DELETE" });
  });

  it("tells an admin with a pasted token that GitHub shows the App's orgs only to a token the App gave", async () => {
    await ok(page("dee", true)("stadeum/github/paste", { token: T.dee }));
    const out = await page("dee", true)("stadeum/github/installations");
    assert.match(out.error ?? "", /GitHub shows an App's orgs only to a token its App gave you, and yours is one you pasted: disconnect, then connect GitHub/);
    // And with none, to connect first.
    await ok(page("dee", true)("stadeum/github/disconnect"));
    assert.match((await page("dee", true)("stadeum/github/installations")).error ?? "", /connect GitHub first/);
  });

  it("lists an org's repositories, every page, and says when the box keeps no list", async () => {
    const n = calls.length;
    const out = await ok(page("root", true)("stadeum/github/repositories", { installation: 101 }));
    assert.equal(out.code, false, "stadeum/code is not installed yet");
    assert.equal(out.total, 101);
    assert.equal(out.repositories.length, 101);
    assert.deepEqual(out.repositories[0], { url: "https://github.com/acme/App", owner: "acme", name: "App", private: true, listed: false });
    assert.deepEqual(out.repositories.find((r: any) => r.name === "web"), { url: "https://github.com/acme/web", owner: "acme", name: "web", private: false, archived: true, listed: false });
    assert.deepEqual(since(n).map((c) => c.url), [
      "https://api.github.com/user/installations/101/repositories?per_page=100&page=1",
      "https://api.github.com/user/installations/101/repositories?per_page=100&page=2",
    ]);
    assert.match((await page("root", true)("stadeum/github/repositories", { installation: 999 })).error ?? "", /GitHub did not show that org's repositories: Not Found/);
  });

  it("marks a repository already on stadeum/code's list, read through the graph by its contract", async () => {
    await install(CODE_DIR);
    // On the list as the Code app's Add writes it (its own case), and another forge's.
    for (const [i, url] of ["https://github.com/Acme/app", "https://gitlab.com/acme/r001"].entries()) {
      const run = await once(`seed-${i}`, "graph/create-node", { node_type: "Repository", node_data: { url, name: url.split("/").pop() } });
      assert.equal(run.status, "success", JSON.stringify(run.error));
    }
    const out = await ok(page("root", true)("stadeum/github/repositories", { installation: 101 }));
    assert.equal(out.code, true);
    assert.deepEqual(out.repositories.filter((r: any) => r.listed).map((r: any) => r.url), ["https://github.com/acme/App"]);
    // The personal account's: none of them listed.
    const mine = await ok(page("root", true)("stadeum/github/repositories", { installation: 202 }));
    assert.deepEqual(mine, { code: true, total: 1, repositories: [{ url: "https://github.com/root-gh/dotfiles", owner: "root-gh", name: "dotfiles", private: false, listed: false }] });
  });

  it("sends a token to GitHub's API alone, and never the deployment's", () => {
    assert.ok(calls.length > 0);
    for (const c of calls) assert.ok(c.url.startsWith("https://api.github.com/"), c.url);
    assert.ok(!JSON.stringify(calls).includes(T.deployment), "the deployment's GITHUB_TOKEN was never sent");
  });

  it("puts no token in any output, error, run, event, node, file or log", async () => {
    const leaks = (text: string) => ALL_TOKENS.filter((t) => text.includes(t));
    assert.deepEqual(leaks(seen.join("\n")), [], "what a page or a workflow was given");
    assert.deepEqual(leaks(JSON.stringify([...store.events.entries()])), [], "events");
    assert.deepEqual(leaks(JSON.stringify([...store.summaries.entries()])), [], "run summaries");
    assert.deepEqual(leaks(logged.join("\n")), [], "logs");
    // Every node of the graph, and every file under the data directory
    // (the graph's file among them). Secrets are in memory here.
    const walk = async (dir: string): Promise<string[]> =>
      (await readdir(dir, { withFileTypes: true })).flatMap((e) => (e.isDirectory() ? [] : [join(dir, e.name)])).concat(
        ...(await Promise.all((await readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => walk(join(dir, e.name))))),
      );
    let control = false;
    for (const file of await walk(root)) {
      const bytes = (await readFile(file)).toString("latin1");
      assert.deepEqual(leaks(bytes), [], file);
      // The scan reads the graph's own bytes: the address seeded above is in them.
      control ||= bytes.includes("https://github.com/Acme/app");
    }
    assert.ok(control, "the scan found a value the graph holds, so it would find a token there");
    assert.ok(seen.length > 20 && logged.length > 0, "and it read what pages and logs were given");
  });
});
