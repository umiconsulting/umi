# GitHub Push Matrix

Status: current as of 2026-06-10.

## Decision

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

## App Repositories

| Local path | Branch during S2.1 | Remote |
| --- | --- | --- |
| `apps/umi-cash` | `main` | `git@github.com-umi:umiconsulting/umi-cash.git` |
| `apps/umi-conversaflow` | `architecture-v2` | `git@github.com-umi:umiconsulting/supabase-edge-functions.git` |
| `apps/umi-dashboard` | `main` | `git@github.com-umi:umiconsulting/umi-dashboard.git` |
| `apps/umi-kds` | `main` | `git@github.com-umi:umiconsulting/umi-kds.git` |
| `apps/umi-landing-page` | `staging` | `git@github.com-umi:umiconsulting/umi-landing-page.git` |
| `apps/umi-logs` | `main` | `git@github.com-umi:umiconsulting/conversaflow-logs.git` |

## Root Workspace

The root workspace is versioned locally. No matching `umiconsulting` root workspace repository existed during S2.1 under `Umi`, `umi`, or `umi-workspace`; create one intentionally before adding a root `origin`.

## Verification

From the workspace root:

```sh
for d in apps/umi-cash apps/umi-conversaflow apps/umi-dashboard apps/umi-kds apps/umi-landing-page apps/umi-logs; do
  git -C "$d" remote -v
done
```

Expected result: every fetch and push URL starts with `git@github.com-umi:umiconsulting/`.
