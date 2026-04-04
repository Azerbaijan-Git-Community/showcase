# Azerbaijan GitHub Community — Showcase

A curated registry of open-source projects built by [Azerbaijan GitHub Community](https://github.com/Azerbaijan-Git-Community) members.

Browse the live showcase at [azerbaijangithubcommunity.vercel.app/showcase](https://azerbaijangithubcommunity.vercel.app/showcase).

## Submit Your Project

1. Fork this repo
2. Create `projects/{owner}-{repo}.yaml` (see [SUBMIT.md](SUBMIT.md) for details)
3. Open a pull request

After your PR is merged, a bot will inject timestamps and the project will appear on the website within minutes.

## How It Works

- Members submit YAML files describing their projects via pull requests
- A CI workflow validates the schema on every PR
- On merge, a bot injects `addedAt`/`updatedAt` timestamps automatically
- A webhook notifies the website, which syncs GitHub metadata (stars, issues, PRs, license, language) into its database
- The [/showcase](https://azerbaijangithubcommunity.vercel.app/showcase) page renders project cards from this data

<!-- Delete this... -->
