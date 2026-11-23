import { z, defineStep } from "strut";
import { asCtx, reachable, tokenOf } from "./_github.js";

export default defineStep({
  type: "stadeum/github/repositories",
  description:
    "Every github.com repository the person this run is reaches with their own GitHub token: what strut's git/repositories asks this package for (its provides.git entry names this step). " +
    "Through the box's GitHub App, every installation their token sees, each repository `picked` when its org picked it for the App rather than granting all; with a token they pasted, " +
    "the repositories that token reaches. Each: its https `url`, `name`, whether it is `private`, when it was `pushed` and its `description`. Archived repositories are left out. " +
    "It changes nothing: workspaces are made from these elsewhere.",
  effect: "read",
  input: z.object({ host: z.string().optional().describe("The host strut asks for: github.com, the only one this package serves") }),
  output: z.object({
    repositories: z.array(
      z.object({
        url: z.string(),
        name: z.string(),
        private: z.boolean(),
        pushed: z.string().optional(),
        description: z.string().optional(),
        picked: z.boolean().optional().describe("Picked for the App one by one, not granted with all of its owner's"),
      }),
    ),
  }),
  async run(_cfg, ctx) {
    const c = asCtx(ctx);
    const token = await tokenOf(c);
    if (!token) throw new Error("connect GitHub first, in the GitHub app: the repositories listed are the ones your own account reaches");
    return { repositories: await reachable(c, token) };
  },
});
