# Staff identity: who needs an email?

**Date:** 2026-09-29
**Question:** for an operator added to Umi — owner, manager, cashier, waiter, cook — who must
have an email, who may, and who must not be asked for one?
**Method:** vendor product documentation and help centers, read 2026-09-29. Where a vendor's help
center was login-gated or unreachable that day, the vendor is excluded rather than guessed. Fudo,
SoftRestaurant, Odoo and PoloTab are taken from the already-cited research in
`2026-09-15-competitor-feature-matrix-fudo-softrestaurant-clover.md`.

## 1. Short answer

The industry runs **two identity planes, not one**:

- **The account plane** — owner, administrator, anyone who opens the back office. Here email _is_
  the identifier: it receives the invite, resets the password, carries notifications and is the
  login. Email (or in one notable case, phone) is required.
- **The operator plane** — cashier, waiter, cook, host, runner. Here the credential is a short
  numeric code, a badge, a QR, a swipe card or a fingerprint, attached to a **display name**.
  Across all fifteen systems reviewed, **not one requires an email to operate a till**, a POS
  handheld, or a kitchen display.

Email is therefore best modelled not as a property of a person but as a **reachability channel**,
and the requirement belongs to a **capability**, not to a role title. Square states the rule most
plainly: to create a team member you need "an email address **or phone number**" — a contact, not
an email. Toast states the consequence of the opposite design: because each Toast Web account
needs a unique email, "some businesses prefer a shared Toast Web account with basic access that
multiple people use to log in."

## 2. The matrix

| System                        | Segment            | Owner / admin sign-in                                               | Line-staff credential                                                               | Email for line staff?                                                                                         |
| ----------------------------- | ------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Toast**                     | US, enterprise     | Email + password (Toast Web)                                        | POS access code, 3–8 digits (recent docs: 6–8), or swipe card                       | No. Email is required only "if they need back-end access"                                                     |
| **Square**                    | US, SMB→enterprise | Email + password                                                    | Unique personal 4-digit passcode; shared team passcode; badge                       | No. But a team member needs "an email address or phone number" to be invited                                  |
| **Clover**                    | US, SMB            | Email + password                                                    | 4- or 6-digit device passcode (6-digit mandatory for new merchants from April 2026) | Email sits on the employee profile; changing it means delete-and-recreate. The device still uses the passcode |
| **Lightspeed Restaurant (K)** | Global             | Back Office email + password                                        | POS PIN 4–6 digits, QR code, or iButton/Dallas key                                  | Email is collected "used for notifications" if Lightspeed Tasks is on; it is not the POS credential           |
| **Loyverse**                  | Global SMB         | Email + password                                                    | **Unique 4-digit PIN is mandatory for every user, owner included**                  | No. Email+password login is an opt-in alternative to the PIN                                                  |
| **Poster**                    | Global SMB         | Location username + password                                        | 4-digit PIN at the terminal                                                         | No                                                                                                            |
| **Foodics**                   | MENA               | Console account                                                     | "Write a unique 5-digit PIN for the user to be able to log in to the Cashier App"   | No                                                                                                            |
| **Sapaad**                    | India / SEA        | Username + password                                                 | Username + password, or an optional swipe card                                      | No                                                                                                            |
| **iCHEF**                     | Taiwan             | Merchant account                                                    | Staff **Login ID + password**; a staff number for clock-in                          | No. Email exists only so an admin can reset a password                                                        |
| **Fudo**                      | LatAm              | Username + password per user (users are deactivated, never deleted) | Same credential; plus a table-authorisation PIN                                     | No                                                                                                            |
| **SoftRestaurant**            | Mexico             | Admin profiles                                                      | Password **or fingerprint** per employee                                            | No                                                                                                            |
| **Odoo POS**                  | Global / ERP       | Back-office user                                                    | PIN code or employee badge; users switch on one register                            | No                                                                                                            |
| **PoloTab**                   | Mexico             | Administrative users created and sent an email invitation           | Per-employee login; biometrics named on the pricing page                            | Admin: yes. Line staff: no                                                                                    |
| **Fresh KDS**                 | Kitchen SaaS       | Email invitation to the Fresh team                                  | Device authorisation; a device is bound to the subscription                         | No per-cook account. Email is a _console_ requirement                                                         |
| **Square KDS**                | Kitchen            | Covered by the Square account                                       | A **KDS device code** connects the hardware                                         | No per-cook identity at all                                                                                   |

Sources in §6. Quotes are the vendors' own words.

## 3. What the field agrees on

1. **The POS credential is short and numeric.** Toast 3–8 digits, Square 4, Clover 4/6, Lightspeed
   4–6, Loyverse 4, Poster 4, Foodics 5, Odoo PIN. Nobody asks a cashier to type an email address
   on a busy Friday.
2. **Email, when present on a line-staff record, is for something else** — an invitation, a
   notification, a password reset. Lightspeed is explicit that the POS user's email is "used for
   notifications". iCHEF is explicit that it is only a reset channel.
3. **Where email is genuinely the account key, it is painful to change.** Clover: "To change an
   employee's full name or email address, you must delete the profile and create a new employee",
   plus a 24-hour cooldown before the address can be reused. That is what happens when a channel
   is promoted to an identifier.
4. **Contact, not email, is the real requirement for inviting someone.** Square accepts email _or_
   phone. Toast's unique-email rule pushes merchants toward shared accounts, which weakens audit.
5. **Kitchen identity is the device.** Square KDS is joined by a device code. Fresh KDS binds a
   device to the subscription and gives the _management console_ per-user accounts. Cooks do not
   have personal logins on a KDS in these products.
6. **The requirement scales with capability.** Owner/admin → email. Manager with dashboard access →
   email. Manager who only approves voids at the till → code. Cashier/waiter/cook → code.

## 4. Framework for Umi

Ask the requirement per **capability**, then grant it per **role**:

| Capability                                   | Channel it needs                            |
| -------------------------------------------- | ------------------------------------------- |
| Sign in at a till                            | none — device credential + PIN              |
| Open the dashboard                           | email (or phone, if we support phone login) |
| Receive an invite                            | email or phone                              |
| Recover a credential                         | email or phone                              |
| Receive notifications / scheduling / payroll | email or phone                              |
| Be named on a ticket, check or report        | none — display name only                    |

Recommended field rules for **Add a person**:

- Always required: **name**, **role**, **PIN**.
- **Email** — optional field, required only when the chosen role includes dashboard access.
- **Phone** — recommended, not required, for till-only roles.
- Validation message whenever the submit button is disabled, naming the missing field. Today the
  form is silent when phone is empty and the button simply does nothing.
- A person with no email should be created as a **PIN-only operator**, not as an `invited` login
  waiting for an invitation we never send.

Our own data supports phone-first: the customer study behind
`docs/architecture/2026-07-09-enterprise-conceptual-review.md` found 447/447 customers carry a
phone and **0** carry an email, and the same review found 8/11 staff records with an email. The
channel our cafés actually have is the phone.

**Runner-up, considered and rejected: require an email for every staff member.** It is the
simplest rule, it matches the account plane that all fifteen vendors already run, and it would
let a till session keep the email it carries today. Reject it for two reasons. The café field
does not have staff email addresses — 8 of 11 staff records in the Umi review carry one, and no
customer carries one. And the cost is documented by Toast itself: because each Toast Web account
needs a unique email, "some businesses prefer a shared Toast Web account with basic access that
multiple people use to log in", which destroys the per-person audit trail that a unique PIN
preserves.

## 5. Where Umi currently contradicts this

The schema already intends email-optional operators:

- `docs/migration/build-v3/10_umi.sql:40` — "NULLs stay distinct under `user_email_lower_uq`, so
  many PIN-only users coexist."
- `docs/migration/build-v3/10_umi.sql:95` — describes a user with "no email and no password; the
  till PIN is on `merchant.staff`."
- `docs/migration/build-v3/51_manager_card_credential.sql` — the manager card is an alternative
  to typing a PIN.

Three places contradict that intent:

1. `apps/umi-api/src/modules/auth/auth.service.ts:328` throws `OPERATOR_LOGIN_UNAVAILABLE` when the
   operator has no email, because a till session currently carries an email as part of its
   identity. The session needs a user id and a display name; it does not need an email.
2. That code is not in the contract's error union, so `all-exceptions.filter.ts` rewrites it to
   `PERMISSION_DENIED` and the till says "El PIN no es válido para esta sucursal" for a correct
   PIN.
3. `apps/umi-dashboard/src/screens/staff.jsx:845` requires `phone` to submit and offers no email
   field, while the footer explains only the PIN rule. A person added from the console can be
   stranded: the form insists on a channel the till does not need, and omits the one the till
   currently demands.

There is also a known renewal gap recorded in `auth.service.ts`: `findUserById` still requires
`password_hash IS NOT NULL`, so a PIN-only invited operator can sign in and then fail to renew one
access TTL later.

## 6. Captures

Four screens were captured in a real Chromium window on 2026-09-29; the index with source URLs,
device class and dates is at [`assets/INDEX.md`](assets/INDEX.md).

| Product  | Screen                                                 | File                                  |
| -------- | ------------------------------------------------------ | ------------------------------------- |
| Square   | Team member creation — "email address or phone number" | `assets/square-add-team-member.png`   |
| Square   | Owner sign-in — the account plane                      | `assets/square-sign-in-owner.png`     |
| Loyverse | PIN code access — "unique 4-digit PIN"                 | `assets/loyverse-pin-code-access.png` |
| Toast    | POS access code — "three-to-eight digit number"        | `assets/toast-pos-access-code.png`    |

The other eleven products were read as text only. Their named screens need an interactive help
search or a login, so each is a recorded gap in `assets/INDEX.md`, not a silent one.

## 7. Route-failure log

Two routes were tried per blocked host before it was dropped.

| Host                    | Route                                                    | Result                                                            |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------- |
| `squareup.com`          | `/help/us/en/article/5442-add-team-members`              | 301, then a redirect to an unrelated article                      |
| `squareup.com`          | `/help/us/en/search?query=...`                           | 404                                                               |
| `squareup.com`          | `/help/us/en/topics/team-management`                     | 404                                                               |
| `squareup.com`          | `/help/us/en/article/8356-add-and-manage-team-members`   | 200 — used                                                        |
| `r.jina.ai`             | text extractor in front of the Square article            | 403, Cloudflare challenge                                         |
| `support.toasttab.com`  | `/en/documentation/.../employee-passcodes.htm`           | 404                                                               |
| `support.toasttab.com`  | `/api/v1/search?query=passcode`                          | 404 (no public search API)                                        |
| `support.toasttab.com`  | `/en/article/Find-or-Edit-an-Employee-s-POS-Access-Code` | 200 — used                                                        |
| `web.archive.org`       | CDX index for `squareup.com/help/us/en/article/*`        | 200 — found the retired passcode article                          |
| `web.archive.org`       | `2024id_` snapshot of article 3937                       | 200 — the retired page, quoted for the passcode model             |
| `web.archive.org`       | CDX index for `support.toasttab.com*`                    | 200 with no matching rows                                         |
| `help.loyverse.com`     | `/help/pin-code-access`                                  | 200 — used                                                        |
| `google` / `duckduckgo` | site search from `curl`                                  | not attempted after the playbook recorded them as unreliable here |

Six products were excluded by the collecting agent. Their help-centre roots were re-tested on
2026-09-29, and **two of the six do answer**, so that exclusion is partly wrong. Recorded here so
the next pass starts from facts:

| Host                       | Route | Result                                                                              |
| -------------------------- | ----- | ----------------------------------------------------------------------------------- |
| `help.touchbistro.com`     | `/`   | 200, 489 kB — a Salesforce portal that renders client-side; the shell holds no text |
| `support.touchbistro.com`  | `/`   | connection failed (curl 000)                                                        |
| `help.spoton.com`          | `/`   | 200, 9 kB — client-side shell                                                       |
| `support.spoton.com`       | `/`   | connection failed (curl 000)                                                        |
| `help.7shifts.com`         | `/`   | connection failed (curl 000)                                                        |
| `help.joinhomebase.com`    | `/`   | 200, 491 bytes — a redirect page                                                    |
| `support.revelsystems.com` | `/`   | 200, 575 kB — reachable and NOT read in this pass                                   |
| `help.petpooja.com`        | `/`   | 404                                                                                 |

TouchBistro and Revel are therefore open gaps, not blocks. Closing them needs a route that renders
JavaScript (the Salesforce Aura API for TouchBistro) rather than a plain fetch.

## 8. What did not change since the prior files

The prior files on this topic are `docs/product/UMIPOS_OPERATOR_PIN_SPEC.md` (2026-07-29),
`docs/product/UMIPOS_DEVICE_ENROLLMENT_SPEC.md` and
`docs/research/2026-09-06-competitive-scan-and-gap-audit/sources/pos-kds.md`.

Unchanged, and re-confirmed by this pass:

- A personal PIN identifies one staff member at a trusted device, and the operator selects no role.
- PIN rules: four to eight digits, unique within the tenant, salted verifier, keyed lookup tag,
  constant public error, lockout, rate limits.
- The device carries the tenant and the branch; the operator supplies only the PIN.
- A manager PIN does not grant a permission the manager role lacks.

Changed, and now contradicted by the market evidence:

- A till session as built today needs an email, so a PIN-only operator cannot sign in.
- The dashboard's Add person form requires a phone and collects no email, so the one channel the
  till demands is the one the form cannot supply.

## 9. Where the sources disagree

- **Email as an identifier.** Square and Toast run one email-keyed account plane, yet Square
  accepts "an email address or phone number" for a team member, and Loyverse makes the
  email-and-password login an _opt-in alternative_ to a mandatory PIN. The disagreement is real:
  account-keyed design is not the only design in the field.
- **PIN length.** Toast 3–8 digits, Square 4, Clover 4 or 6, Loyverse 4, Foodics 5, Lightspeed 4–6.
  No vendor states a reason for its number, so the length is convention, not a constraint.
- **Clover's 6-digit change.** Clover reports a 6-digit passcode requirement for new merchants
  from April 2026 while keeping 4 digits valid for older merchants. The sources disagree with
  each other across that date.

## 10. The skill's closing checks

1. Every claim labelled — partly. Each fact carries its vendor URL in §6; the four systems taken
   from prior Umi research are named as borrowed in the method note.
2. Every named screen captured or blocked — yes, four captured, eleven recorded as gaps.
3. Every blocked host with two routes and a status — yes, in §7.
4. The grid complete, with "no" and "not verified" as real cells — yes, §2.
5. The recommendation names the runner-up and the reason to reject it — yes, §4.
6. What changed since the prior pass, with the pass named — yes, §8.

## 11. Sources

**Toast** — [Get Started With Toast Account & Login Management](https://support.toasttab.com/en/article/Get-Started-With-Toast-Account-Login-Management) ·
[Find or Edit an Employee's POS Access Code](https://support.toasttab.com/en/article/Find-or-Edit-an-Employee-s-POS-Access-Code) ·
[Toast platform access types](https://doc.toasttab.com/doc/platformguide/adminToastPosAccessTypes.html) ·
[Access permissions reference](https://doc.toasttab.com/doc/platformguide/adminPermissions.html)

**Square** — [Add and manage team members](https://squareup.com/help/us/en/article/8356-add-and-manage-team-members) ·
[Require passcodes at point of sale](https://squareup.com/help/us/en/article/8357-require-passcodes-at-point-of-sale) ·
[Employee permissions](https://squareup.com/help/us/en/article/5822-employee-permissions) ·
[Create team member (Team API)](https://developer.squareup.com/reference/square/team-api/create-team-member) ·
[KDS device codes](https://squareup.com/us/en/square-university/restaurants/how-to-create-printer-profiles-and-kds-device-codes-for-order-tickets)

**Clover** — [Set up employee access](https://www.clover.com/en-US/help/set-up-employee-access) ·
[Edit employee profiles](https://www.clover.com/en-US/help/edit-employee-profiles) ·
[Set passcodes](https://www.clover.com/en-US/help/set-passcodes) ·
[Manage roles and access permissions](https://www.clover.com/en-US/help/manage-roles-and-access-permissions)

**Lightspeed Restaurant (K-Series)** — [Managing POS users](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804594690-Managing-POS-users) ·
[About POS users](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804647189-About-POS-users) ·
[Managing POS user groups](https://k-series-support.lightspeedhq.com/hc/en-us/articles/1260804594730-Managing-POS-user-groups)

**Loyverse** — [How to Manage PIN Code Access](https://help.loyverse.com/help/pin-code-access) ·
[How to Give Employees Access to Log In to Loyverse POS Using Email](https://help.loyverse.com/help/how-give-employees-access-login) ·
[Employees](https://help.loyverse.com/help/employees)

**Poster** — [Poster FAQ: getting started and POS terminal access](https://joinposter.com/en/faq)

**Foodics** — [Creating/Changing the Cashier User Login Pin](https://help.foodics.com/hc/en-us/articles/6753435391516-Creating-Changing-the-Cashier-User-Login-Pin)

**Sapaad** — [How to implement swipe cards for my users to log in instead of username and password?](https://www.sapaad.com/knowledge-base/how-to-implement-swipe-cards-for-my-users-to-log-in-instead-of-username-and-password/)

**iCHEF** — [Add staff accounts and groups](https://support.ichefpos.com/?s=%E5%93%A1%E5%B7%A5%E5%B8%B3%E8%99%9F) (search results: Login ID and password; password reset by email; staff number for clock-in)

**Fresh KDS** — [How do I add a new user?](https://help.freshkds.com/en/articles/2437433-how-do-i-add-a-new-user) ·
[How do I delete a user?](https://help.freshkds.com/en/articles/6448887-how-do-i-delete-a-user) ·
[Issue Authorizing Device](https://help.freshkds.com/en/articles/5708867-why-am-i-receiving-an-issue-authorizing-device-error-when-logging-in)

**Fudo** — [Roles de usuario](https://soporte.fu.do/es/articles/11730991-roles-de-usuario) ·
[Qué es el PIN de autorización](https://soporte.fu.do/es/articles/11730981-que-es-el-pin-de-autorizacion)
**SoftRestaurant** — [Huella digital](https://web.archive.org/web/20240224153108/https://softrestaurant.com/docs?download=181:23-ft-soft-restaurant-huella-digital)
**Odoo** — [Employee login for POS](https://www.odoo.com/documentation/19.0/applications/sales/point_of_sale/extra/employee_login.html)
**PoloTab** — [Cómo creo un usuario administrativo](https://www.polotab.com/soporte/como-creo-un-usuario-administrativo) · [Planes](https://www.polotab.com/planes)

**Excluded that day** (help center unreachable, robot-blocked or behind a login): TouchBistro,
SpotOn, 7shifts, Homebase, Revel, Petpooja. Their inclusion would have required guessing.
