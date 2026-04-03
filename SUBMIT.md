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
repo: owner/repo                  # Required — GitHub owner/repo slug
submittedBy: your-github-username # Required — your GitHub username
banner: https://...               # Optional — banner image URL (HTTPS)
links:                            # Optional — package registry / marketplace URLs
  - https://www.npmjs.com/package/my-package
  - https://pypi.org/project/my-package
website: https://example.com      # Optional — project website (HTTPS)
```

### Field Details

| Field | Required | Description |
|---|---|---|
| `repo` | Yes | GitHub repository in `owner/repo` format |
| `submittedBy` | Yes | Your GitHub username |
| `banner` | No | Banner image URL (HTTPS only). If it fails to load, the GitHub OG image is shown as fallback. Recommended size: 1280×640px |
| `links` | No | List of HTTPS URLs to package registries or marketplaces (max 5) |
| `website` | No | Project homepage. Must use HTTPS |

### `links`

Each entry is a plain HTTPS URL — no labels or extra fields needed. The website automatically picks the right icon based on the URL domain.

**Recognized domains and their icons:**

| Domain | Icon |
|---|---|
| `npmjs.com` | npm |
| `pypi.org` | Python |
| `marketplace.visualstudio.com` | VS Code |
| `crates.io` | Rust |
| `rubygems.org` | Ruby |
| `nuget.org` | .NET |
| `hub.docker.com` | Docker |

Any other domain shows a generic link icon — you don't need to wait for support to be added.

### Do NOT include these fields

- `addedAt` — automatically set by the bot after merge
- `updatedAt` — automatically set by the bot after merge

Including these fields will cause the CI check to fail.

## Examples

### npm package

File: `projects/octocat-hello-world.yaml`

```yaml
repo: octocat/hello-world
submittedBy: octocat
links:
  - https://www.npmjs.com/package/hello-world
website: https://hello-world.example.com
```

### VS Code extension

File: `projects/octocat-my-extension.yaml`

```yaml
repo: octocat/my-extension
submittedBy: octocat
banner: https://raw.githubusercontent.com/octocat/my-extension/main/banner.png
links:
  - https://marketplace.visualstudio.com/items?itemName=octocat.my-extension
```

### Python library on multiple registries

```yaml
repo: octocat/mylib
submittedBy: octocat
links:
  - https://pypi.org/project/mylib
  - https://anaconda.org/conda-forge/mylib
```

## What Happens After Merge

1. A bot automatically adds `addedAt` and `updatedAt` timestamps to your file
2. A webhook notifies the website to sync your project's GitHub metadata (stars, issues, PRs, license, language)
3. Your project card appears on [azerbaijangithubcommunity.vercel.app/showcase](https://azerbaijangithubcommunity.vercel.app/showcase) within minutes

## Updating Your Project

To update optional fields, open a new PR editing your existing YAML file. The bot will update the `updatedAt` timestamp on merge.
