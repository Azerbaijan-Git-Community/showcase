# Submitting a Project

## Requirements

- The repository must be **public** on GitHub
- You should be the **owner** or an **active contributor** of the project

## Steps

1. **Fork** this repository
2. Create a new file in the `projects/` directory named `{owner}-{repo}.yaml`
   - Replace `{owner}` and `{repo}` with the GitHub owner and repository name
   - Example: for `octocat/hello-world`, the filename is `octocat-hello-world.yaml`
3. Fill in the fields (see schema below)
4. Open a **pull request** against `main`

A CI check will validate your file automatically. Fix any reported errors before requesting review.

## Schema

```yaml
repo: "owner/repo"                # Required — GitHub owner/repo slug
submittedBy: "your-github-username" # Required — your GitHub username
banner: "https://raw.githubusercontent.com/owner/repo/main/banner.png"  # Optional
npm: "package-name"                # Optional — npm package name
website: "https://example.com"     # Optional — project website (HTTPS only)
```

### Field Details

| Field | Required | Description |
|---|---|---|
| `repo` | Yes | GitHub repository in `owner/repo` format |
| `submittedBy` | Yes | Your GitHub username |
| `banner` | No | Banner image URL (HTTPS only). Can be hosted anywhere. If the image fails to load, the GitHub OG image is used as fallback. Recommended size: 1280x640px |
| `npm` | No | npm package name (e.g., `my-package` or `@scope/my-package`) |
| `website` | No | Project website. Must use HTTPS |

### Do NOT include these fields

- `addedAt` — automatically set by the bot after merge
- `updatedAt` — automatically set by the bot after merge

Including these fields will cause the CI check to fail.

## Example

File: `projects/octocat-hello-world.yaml`

```yaml
repo: "octocat/hello-world"
submittedBy: "octocat"
banner: "https://raw.githubusercontent.com/octocat/hello-world/main/banner.png"
npm: "hello-world"
website: "https://hello-world.example.com"
```

## What Happens After Merge

1. A bot automatically adds `addedAt` and `updatedAt` timestamps to your file
2. A webhook notifies the website to sync your project's GitHub metadata (stars, issues, PRs, license, language)
3. Your project card appears on [azgitcommunity.dev/showcase](https://azgitcommunity.dev/showcase) within minutes

## Updating Your Project

To update optional fields (banner, npm, website), open a new PR editing your existing YAML file. The bot will update the `updatedAt` timestamp on merge.
