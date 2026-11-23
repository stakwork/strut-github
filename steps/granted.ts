import { z, defineStep } from "strut";
import { asCtx, grantedBy, requireAdmin, tokenOf } from "./_github.js";

export default defineStep({
  type: "stadeum/github/granted",
  description:
    "The repositories one of the box's GitHub orgs grants the App, as the admin's own token sees them (GitHub's GET /user/installations/{id}/repositories), by name, " +
    "each with its https `url`, whether it is `private`, and `archived` when it is. A read-only list of what the GitHub connection reaches: " +
    "it changes nothing, and says nothing of which repositories the box works on. An admin's call from the GitHub app alone.",
  effect: "read",
  input: z.object({ installation: z.number().int().positive().describe("The installation's id, from stadeum/github/installations") }),
  output: z.object({
    repositories: z.array(z.object({ url: z.string(), owner: z.string(), name: z.string(), private: z.boolean(), archived: z.boolean().optional() })),
    total: z.number().describe("How many the installation grants; more than shown past 1,000"),
  }),
  async run(cfg, ctx) {
    const c = asCtx(ctx);
    requireAdmin(c);
    const token = await tokenOf(c);
    if (!token) throw new Error("connect GitHub first: the repositories shown are the ones your own account reaches");
    return grantedBy(c, token, cfg.installation);
  },
});
