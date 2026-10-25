# CI and npm publishing

[The workflow](../.github/workflows/ci.yml) uses Node.js 24, `actions/checkout@v7`, and `actions/setup-node@v7` on GitHub-hosted Ubuntu runners.

| Push | Behavior |
| --- | --- |
| `main` branch | `npm ci`, build, and tests |
| Tag matching `v*` | Verify release eligibility, `npm ci`, build, tests, then publish |
| Other branches or tags | No workflow run |

The publish job checks that the tagged commit is an ancestor of `origin/main` and that the tag exactly matches `v` followed by the version in `package.json`. Both annotated and lightweight tags work. A release can point to an older commit in `main`'s history; it does not have to be the current branch tip. A tag on an unmerged branch fails the eligibility check before installation or publication.

Branch and tag filters are independent in GitHub Actions, so the explicit ancestry check enforces the requirement that releases come from `main`.
Deleting a tag does not publish a release.

## Configure npm once

In the `duckerd` package's settings on npmjs.com, add a GitHub Actions trusted publisher with these values:

| Field | Value |
| --- | --- |
| Organization or user | `tobilg` |
| Repository | `duckerd` |
| Workflow filename | `ci.yml` |
| Environment name | Leave empty; the workflow does not use a GitHub environment |
| Allowed actions | Enable direct publishing with `npm publish` |

Use only the workflow filename, not `.github/workflows/ci.yml`. The workflow must be present in the tagged commit. Configuring this trust relationship is an npm account setting; committing the workflow does not create it.

The publish job grants `id-token: write`, allowing npm to authenticate using GitHub's OIDC identity. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed. The job selects the latest Node 24 release, whose bundled npm supports trusted publishing, and publishes publicly with provenance. See [npm's trusted publishing documentation](https://docs.npmjs.com/trusted-publishers/) for account setup and requirements.

## Release

1. Update the version in both `package.json` and `package-lock.json`. For example, `npm version 0.3.0 --no-git-tag-version` updates the files without creating a commit or tag; choose the next unpublished version.
2. Commit the release changes and push them to `main` through your normal review process. Wait for the build and tests to pass.
3. Tag that release commit and push the tag:

   ```bash
   git tag -a v0.3.0 -m "Release 0.3.0"
   git push origin v0.3.0
   ```

Replace `0.3.0` with the version being released. The tag run builds and tests the tagged source before publishing it. Ordinary pushes to `main` never publish.

Stable versions publish under npm's `latest` distribution tag. Prerelease versions, such as `0.4.0-beta.1` with Git tag `v0.4.0-beta.1`, publish under `next`. npm rejects attempts to publish an existing package version; use a new version for another release.

The build job caches npm downloads. The publishing job installs from the lockfile without an Actions package cache. Workflow files are excluded from the npm package.
