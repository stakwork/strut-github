import { z, defineStep } from "strut";
import { asCtx, installationsOf, requireAdmin, tokenOf } from "./_github.js";

export default defineStep({
  type: "stadeum/github/installations",
  description:
    "The box's GitHub orgs: the GitHub App's installations the admin's own token sees (GitHub's GET /user/installations, which answers only a token the App gave). " +
    "An admin's call from the GitHub app alone. Each: its `id`, the `account` (org or person) and its `type`, whether it grants `all` repositories or `selected` ones, " +
    "and `manage`, GitHub's own page for it, where its repositories are changed.",
  effect: "read",
  input: z.object({}),
  output: z.object({
    installations: z.array(
      z.object({
        id: z.number(),
        account: z.string(),
        type: z.enum(["Organization", "User"]),
        repositories: z.enum(["all", "selected"]),
        suspended: z.boolean().optional(),
        manage: z.string(),
      }),
    ),
  }),
  async run(_cfg, ctx) {
    const c = asCtx(ctx);
    requireAdmin(c);
    const token = await tokenOf(c);
    if (!token) throw new Error("connect GitHub first: the box's GitHub orgs are the ones your own account sees");
    return { installations: await installationsOf(c, token) };
  },
});
