<img src="https://github.com/Azerbaijan-Git-Community/.github/blob/main/profile/agc-logo.png" align="left" width="200"/>

### `Azerbaijan Github Community Showcase`

A curated registry of open-source projects built by [Azerbaijan GitHub Community](https://github.com/Azerbaijan-Git-Community) members.

Browse the live showcase at [githubcommunity.az/showcase](https://githubcommunity.az/showcase).

<a href="https://githubcommunity.az/">Website</a> ·
<a href="https://www.linkedin.com/company/github-azerbaijan/">Linkedin</a> ·
<a href="https://t.me/github_azerbaijan">Telegram</a> ·
<a href="https://www.instagram.com/azerbaijan_github_community/">Instagram</a>

<br clear="left"/>

---

## Submit Your Project

1. Fork this repo
2. Create `projects/{owner}-{repo}.yaml` (see [SUBMIT.md](SUBMIT.md) for details)
3. Open a pull request

After your PR is merged, the project will appear on the website within minutes.

## How It Works

- Members submit YAML files describing their projects via pull requests
- A CI workflow validates the schema on every PR
- On merge, a webhook notifies the website, which syncs GitHub metadata (stars, issues, PRs, license, language) into its database
- The [/showcase](https://githubcommunity.az/showcase) page renders project cards from this data
