import { z, defineStep } from "strut";
import { asCtx, kindOf, mayAdmin, tokenOf, whoIs } from "./_github.js";

export default defineStep({
  type: "stadeum/github/me",
  description:
    "Whom the person is connected to GitHub as: their own GITHUB_TOKEN alone (never a deployment's), asked of GitHub's GET /user. " +
    "`connected` false when they have none. Otherwise their `login` and `name`, `kind` (`app`: the box's GitHub App gave it through the connect seam, " +
    "and Disconnect revokes it; `pasted`: a token they made, which Disconnect only removes), or `refused` when GitHub no longer takes it. " +
    "On the GitHub app's call, `admin` says whether this call may see the box's GitHub orgs. The token is never in the answer.",
  effect: "read",
  input: z.object({}),
  output: z.object({
    connected: z.boolean(),
    kind: z.enum(["app", "pasted"]).optional(),
    login: z.string().optional(),
    name: z.string().optional(),
    refused: z.boolean().optional().describe("GitHub no longer takes the token: it was revoked or it expired"),
    admin: z.boolean().optional().describe("On a page's call: an admin's, from the GitHub app"),
  }),
  async run(_cfg, ctx) {
    const c = asCtx(ctx);
    const where = c.app ? { admin: mayAdmin(c) } : {};
    const token = await tokenOf(c);
    if (!token) return { connected: false, ...where };
    const kind = kindOf(token);
    const who = await whoIs(c, token);
    if ("refused" in who) return { connected: true, kind, refused: true, ...where };
    return { connected: true, kind, ...who, ...where };
  },
});
