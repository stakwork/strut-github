import { z, defineStep } from "strut";
import { SECRET, asCtx, own, pasted, requireOwnApp, whoIs } from "./_github.js";

export default defineStep({
  type: "stadeum/github/paste",
  description:
    "Keep a GitHub personal access token the person made and pasted (a box with no GitHub App, or a person who prefers one) as their own GITHUB_TOKEN. " +
    "Only from the GitHub app, by the person themselves, and only when they have no token yet. GitHub is asked whom it is first, so a token it refuses is not kept. " +
    "An app's token (ghu_, gho_…) is refused: the box's own App connects through the connect seam. The token is never shown again: the answer is the login alone.",
  effect: "write",
  input: z.object({ token: z.string().describe("A fine-grained personal access token (github_pat_…), or a classic one (ghp_…)") }),
  output: z.object({ login: z.string(), name: z.string().optional(), kind: z.literal("pasted") }),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireOwnApp(c, "pasting a token");
    const token = pasted(cfg.token);
    const mine = own(c);
    if (await mine.get(SECRET)) throw new Error("you are connected to GitHub already: disconnect first, then paste a token");
    const who = await whoIs(c, token);
    if ("refused" in who) throw new Error("GitHub does not accept that token: it is wrong, expired or revoked. Nothing was kept");
    await mine.set(SECRET, token);
    return { ...who, kind: "pasted" as const };
  },
});
