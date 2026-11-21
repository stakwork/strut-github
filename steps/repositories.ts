import { z, defineStep } from "strut";
import { asCtx, githubKey, listed, repositoriesOf, requireAdmin, tokenOf } from "./_github.js";

export default defineStep({
  type: "stadeum/github/repositories",
  description:
    "The repositories one of the box's GitHub orgs grants the admin's own token (GitHub's GET /user/installations/{id}/repositories), by name, " +
    "each marked `listed` when it is already on the box's list: the Repository nodes the stadeum/code package keeps, read through the graph. " +
    "`code` is false when the box has no such list (that package is not installed). An admin's call from the GitHub app alone. It changes nothing: " +
    "a repository is added to the list in the Code app.",
  effect: "read",
  input: z.object({ installation: z.number().int().positive().describe("The installation's id, from stadeum/github/installations") }),
  output: z.object({
    code: z.boolean(),
    repositories: z.array(
      z.object({ url: z.string(), owner: z.string(), name: z.string(), private: z.boolean(), archived: z.boolean().optional(), listed: z.boolean() }),
    ),
    total: z.number().describe("How many the installation grants; more than shown past 1,000"),
  }),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireAdmin(c);
    const token = await tokenOf(c);
    if (!token) throw new Error("connect GitHub first: the repositories shown are the ones your own account reaches");
    const [{ repositories, total }, onList] = await Promise.all([repositoriesOf(c, token, cfg.installation), listed(c)]);
    return {
      code: !!onList,
      repositories: repositories.map((r) => ({ ...r, listed: !!onList?.has(githubKey(r.url) ?? "") })),
      total,
    };
  },
});
