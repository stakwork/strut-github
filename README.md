# strut-github

The `stadeum/github` package for [strut](https://github.com/stakwork/strut):
a person connects their GitHub account, sees whom they are connected as and
disconnects, and an admin picks the repositories a box works on.

Every token is a person's own. The package keeps nothing: tokens are strut's
secrets, and the box's repositories are the
[`stadeum/code`](https://github.com/stakwork/strut-code) package's.

Nothing is published yet. The package will sit at this repository's root, and
a box will follow its `stable` branch:

```text
git+https://github.com/stakwork/strut-github@stable
```
