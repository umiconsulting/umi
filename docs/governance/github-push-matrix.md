# GitHub Push Matrix

Status: historical. The build-v3 monorepo superseded this S2.1 matrix.

## Current decision

The workspace uses one Git repository:

```text
git@github.com:umiconsulting/umi.git
```

The `apps/*` directories are not separate Git repositories.
Run Git commands from the workspace root.

## Historical S2.1 decision

Umi uses `umiconsulting` as the single GitHub organization and `github.com-umi` as the single SSH host alias for app repositories.

The alias is defined locally in `~/.ssh/config`:

```sshconfig
Host github.com-umi
  HostName github.com
  User git
```

Keep repo remote URLs in this shape:

```text
git@github.com-umi:umiconsulting/<repo>.git
```

## Historical app repositories

| Local path              | Branch during S2.1 | Remote                                                         |
| ----------------------- | ------------------ | -------------------------------------------------------------- |
| `apps/umi-cash`         | `main`             | `git@github.com-umi:umiconsulting/umi-cash.git`                |
| `apps/umi-conversaflow` | `architecture-v2`  | `git@github.com-umi:umiconsulting/supabase-edge-functions.git` |
| `apps/umi-dashboard`    | `main`             | `git@github.com-umi:umiconsulting/umi-dashboard.git`           |
| `apps/umi-kds`          | `main`             | `git@github.com-umi:umiconsulting/umi-kds.git`                 |
| `apps/umi-landing-page` | `staging`          | `git@github.com-umi:umiconsulting/umi-landing-page.git`        |
| `apps/umi-logs`         | `main`             | `git@github.com-umi:umiconsulting/conversaflow-logs.git`       |

## Historical root workspace

The root workspace is versioned locally. No matching `umiconsulting` root workspace repository existed during S2.1 under `Umi`, `umi`, or `umi-workspace`; create one intentionally before adding a root `origin`.

## Historical verification

From the workspace root:

```sh
for d in apps/umi-cash apps/umi-conversaflow apps/umi-dashboard apps/umi-kds apps/umi-landing-page apps/umi-logs; do
  git -C "$d" remote -v
done
```

Expected result: every fetch and push URL starts with `git@github.com-umi:umiconsulting/`.
