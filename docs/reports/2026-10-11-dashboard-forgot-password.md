# The forgotten password, walked end to end

Date: 11 October 2026, 02:25–02:40 MST. The owner was working on this in their own terminal, and
the journey had no instrument: the dashboard sweep presses every control on 24 routes, and the API
has unit tests for the token rules, but nothing walked the four places a person can get stuck —
the request view, the message, the link, and the new-password form.

## What was walked

`tools/ux-sweep/dashboard-forgot-password.mjs` drives the real browser over CDP with real clicks.
Eleven steps, all of them passing:

| Step                     | What it proved                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------- |
| sign-in screen           | the `¿Olvidaste tu contraseña?` control is on the sign-in screen                      |
| request view             | it opens a view that names itself and carries the email field                         |
| request sent             | the confirmation answers and states the 15-minute expiry                              |
| message and link         | a message arrives, with the subject, the greeting and a `reset-password?token=…` link |
| new-password view        | the link opens `Nueva contraseña` with two hidden fields and the language control     |
| reveal toggle            | the eye shows and hides each password, and its label says which it will do            |
| language on the form     | `Nueva contraseña` → `New password` → `Nueva contraseña`                              |
| refuses a short password | refused in the form's own words, before the API is asked                              |
| refuses a mismatch       | two different passwords are refused                                                   |
| sets the password        | the API accepts the token and the view confirms the change                            |
| signs in with it         | the browser leaves the sign-in screen for the dashboard                               |

Two facts the walk does not show on screen were measured at the API:

| Check                                                   | Result                                    |
| ------------------------------------------------------- | ----------------------------------------- |
| sign in with the **previous** password, after the reset | `401` — the old credential is gone        |
| sign in with the **new** password                       | `201`, and one reset token is marked used |

## The message itself

Captured from the Mailpit sink, not from a description of it:

| Field    | Value                                                  |
| -------- | ------------------------------------------------------ |
| To       | `prueba-reset@umiconsulting.co`                        |
| Subject  | `Reestablecer contraseña · Umi Dashboard`              |
| Greeting | `Hola Prueba Reset,`                                   |
| Link     | `http://127.0.0.1:4000/reset-password?token=b5c67da2…` |

## Real delivery, through the owner's relay

The sink proves the message is built and handed over; it cannot prove the relay accepts it. That
leg was measured on a second API instance started **without** SMTP overrides, so it used the real
relay named in `apps/umi-api/.env`:

| Check                                               | Result                                                        |
| --------------------------------------------------- | ------------------------------------------------------------- |
| `POST /api/auth/local/forgot-password` (real relay) | `201`, and no `reset_email_send_failed` in the instance's log |
| the log's only warning                              | `mercado_pago_point_webhook_unconfigured`, unrelated to mail  |

A message left the box for `hola@umiconsulting.co` at 08:35 UTC. Its link is valid for 15 minutes,
which is the product's own rule.

## The fixture the walk needs, and leaves clean

Only the platform admin has a local credential in `umi_local`; every `@onca.mx` account is
`invited` with no password, and the endpoint answers `201` and mails nothing for an unknown
address. The walk therefore borrowed the admin's credential under an address of its own
(`prueba-reset@umiconsulting.co`), set a new password through the product's own flow, and then the
account was deleted — the delete cascades to its reset tokens. **The owner's account was never
touched, and its password is unchanged.** The SQL that recreates the borrow is in the playbook,
next to the command.

## How to run it again

```sh
./scripts/ux-browser.sh                                   # the real browser the harnesses borrow
cd apps/umi-api && setsid env PORT=4021 SMTP_HOST=127.0.0.1 SMTP_PORT=1025 \
  SMTP_USER=mailpit SMTP_PASSWORD=mailpit node dist/main.js > /tmp/umi-api-4021.log 2>&1 &
pnpm ux:forgot-password -- --email <account> --password '<new>' --mint-api http://127.0.0.1:4021
```

Evidence: `docs/reports/evidence/2026-10-11-dashboard-forgot-password/` — the report, the JSON, and
a screenshot of every step.

## One thing the owner should know

`./scripts/api-freshness.sh` reports the API on `:4001` **stale by ~12 minutes** — the process
predates the build it is serving, and the watcher has not respawned it. The reset journey still
behaved correctly against it, and the same journey against a freshly started instance (the mint
API above) behaved correctly too. The stale process was left alone: it is the owner's, and
`./scripts/api-freshness.sh --restart` is the fix when they want it.
