import { z, defineStep } from "strut";
import { SECRET, asCtx, kindOf, own, requireOwnApp, revoke, tokensPage } from "./_github.js";

export default defineStep({
  type: "stadeum/github/disconnect",
  description:
    "Remove the person's own GITHUB_TOKEN from the box, from the GitHub app, by the person themselves. " +
    "A token the box's GitHub App gave (`kind: app`, ghu_) is revoked at GitHub first (POST /credentials/revoke; GitHub emails them), " +
    "and removed whether or not GitHub answered, with `why` when it did not. A token they pasted (`kind: pasted`) may be in use elsewhere: " +
    "it is only removed, and `manage` is GitHub's page where they delete it. The token is never in the answer.",
  effect: "write",
  input: z.object({}),
  output: z.object({
    removed: z.boolean(),
    kind: z.enum(["app", "pasted"]).optional(),
    revoked: z.boolean().optional(),
    why: z.string().optional().describe("Why GitHub did not revoke it"),
    manage: z.string().optional().describe("Where on GitHub a pasted token is deleted"),
  }),
  async run(_cfg, ctx) {
    const c = asCtx(ctx);
    requireOwnApp(c, "disconnecting GitHub");
    const mine = own(c);
    const token = await mine.get(SECRET);
    if (!token) return { removed: false };
    const kind = kindOf(token);
    if (kind === "pasted") {
      await mine.delete(SECRET);
      return { removed: true, kind, revoked: false, manage: tokensPage(token) };
    }
    // Revoked first: once removed, nothing on the box could revoke it.
    const done = await revoke(c, token);
    await mine.delete(SECRET);
    return { removed: true, kind, ...done };
  },
});
