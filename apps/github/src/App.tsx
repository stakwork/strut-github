import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useHost, useShareLink, useStrutClient } from "@strut/kit";
import { Building2, ChevronRight, ExternalLink, GitPullRequest, KeyRound, Lock, Plug, Plus, User } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { seamLink } from "./links";

// The package's steps, by their full names.
const ME = "stadeum/github/me";
const PASTE = "stadeum/github/paste";
const DISCONNECT = "stadeum/github/disconnect";
const INSTALLATIONS = "stadeum/github/installations";
const GRANTED = "stadeum/github/granted";
/** Where a person makes a fine-grained token on GitHub. */
const NEW_TOKEN = "https://github.com/settings/personal-access-tokens/new";

interface Me {
  connected: boolean;
  kind?: "app" | "pasted";
  login?: string;
  name?: string;
  refused?: boolean;
  /** This viewer may see the box's GitHub orgs: strut says so on an admin's call. */
  admin?: boolean;
}
interface Disconnected {
  removed: boolean;
  kind?: "app" | "pasted";
  revoked?: boolean;
  why?: string;
  manage?: string;
}
interface Granted {
  url: string;
  owner: string;
  name: string;
  private: boolean;
  archived?: boolean;
}
interface Installation {
  id: number;
  account: string;
  type: "Organization" | "User";
  repositories: "all" | "selected";
  suspended?: boolean;
  manage: string;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^(step_run: |Error: )+/, "");

export default function App() {
  const client = useStrutClient();
  const qc = useQueryClient();
  const host = useHost();
  // The host's own page for this app (on a box, Stadeum's, where the
  // connect seam is), offered only when it is on the box this strut is
  // served for: strut's own address is where this document's frame was
  // loaded from, which no link can set (./links.ts).
  const page = useShareLink()?.();
  const strut = typeof document !== "undefined" ? document.baseURI : undefined;
  const connect = seamLink(page, strut);
  const install = seamLink(page, strut, { install: true });
  const me = useQuery({ queryKey: ["github", "me"], queryFn: () => client.run<Me>(ME) });
  const [notice, setNotice] = useState<{ text: string; link?: { href: string; label: string } }>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [pasting, setPasting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  // A connect runs in a tab of its own (the seam is the box's page, not
  // this frame's): read it all again when the person comes back here.
  useEffect(() => {
    const again = () => {
      if (document.visibilityState === "visible") void qc.invalidateQueries({ queryKey: ["github"] });
    };
    document.addEventListener("visibilitychange", again);
    window.addEventListener("focus", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("focus", again);
    };
  }, [qc]);

  const act = async (change: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await change();
    } catch (e) {
      setError(message(e));
    } finally {
      await qc.invalidateQueries({ queryKey: ["github"] });
      setBusy(false);
    }
  };

  const disconnect = () =>
    act(async () => {
      const out = await client.run<Disconnected>(DISCONNECT);
      if (!out.removed) return setNotice({ text: "You had no token on this box." });
      if (out.kind === "pasted") {
        return setNotice({
          text: "Your token is off this box. It was not revoked: you pasted it, and it may be in use elsewhere. Delete it on GitHub if nothing else needs it.",
          ...(out.manage ? { link: { href: out.manage, label: "Your tokens on GitHub" } } : {}),
        });
      }
      if (out.revoked) return setNotice({ text: "Your token is off this box and revoked at GitHub, which emails you that it was." });
      setNotice({
        text: `Your token is off this box, but GitHub did not confirm it is revoked (${out.why ?? "no answer"}). To be sure, revoke the app's access on GitHub.`,
        link: { href: "https://github.com/settings/apps/authorizations", label: "Authorized apps on GitHub" },
      });
    });

  const data = me.data;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center gap-2">
        <GitPullRequest className="size-5 text-brand" />
        <h1 className="text-lg font-semibold">GitHub</h1>
        <span className="text-sm text-muted-foreground">your account on this box</span>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>
      )}
      {notice && (
        <Alert>
          <AlertDescription className="flex flex-col gap-2">
            <span>{notice.text}</span>
            {notice.link && (
              <Button variant="link" className="h-auto self-start p-0" onClick={() => void host.openLink(notice.link!.href)}>
                {notice.link.label}
                <ExternalLink className="size-3" />
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-base">Your account</CardTitle>
          <CardDescription>The box acts on GitHub as you only with your own account: your pushes, pull requests and private repositories.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4">
          {me.isLoading && <p className="text-sm text-muted-foreground">Asking GitHub…</p>}
          {me.error && (
            <Alert variant="destructive">
              <AlertDescription className="break-words">{message(me.error)}</AlertDescription>
            </Alert>
          )}
          {data && !data.connected && (
            <>
              <p className="text-sm">Not connected.</p>
              <div className="flex flex-wrap gap-2">
                {connect && (
                  <Button onClick={() => void host.openLink(connect)} disabled={busy}>
                    <Plug className="size-4" />
                    Connect GitHub
                  </Button>
                )}
                <Button variant={connect ? "outline" : "default"} onClick={() => setPasting((p) => !p)} disabled={busy}>
                  <KeyRound className="size-4" />
                  Paste a token
                </Button>
              </div>
              {!connect && (
                <p className="text-xs text-muted-foreground">
                  Connect GitHub is on the box's own page for this app, in Stadeum: this page has no way to reach it. A token you paste works anywhere.
                </p>
              )}
              {pasting && (
                <PasteForm
                  busy={busy}
                  onOpenGitHub={() => void host.openLink(NEW_TOKEN)}
                  onPaste={(token) =>
                    act(async () => {
                      const out = await client.run<{ login: string }>(PASTE, { token });
                      setPasting(false);
                      setNotice({ text: `Your token is kept as your own secret on this box, and will not be shown again. Connected as @${out.login}.` });
                    })
                  }
                />
              )}
            </>
          )}
          {data?.connected && (
            <>
              {data.refused ? (
                <p className="text-sm text-destructive">GitHub no longer accepts your token: it was revoked or it expired. Disconnect, then connect again.</p>
              ) : (
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  Connected as <span className="font-semibold">@{data.login}</span>
                  {data.name && <span className="text-muted-foreground">({data.name})</span>}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {data.kind === "app" ? "Through the box's GitHub App." : "With a token you pasted."}
              </p>
              <div>
                <Button variant="outline" onClick={() => setDisconnecting(true)} disabled={busy}>
                  Disconnect
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {data?.admin && data.connected && !data.refused && <Orgs install={install} busy={busy} />}

      {disconnecting && data?.connected && (
        <AlertDialog open onOpenChange={(open) => !open && setDisconnecting(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect GitHub?</AlertDialogTitle>
              <AlertDialogDescription>
                {data.kind === "app"
                  ? "Your token comes off this box, and is revoked at GitHub first, so no copy of it works anywhere again. GitHub emails you that it was. The box can no longer push, open pull requests or read private repositories as you until you connect again."
                  : "Your token comes off this box. It is not revoked: you pasted it, and it may be in use elsewhere, so it keeps working at GitHub until it expires or you delete it there. The box can no longer act on GitHub as you until you connect again."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay connected</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setDisconnecting(false);
                  void disconnect();
                }}
              >
                {data.kind === "app" ? "Disconnect and revoke" : "Disconnect"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function PasteForm({ busy, onPaste, onOpenGitHub }: { busy: boolean; onPaste: (token: string) => Promise<void>; onOpenGitHub: () => void }) {
  const [token, setToken] = useState("");
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    await onPaste(token.trim());
    setToken("");
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 rounded-md border p-3">
      <p className="text-sm text-muted-foreground">
        A fine-grained personal access token you made on GitHub (it starts <span className="font-mono">github_pat_</span>), for the repositories the box works on. It is kept as your own
        secret on this box and never shown again.{" "}
        <Button type="button" variant="link" className="h-auto p-0" onClick={onOpenGitHub}>
          Make one on GitHub
          <ExternalLink className="size-3" />
        </Button>
      </p>
      <div className="flex gap-2">
        <Input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          aria-label="Your GitHub token"
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !token.trim()}>
          {busy ? "Checking…" : "Keep it"}
        </Button>
      </div>
    </form>
  );
}

/** For an admin: the box's GitHub orgs, each with the repositories it
 *  grants (a read-only list of what the connection reaches) and a way to
 *  change them on GitHub. Which repositories the box works on is chosen
 *  for a workspace, in the Code app; this app names no other package. */
function Orgs({ install, busy }: { install?: string; busy: boolean }) {
  const client = useStrutClient();
  const host = useHost();
  const orgs = useQuery({ queryKey: ["github", "installations"], queryFn: () => client.run<{ installations: Installation[] }>(INSTALLATIONS) });
  const list = orgs.data?.installations;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">GitHub orgs</h2>
        <span className="text-sm text-muted-foreground">where the box's GitHub App is installed, as your account sees them</span>
        <div className="flex-1" />
        {install && (
          <Button size="sm" variant="outline" onClick={() => void host.openLink(install)} disabled={busy}>
            <Plus className="size-4" />
            Add a GitHub org
          </Button>
        )}
      </div>
      {orgs.isLoading && <p className="text-sm text-muted-foreground">Asking GitHub…</p>}
      {orgs.error && (
        <Alert variant="destructive">
          <AlertDescription className="break-words">{message(orgs.error)}</AlertDescription>
        </Alert>
      )}
      {list && !list.length && (
        <p className="text-sm text-muted-foreground">
          The App is on no org your account sees.{install ? " Add a GitHub org to install it on one." : ""}
        </p>
      )}
      {list?.map((i) => <Org key={i.id} installation={i} />)}
    </section>
  );
}

function Org({ installation: i }: { installation: Installation }) {
  const client = useStrutClient();
  const host = useHost();
  const repos = useQuery({
    queryKey: ["github", "granted", i.id],
    queryFn: () => client.run<{ repositories: Granted[]; total: number }>(GRANTED, { installation: i.id }),
    enabled: !i.suspended,
  });
  const data = repos.data;
  // The list starts folded: the header says how many it holds.
  const [open, setOpen] = useState(false);
  return (
    <Card className="gap-2 py-4">
      <CardHeader className="flex flex-row flex-wrap items-center gap-2 px-4">
        <button type="button" className="flex items-center gap-2 text-left" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <ChevronRight className={`size-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          {i.type === "Organization" ? <Building2 className="size-4 text-muted-foreground" /> : <User className="size-4 text-muted-foreground" />}
          <CardTitle className="font-mono text-base">{i.account}</CardTitle>
          {data && <Badge variant="secondary">{data.total === 1 ? "1 repo" : `${data.total} repos`}</Badge>}
        </button>
        <span className="text-xs text-muted-foreground">{i.repositories === "all" ? "every repository" : "the repositories picked on GitHub"}</span>
        {i.suspended && <Badge variant="destructive">suspended</Badge>}
        <div className="flex-1" />
        <Button size="sm" variant="ghost" onClick={() => void host.openLink(i.manage)}>
          Change repositories
          <ExternalLink className="size-3" />
        </Button>
      </CardHeader>
      {repos.error && (
        <CardContent className="px-4">
          <p className="py-2 text-sm text-destructive">{message(repos.error)}</p>
        </CardContent>
      )}
      {open && (
        <CardContent className="flex flex-col divide-y px-4">
          {repos.isLoading && <p className="py-2 text-sm text-muted-foreground">Reading its repositories…</p>}
          {data && !data.repositories.length && <p className="py-2 text-sm text-muted-foreground">It grants no repositories.</p>}
          {data?.repositories.map((r) => (
            <div key={r.url} className="flex min-w-0 flex-col py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.name}</span>
                {r.private && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Lock className="size-3" />
                    private
                  </span>
                )}
                {r.archived && <Badge variant="outline">archived</Badge>}
              </div>
              <span className="truncate text-xs text-muted-foreground select-all">{r.url}</span>
            </div>
          ))}
          {data && data.total > data.repositories.length && (
            <p className="py-2 text-xs text-muted-foreground">
              The first {data.repositories.length} of {data.total}.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
