# strut-github

GitHub for Stadeum. Connect your account through the Stadeum GitHub App,
and agents work in your repos and open PRs as you.

Every token is a person's own. There is no box token, and nothing here is
"for the box": a token is the person's actor secret `GITHUB_TOKEN`, read
and written only as theirs (`secrets.own`), never a deployment's. The
package keeps nothing of its own: tokens are strut's secrets, and the box's
list of repositories is the
[`stadeum/code`](https://github.com/stakwork/strut-code) package's.

## What it ships

| Part | What |
| --- | --- |
| `strut.yaml` | `requires.optional: [GITHUB_TOKEN]`; `provides.secrets: [GITHUB_TOKEN]` (its steps manage each person's own value); `provides.git` for `github.com` with that secret (strut's own entry says the same); `job.tools: [github/create-pr, github/pr-status, github/fetch-pr]` (strut's steps); `schedules:` runs `pr-checks` every 5 minutes |
| `workflows/pr-checks.yaml` | One step, strut's `job/pr-checks`: a job whose pull request's checks all finished with one failed gets one turn to fix them ("When the checks fail later", below) |
| `apps/github/` | **GitHub**, every person's app (below) |
| `steps/me.ts` | Whom the person is connected as: their own token alone, asked of GitHub's `GET /user`. Says whether the token came from the App or was pasted, and whether GitHub still takes it. Everyone's |
| `steps/paste.ts` | Keeps a personal access token the person made, as their own secret, once GitHub says whom it is. From the GitHub app alone, by the person themselves |
| `steps/disconnect.ts` | Removes the person's token from the box; revokes it at GitHub first when the App gave it. From the GitHub app alone, by the person themselves |
| `steps/installations.ts` | The box's GitHub orgs: the App's installations the admin's own token sees. An admin's call from the GitHub app alone |
| `steps/repositories.ts` | What one org grants the admin's token, each marked when it is already on the box's list. An admin's call from the GitHub app alone |
| `steps/_github.ts` | What the steps share |

### The GitHub app

For every person:

- **Connect GitHub** opens the box's connect seam
  (`https://<the box>/api/connect/github?return=<this app's page>`), which
  shows the box's own confirm page, then GitHub, then writes the token as
  the person's own `GITHUB_TOKEN` and comes back to the app. It reads
  everything again when the person comes back to the page. Where the seam
  is, and when Connect is offered at all, is below ("Where Connect leads").
- **Connected as @login**, read with the person's own token alone, never a
  deployment value; or that GitHub no longer takes it.
- **Paste a token**, for a box with no App: a fine-grained personal access
  token (`github_pat_…`, or a classic `ghp_…`) the person made, checked
  with GitHub, kept as their own secret and never shown again. A token
  GitHub gave an app (`ghu_`, `gho_`, `ghs_`, `ghr_`) is refused: the box's
  App connects through the seam.
- **Disconnect** removes the person's token from the box, and says which
  of two things happens before they confirm:
  - **A token the App gave** (`ghu_`: only the seam writes one, since Paste
    refuses them) is revoked at GitHub first (`POST /credentials/revoke`,
    unauthenticated; GitHub emails the person), then removed. If GitHub
    does not confirm, it is removed anyway and the person is told to revoke
    the App's access on GitHub.
  - **A token they pasted** is only removed: they made it, and it may be in
    use elsewhere. The app links to GitHub's page where they delete it.

  How the token came is read off its own prefix, so nothing is kept beside
  it.

For an admin, in the same app:

- **GitHub orgs**: the App's installations the admin's own token sees,
  each with **Change repositories** (GitHub's own page for that
  installation, `github.com/organizations/<org>/settings/installations/<id>`
  or `github.com/settings/installations/<id>`), and **Add a GitHub org**
  (the seam with `install=1`). GitHub lists installations only to a token
  its App gave: a pasted token is told so.
- **Repositories**, by installation, up to 1,000 each: each one marked **on
  the box** when stadeum/code's list has it. The list is read through the
  graph by that package's contract (its `Repository` nodes' `url`, through
  strut's own `graph/find`), without requiring the package, and read again
  whenever a `Repository` node is written (`graph/changes`). Without
  stadeum/code the app says the box keeps no list.
- **Add…** for a repository not on the list: the list is changed only in
  the Code app, by an admin (stadeum/code holds that to its own app), so
  this app hands the admin there. It opens the Code app with
  `{ add: <the address> }` as its input and shows the address to copy.
  The Code app does not read that input yet: see below.

### Who may call what

- `paste` and `disconnect` change only the caller's own token, and only from
  this package's own app (`ctx.app.name` is `stadeum/github/github`, the
  name strut signs for the page, not a builder's preview, not a host's
  call). Another app that lists these steps among its grants, a workflow, or
  the job agent changes nothing.
- `installations` and `repositories` are an admin's call from this app
  (`ctx.app.admin`), held as stadeum/code holds its own changes. A member's
  call and an admin's call from another app are refused.
- `me` is anyone's: it reads the caller's own token.

### Tokens

- A step reads and writes only `secrets.own` for `GITHUB_TOKEN`: never
  `secrets.get` (which falls back to a deployment value) and never
  `secrets.deployment`.
- GitHub's API is reached through strut's `http`, at
  `https://api.github.com` alone, with the token in the `Authorization`
  header. Revocation sends no authentication (GitHub refuses an
  authenticated revoke).
- A token is never in an output, an error, a run, an event, a graph node or
  a log: the steps return logins and kinds, and scrub anything GitHub says
  before showing it.
- The package keeps nothing. It ships no webhook, no `on-event`, no
  `forget` or `retire` and no hook secret: those come with strut's webhook
  routes and events.

### Where Connect leads

The app learns its host's page from strut (`strut/page` in its host
context, @strut/kit `useShareLink`): framed by Stadeum it is
`https://<the box>/apps/<name>`, and the seam is on that origin. But that
page cannot be trusted on its own. Strut takes it from its embed URL's
`embed_origin` and `embed_page` (`web/src/embed.ts`: `captureEmbedOrigin`
checks only that `embed_origin` is a bare origin; `embedPage` only that the
page is on it), checks it against nothing it was told to trust, and lets
any page frame its UI. A page framed by another site gets no session
(`SameSite=Lax`, `src/auth.ts`), but a page on the same site as strut (any
`*.<the box's domain>`; on hosted boxes, any other `*.stakwork.ai`) frames
it signed in as the person. That page could name any origin as the host's,
and a Connect GitHub there would lead to a page imitating GitHub's
sign-in. A link followed in the address bar cannot do it: unframed, strut
ignores `embed_page` and hands its own address.

So Connect is offered only when the page is on the box this strut is
served for. A box serves strut at `strut.<box>` and Stadeum, with its seam,
at `<box>` (stadeum's compose, and the seam's own `return` rule names the
same pair). The app reads strut's own address from where its document was
loaded (`document.baseURI`: the app is a `srcdoc` inside strut's page),
which the browser sets and no link can. A page on another origin, strut's
own UI, a strut not served at `strut.<box>`, or no page at all (a native
app's web view) gets no Connect; the app says so and offers Paste.
`apps/github/src/links.ts` holds the rule, and the test reads it with each
of those pages. The real fix is strut's (see "What strut should change").

## What a box needs

- **A strut with stakwork/strut#800** (on strut's `main` from 9c3657a8):
  a package's `job:` granting strut's own steps. An older strut
  refuses the install (`job.tools: "github/create-pr" matches no step of the
  package`). It also needs #789 (`provides.secrets`, `secrets.own`) and
  #798 (`provides.git`), both before it. Strut has no way yet for a package
  to say which strut it needs.
- **For Connect GitHub: Stadeum's connect seam and a GitHub App,** with
  strut served at `strut.<box>` beside Stadeum at `<box>`, as stadeum's
  compose does ("Where Connect leads"). The seam is stadeum-ui's (`/api/connect/github`, `plans/software.md` §2.1); it is
  offered only when stadeum-ui has `CONNECT_GITHUB_CLIENT_ID` and
  `_CLIENT_SECRET`, and Add a GitHub org needs `CONNECT_GITHUB_SLUG` too.
  Hosted boxes use Stakwork's App, "Stadeum AI"; a self-hosted box registers
  its own (§8, §13). Without them the seam's route is a 404, and this app
  cannot tell beforehand: strut tells an app its host's page, not what the
  host offers.
- **Without the seam or the App, a pasted token works**: Paste, Connected
  as, Disconnect, git and pull requests. GitHub orgs need a token the App
  gave, so an admin there adds repositories by address in the Code app.
- **stadeum/code**, for the box's list. Without it the app still connects
  and shows orgs.

### What a pull request needs

The job agent is granted `github/create-pr`, which opens a pull request as
the job's person with their own `GITHUB_TOKEN`. It then reads the pull
request as that person too: `github/pr-status` for its checks, and
`github/fetch-pr` for what reviewers said. Where nothing on the box can
build the change (an Android app on a pod without Android), the
repository's CI is where it runs, so a failed check is the agent's to read
and fix. `github/pr-status { logs: true }` writes each failed GitHub
Actions job's whole log to a file the agent searches with `rg`, since the
cause sits far above the job's end. That needs a strut whose `pr-status`
takes `logs`, and a token that may read Actions: the App's
**Actions: read** permission, or a pasted token with the same. Without it
the check says why it has no log, and its pass or fail still reads. Pushing the branch first
is `git/push`, which stadeum/code should grant (a forge-neutral step);
until it does, a job without a pod hands over a diff. The guards on
`git/push` are stakwork/strut#802.

### When the checks fail later

A job ends its turn while CI is still running: Code Change says not to
wait. So the package looks again for it. Its schedule runs `pr-checks` every
5 minutes, one step, strut's `job/pr-checks` (stakwork/strut
`plans/pr-checks.md`, strut#835). That step:
- reads the pull requests the box's recent jobs delivered;
- once a pull request's checks have all finished with one failed, sends
  its job one turn to fix them. The turn runs as the person whose turn
  opened it, and names that turn's conversation, so Jamie tells them what
  happened.

It sends that turn once per pull request. After that, a fix is a person's
click on the PR card.

Strut does the reading and the launching, because only strut may act as a
box's people. The package only says when. An admin can switch the schedule
off like any package schedule. It needs a strut with `job/pr-checks`; on
one without, the step is unknown.

## What strut should change

An app's host page should be one strut was told to trust, never one a URL
names. Either the host names its page where only it can (`POST /auth/ticket
{ actor, role, page }` with its key, carried by the session it buys), or a
deployment setting lists the hosts that frame strut (stadeum's compose
would set `https://<box>`); strut honours `embed_origin` / `embed_page`
only for those, sends `frame-ancestors` for them, and checks the frame's
real parent where the browser says (`location.ancestorOrigins`). With that,
`strut/page` is the host's, and the host could say what it offers (a seam,
whether the box has the App) so the package names no route.

## What stakwork/strut-code's Code app should accept

The Code app should read its tool input (`useToolInput()`) and, when it
holds `add`, an https address, put that address in its Add field for an
admin, without adding it: the admin still clicks **Add a repository**. This
app already opens Code with that input
(`appLink("stadeum/code/code", { add: "<url>" })`), so nothing changes here
when Code takes it. Until then the admin copies the address the dialog
shows.

## Installing it

A box follows the `stable` branch:

```text
git+https://github.com/stakwork/strut-github@stable
```

As a subscription, by a person (it moves when `stable` does):

```bash
curl -X PUT $STRUT/packages/subscriptions/github -H "authorization: Bearer $KEY" -H "x-strut-actor: $ME" -H 'content-type: application/json' -d '{"ref":"git+https://github.com/stakwork/strut-github@stable"}'
```

Or once:

```bash
curl -X POST $STRUT/packages/install -H "authorization: Bearer $KEY" -H "x-strut-actor: $ME" -H 'content-type: application/json' -d '{"ref":"git+https://github.com/stakwork/strut-github@stable"}'
```

## Developing it

`package.test.ts` installs this directory into a strut started in the
test's own process from a checkout of stakwork/strut (`STRUT_DIR`), on a
LadybugDB file, and drives it as the GitHub app's page does: a member's
call, an admin's, and an admin's call from another package's app. GitHub's
API is stood in for through strut's own `http` (`createStrut({ services: {
http } })`): it answers `api.github.com` for made-up tokens, records every
request and refuses any other address. stadeum/code (`STRUT_CODE_DIR`, a
checkout of stakwork/strut-code) is installed partway, to see a repository
on its list marked so. The deployment is given a `GITHUB_TOKEN`, to see
that no step ever sends it. The last test looks for every token in what
pages and workflows were given, the runs and their events, the logs, and
every file under the data directory (the graph's among them).

```bash
STRUT_DIR=../strut STRUT_CODE_DIR=../strut-code npm test
```

`STRUT_DIR` is a strut checkout with its install (`yarn install
--frozen-lockfile --ignore-scripts`, and the same in `kit/`).
`.github/workflows/checks.yml` runs it on every pull request and push to
`main`, against strut's `main` and strut-code's `main`.

To try the app, install the checkout into a strut of your own:

```bash
curl -X POST $STRUT/packages/install -H "authorization: Bearer $KEY" -H "x-strut-actor: $ME" -H 'content-type: application/json' -d "{\"ref\":\"file:$PWD\"}"
```

Connect GitHub needs a host that frames strut and serves the seam on its
own origin, with strut at `strut.<host>` (Stadeum's layout; on a laptop,
`http://box.localhost:<port>` framing `http://strut.box.localhost:<port>`
works); in strut's own UI the app offers Paste.

## Releasing it

A merge to `main` changes no box. `stable` moves only when someone runs the
`promote` workflow with a commit on `main` whose checks passed; a rollback
is the same run with an older commit:

```bash
gh workflow run promote.yml -R stakwork/strut-github -f commit=<sha>
```

The first run makes `stable`.
