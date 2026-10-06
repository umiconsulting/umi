# Platform administrator accounts and support access

**Date:** 2026-08-01
**Status:** Evidence report. This report does not change the accepted architecture.
**Scope:** Platform-level administrator accounts, developer access, and support access to merchant data
**Decision owner:** Umi product and engineering owners
**Confidence:** High on the primary sources. Medium on the PCI DSS applicability date, because the trigger is a contract that Umi does not hold yet.

This file is a dated evidence artifact. Every factual claim carries an inline citation to the
document that owns the claim. Section 2 lists the sources that failed and marks the affected
claims as unverified.

---

## 1. Executive finding

Umi has one platform role. It is `super_admin`. It resolves to `['*']`, it never expires, and one
committed SQL file creates it.

No primary source defends that shape. Every system that ships a wildcard role also documents three
limits on it:

1. The wildcard is rare, and few people hold it.
2. Every use of the wildcard produces a log record.
3. The wildcard is temporary, or the holder is a named small group.

The strongest single argument against `['*']` comes from Kubernetes. A wildcard grants permissions
that do not exist yet. The Kubernetes documentation states it directly: "if a new resource type is
added, or a new subresource is added, or a new custom verb is checked, the wildcard entry
automatically grants access, which may be undesirable"
([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)).

Umi has this exact defect. `seed_rbac.sql` adds POS permission keys to `umi.permission`. Those keys
reached `super_admin` with no review, because `effectivePermissions` returns `['*']`
([`roles.ts`](../../apps/umi-api/src/modules/auth/roles.ts)).

Four changes carry most of the value:

1. Enumerate the platform permissions. Keep exactly one wildcard path, and make it break-glass.
2. Give `umi.user_role` an expiry, a revocation, a justification, and an approver.
3. Record the acting Umi operator beside the merchant actor, before any "log in as" feature ships.
4. Parameterise the bootstrap email in `seed_rbac.sql`, and document how to retire the seed grant.

No compliance rule binds Umi today. The rules begin when Umi signs an acquirer contract for the POS.
Section 9 lists each trigger.

---

## 2. Method and source quality

This report uses primary sources only: the standards body's own text, the vendor's own
documentation, and project source code.

### 2.1 Sources reached

| Source                                           | Access                                     |
| ------------------------------------------------ | ------------------------------------------ |
| Google, _Building Secure and Reliable Systems_   | Full text on the `google.github.io` mirror |
| Google Cloud Privileged Access Manager           | Full documentation                         |
| AWS IAM and AWS Organizations                    | Full documentation                         |
| Microsoft Entra Privileged Identity Management   | Full documentation                         |
| PCI DSS v4.0 requirement text                    | Reproduced in SAQ D for Service Providers  |
| NIST SP 800-53 Rev 5                             | NIST OSCAL catalog, release 5.2.0          |
| Salesforce, Shopify, Zendesk, Atlassian, Stripe  | Vendor documentation                       |
| Vault, Kubernetes, PostgreSQL, Grafana, Keycloak | Project documentation and source           |
| Saltzer and Schroeder (1975)                     | MIT copy                                   |
| OWASP ASVS 4.0 and 5.0                           | GitHub raw Markdown                        |

### 2.2 Sources that failed — treat these claims as unverified

- **The PCI DSS v4.0.1 standard PDF is gated.** The direct URL returns HTTP 403 and serves a
  click-through licence. The requirement text in section 5 comes instead from **PCI DSS v4.0 SAQ D
  for Service Providers (April 2022)**, which reproduces the twelve requirements and is served
  without a gate. PCI SSC states that v4.0.1 adds and deletes no requirements
  ([PCI SSC blog](https://blog.pcisecuritystandards.org/just-published-pci-dss-v4-0-1)). One
  exception applies: v4.0.1 added a note to Requirement 8 about phishing-resistant factors, and
  that note is absent from the v4.0 text quoted here.
- **The AICPA Trust Services Criteria PDF needs a free account.** The CC6 text in section 5.2 comes
  from a third-party mirror of the **March 2020** edition. It is **secondary and unverified**, and
  it is not the 2022 revised edition.
- **The Atlassian Cloud support-access FAQ is a JavaScript-only page.** Three retrieval methods
  failed. The consent checkbox, the `Settings > Support access` screen, and any duration for
  Atlassian Cloud stay **unverified**. Section 4.5 uses Atlassian Statuspage instead, which is
  first-party and readable.
- **The Salesforce Setup Audit Trail help page is JavaScript-only.** The equivalent claim comes from
  the Salesforce object reference, which is verified.
- **The Microsoft Entra PIM page gives a range, not a default.** It documents one to 24 hours. It
  states no numeric default. Do not cite a default from that page.

### 2.3 One premise in the request needs a correction

The request names the Google SRE book for break-glass access. A full sweep of both published SRE
books shows that this attribution is wrong.

- `sre.google/sre-book/` contains zero occurrences of "least privilege".
- `sre.google/sre-book/` contains one occurrence of "break-glass", and it describes release testing,
  not access control ([SRE book, Testing for Reliability](https://sre.google/sre-book/testing-reliability/)).
- `sre.google/workbook/` contains zero occurrences of both terms.

The Google canon for break-glass access is _Building Secure and Reliable Systems_, Chapter 5.

The SRE book does hold one relevant passage. It records how Google removed standing root from SREs:
"A growing awareness of advanced, persistent security threats drove us to reduce the privileges SREs
enjoyed to the absolute minimum they needed to do their jobs"
([SRE book, Automation at Google](https://sre.google/sre-book/automation-at-google/)).

---

## 3. Break-glass and emergency access

### 3.1 What break-glass is

Google defines it as a full bypass, not a large role: "a breakglass mechanism provides access to your
system in an emergency situation and bypasses your authorization system completely"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

Chapter 8 repeats the definition in one line: "A breakglass mechanism is one that can bypass policies
to allow engineers to quickly resolve outages"
([BSRS Ch. 8](https://google.github.io/building-secure-and-reliable-systems/raw/ch08.html)).

The target state removes standing authority. Google states the goal: the design "works to ensure that
users don't have ambient authority—for example, the ability to log in as root—as much as practically
possible" ([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

Zero Touch Production allows exactly three paths to change production. It "requires every change in
production to be made by automation (instead of humans), prevalidated by software, or triggered
through an audited breakglass mechanism"
([BSRS Ch. 3](https://google.github.io/building-secure-and-reliable-systems/raw/ch03.html)).

### 3.2 The four controls that every source repeats

**Restrict the holders.** "The ability to use a breakglass mechanism should be highly restricted. In
general, it should be available only to your SRE team, which is responsible for the operational SLA
of your system" ([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

**Monitor every use.** "All uses of a breakglass mechanism should be closely monitored"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).
NIST states the same control: AC-6(9) LOG USE OF PRIVILEGED FUNCTIONS reads "Log the execution of
privileged functions"
([NIST SP 800-53 Rev 5 OSCAL catalog](https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json)).

**Test the mechanism.** "The breakglass mechanism should be tested regularly by the team(s)
responsible for production services, to make sure it functions when you need it"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

**Review after the event, with peers.** Google describes a weekly cadence: "an SRE team might choose
to audit breakglass events from the last week's on-call shift during a weekly team meeting". The
reason is context: "a peer is well equipped to notice if a coworker repeatedly uses a breakglass
action to access an unusual resource that they likely don't actually need"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

### 3.3 Two warnings that change a design

**A session log is not an audit trail.** "Logging that the user opened an interactive session to a
large API does not meaningfully tell you what they did"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

This kills the defence "the wildcard is safe because we log it". A record that says
`super_admin opened the dashboard` answers nothing.

**A justification must be structured, not free text.** Google records the reason "with a structured
reference such as a bug number, ticket number, or customer case number. Doing so allows us to build
programmatic checks of the audit logs". Free text defeats that check: "It would be much harder to
automate log verification if we relied upon free-text fields"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

Google also names the failure mode of an approval workflow. Users "might work around enforced best
practices by providing generic business justifications (like 'Team foo needed access')". The
countermeasure is detection: "Patterns of generic justifications should set off alarm signals in the
auditing system" ([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

Frequent break-glass use is a design defect, not a steady state: "When breakglass access is required
for a specific task, it often signals a need to provide a safer or more secure way to perform that
task as part of the normal API"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

### 3.4 Just-in-time elevation, as shipped

**Google Cloud Privileged Access Manager.** PAM controls "just-in-time temporary privilege elevation
for select principals" and lets you "view audit logs afterwards to find out who had access to what
and when" ([PAM overview](https://docs.cloud.google.com/iam/docs/pam-overview)).

An entitlement carries these attributes, in Google's words:

- "Whether a justification is required for that grant."
- "The maximum duration a grant can last."
- "Optional: Whether requests need approval from a select set of principals, and whether those principals need to justify their approval."
- "Optional: Additional stakeholders to be notified about important events, such as grants and pending approvals."

The ceiling is hard: "The maximum duration you can set for an entitlement is 7 days", and "The
supported range is between 30 minutes (1800s) and 168 hours (604800s)"
([PAM entitlements](https://docs.cloud.google.com/iam/docs/pam-create-entitlements)).

Google separates emergency from routine. Emergency responders may skip approval, but they keep the
justification: "Allow select emergency responders to perform critical tasks without having to wait
for approval. You can require justifications for emergency access requests for additional context"
([PAM overview](https://docs.cloud.google.com/iam/docs/pam-overview)).

**Microsoft Entra Privileged Identity Management.** The activation window is "from one to 24 hours".
Administrators "can require users to enter a business justification when they activate the eligible
assignment". Microsoft recommends "at least two approvers". A ticket number field exists, but
"Correlation with information in any ticketing system isn't enforced"
([PIM settings](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings)).

That page also documents the self-lockout failure. A tenant locks out when all three conditions hold:

- All Global Administrators hold eligible assignments only, and none are active.
- Approval is required for activation.
- No approvers are configured.

Microsoft's mitigation is a designated break-glass identity: "Avoid this situation by configuring
emergency access accounts and configuring specific approvers".

**AWS.** AWS equates the two names: "Temporary elevated access (also known as just-in-time access)
is a way to request, approve, and track the use of a permission to perform a specific task during a
specified time". AWS also pairs it with a separate emergency path: "To ensure business continuity,
we recommend that you set up emergency access to the AWS Management Console"
([temporary elevated access](https://docs.aws.amazon.com/singlesignon/latest/userguide/temporary-elevated-access.html)).

### 3.5 AWS on the root user — the split-knowledge pattern

AWS treats the root user as an emergency identity, not an administrator identity.

- "We strongly recommend you don't access the AWS account root user unless you have a task that requires root user credentials."
- "All AWS account types (standalone, management, and member accounts) require MFA to be configured for their root user."
- "We strongly recommend that you do not create access keys for your root user."

([root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html))

The same page describes split knowledge, which is the reusable idea: "one group of administrators
with access to the password, and another group of administrators with access to MFA. One member from
each group must come together to sign in as the root user." It adds "No one person should have
access to both the email inbox and phone number".

Detection and response are explicit. AWS says to "use your current tracking mechanisms to monitor,
alert, and report the sign in and use of root user credentials", and to "Have procedures in place for
how to respond to alerts so that personnel who receive a root user access alert understand how to
validate that root user access is expected".

At organisation scale, AWS deletes the standing credential outright: "you can choose to delete root
user credentials from member accounts", and "We recommend deleting root user credentials once you
complete the task that requires access to the root user". Recovery becomes an on-demand privileged
task, and the sign-in is logged separately: "CloudTrail logs different sign-in events for the root
user and privileged root user sessions"
([root user tasks](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-tasks.html)).

For the organisational management account, AWS states that its own guardrails do not apply: "Organizations
service control policies (SCPs) do not work to restrict any users or roles in the management
account". The compensating controls are a small holder set, a review cadence — "Add a monthly or
quarterly review of this information to verify that only the correct people have access" — and a
recovery process with no single point of failure: "Ensure that the process to recover or reset access
to the root user credentials is not reliant on any specific individual to complete"
([management account best practices](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices_mgmt-acct.html)).

### 3.6 What NIST adds

NIST names emergency accounts as an account type, and requires automatic expiry.

- AC-2 guidance: "Examples of system account types include individual, shared, group, system, guest, anonymous, emergency, developer, temporary, and service."
- AC-2(2) AUTOMATED TEMPORARY AND EMERGENCY ACCOUNT MANAGEMENT: "Automatically [remove/disable] temporary and emergency accounts after [time period]." The guidance gives the reason: removal happens "automatically after a predefined time period rather than at the convenience of the system administrator."
- AC-2(11) USAGE CONDITIONS supports time limits: "restricting usage to certain days of the week, time of day, or specific durations of time."

([NIST SP 800-53 Rev 5 OSCAL catalog](https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json))

---

## 4. Vendor access to customer data

Five vendors, five different answers. Salesforce is the only one that fully separates the acting
person from the impersonated person in the audit record.

| Vendor         | Consent required                          | Time-boxed                                | Customer-visible log                   | Acting person preserved                |
| -------------- | ----------------------------------------- | ----------------------------------------- | -------------------------------------- | -------------------------------------- |
| **Salesforce** | Yes. Only the user may grant or revoke.   | Yes. 1 day to 1 year. Maximum 1 year.     | Yes. Setup Audit Trail, Login History  | **Yes. A separate `DelegateUser`.**    |
| **Shopify**    | Yes. A merchant code plus an accept.      | Partly. 90 days of inactivity expires it. | Yes. Store activity log.               | Yes. The collaborator name.            |
| **Atlassian**  | Yes, by a "consent control checker".      | Statuspage: 7 days plus 24 hours.         | Statuspage: yes. Cloud: not found.     | Role level only. Not the individual.   |
| **Zendesk**    | Opt-in for paid. On by default in trials. | Yes. 1 day to indefinite.                 | Not documented for assumed sessions.   | **No. Actions show the assumed user.** |
| **Stripe**     | Not documented for Stripe Support.        | Not documented.                           | Activity logs, no impersonation event. | Not documented.                        |

### 4.1 Salesforce — the model to copy

Salesforce makes consent mandatory, per user, and non-delegable:

> "No one within Salesforce Support may log in to your organization to resolve issues without this
> explicit permission and duration for the access."

> "The customer user can update the duration of, or revoke, Login Access granted at any time. No one
> other than the individual customer user can change or revoke Login Access on behalf of that user."

([Grant Login Access to Salesforce Support](https://help.salesforce.com/s/articleView?id=000388857&language=en_US&type=1))

The duration is a fixed picklist: 1 day, 3 days, 1 week, 1 month, 1 year. "For security reasons, the
maximum period for granting access is 1 year"
([Grant login access](https://help.salesforce.com/apex/HTViewHelpDoc?id=sf.granting_login_access.htm)).

Support never receives a password: "Granting access allows Support to log in securely without needing
your password", and "Salesforce Support will never ask for your password"
([login access FAQ](https://help.salesforce.com/s/articleView?id=000384334&language=en_US&type=1)).

An administrator cannot forge the consent: "You can't grant login access to other admins on behalf of
the user that you're logged in as. The user must grant login access directly"
([Log in as another user](https://help.salesforce.com/s/articleView?id=sf.logging_in_as_another_user.htm&language=en_US&type=5)).

**The key design detail.** The acting identity is a dedicated column. `SetupAuditTrail.DelegateUser`
is "The Login-As user who executed the action in Setup. If a Login-As user didn't perform the action,
this field is blank"
([SetupAuditTrail object reference](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_setupaudittrail.htm)).
`CreatedBy` still holds the impersonated user. The trail therefore answers both questions at once.

A dedicated event exists too. `LoginAsEvent` "tracks when an admin logs in as another user in your
org", and `DelegatedUsername` is the "Username of the admin who logs in as another user". That event
needs a paid add-on: "either the Salesforce Shield or Salesforce Event Monitoring add-on subscription"
([LoginAsEvent](https://developer.salesforce.com/docs/atlas.en-us.platform_events.meta/platform_events/sforce_api_objects_loginasevent.htm)).

One caution. Plain Login History does not distinguish an impersonated sign-in. The `LoginType`
picklist has no Login-As value, and the object has no delegate field
([LoginHistory](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_loginhistory.htm)).
The delegate identity lives in Setup Audit Trail and in `LoginAsEvent`, not in the sign-in log.

### 4.2 Zendesk — the counter-example

Zendesk gates vendor access behind an account setting with a duration. The setting "is turned off by
default and can be turned on by Support and Chat admins", and the duration menu offers "One day, One
week, One month, One year, or Indefinitely". "Access from Zendesk is disabled automatically after this
period of time"
([Granting Zendesk temporary access](https://support.zendesk.com/hc/en-us/articles/4408824477082-Granting-Zendesk-temporary-access-to-assume-your-account)).

Two carve-outs weaken the consent:

- "Zendesk reserves the right to assume the role of an agent in your account without prior notice in certain situations."
- "Zendesk trial accounts always have account assumption enabled."

The audit defect is explicit. When an agent assumes an end user, "any actions you take, such as
creating a ticket or adding a comment to a ticket, are done by the user you're logged in as"
([Assuming end-users](https://support.zendesk.com/hc/en-us/articles/4408894200474-Assuming-end-users)).
The audit log documentation lists no entry for an assumed session
([Viewing the audit log](https://support.zendesk.com/hc/en-us/articles/4408828001434-Viewing-the-audit-log-for-changes)).

The result: an impersonated action is indistinguishable from the user's own action. Umi must not
copy this.

### 4.3 Shopify — scoped, merchant-issued, expiring

Shopify does not document Shopify Support access to a store. It documents the collaborator account,
which is still a useful reference for a third party who needs merchant data.

- The merchant holds the secret: "You must provide the collaborator with a request code. The collaborator must enter this code when they submit a collaborator request."
- The merchant sets the scope: "The merchant sets the scope of your permissions. You can only access the parts of the store they've granted you access to." ([Shopify collaborations](https://shopify.dev/docs/apps/build/dev-dashboard/stores/collaborations))
- Access expires on idleness: "If a collaborator user hasn't logged into your store within 90 days, then their access will automatically expire."
- Attribution survives: "The collaborator's name and actions are still listed in any relevant timelines, such as the store activity log and order timeline."

([Collaborator accounts](https://help.shopify.com/en/manual/your-account/users/security/collaborator-accounts))

The store activity log names the actor — "Each event includes the name of the person, app, or channel
that took the action" — but it is shallow: "The store activity log displays a maximum of 250 results"
([Activity logs](https://help.shopify.com/en/manual/shopify-admin/activity-logs)).

### 4.4 Stripe — no documented support-access flow

Stripe publishes no article on granting Stripe Support access to an account. Searches of
`support.stripe.com` and `docs.stripe.com` found none. Mark this as a documentation gap, not as
proof that no such control exists.

What Stripe does document is impersonation between a platform and a connected account. It is a
header, not a consent flow: "To make server-side API calls for connected accounts, use the
`Stripe-Account` header with the Account ID"
([Connect authentication](https://docs.stripe.com/connect/authentication)). The dashboard equivalent
uses the same primitive: "View Dashboard As" works "by passing the connected account ID as the
`stripe-account-header` on requests made from the Stripe Dashboard"
([managing connected accounts](https://docs.stripe.com/connect/dashboard/managing-individual-accounts)).

Stripe activity logs retain six months and record "the actor, timestamp, affected resources, and
contextual metadata", but the documented event types cover API keys, invites, and roles only. No
impersonation event type appears ([Activity logs](https://docs.stripe.com/activity-logs)).

### 4.5 Atlassian — consent yes, mechanics partly unverified

Atlassian states the rule at the trust level: "Before our support engineers are able to access
customer data stored within our applications, our customers must provide their explicit consent to
allow such access through our consent control checker"
([Atlassian security practices](https://www.atlassian.com/trust/security/security-practices)).

Statuspage is the readable first-party source for the mechanics. It uses two nested clocks:

- "Contacting us in support is automatically considered as granting consent for a 7 day period."
- "Support can generate an Access Grant to view a specific page that lasts 24 hours."
- An "Activity log entry is generated", and the contacting team member and the account owner receive a notification.

([Statuspage customer data access grants](https://support.atlassian.com/statuspage/docs/customer-data-access-grants-information/))

Atlassian also marks vendor-performed actions as vendor-performed. The audit activity database lists
"Added admin by Atlassian support" and "Removed admin by Atlassian support"
([audit log activities](https://support.atlassian.com/security-and-access-policies/docs/audit-log-activities-database/)).
That preserves the role, but not the individual engineer.

**Unverified.** The Atlassian Cloud consent checkbox, the `Settings > Support access` screen, and any
Atlassian Cloud duration could not be confirmed. The page that would state them is JavaScript-only.

### 4.6 What the five vendors agree on

Four of five vendors require consent. Four of five time-box the access. Three of five expose the
access in a customer-visible log. Only one — Salesforce — stores the acting person separately from
the impersonated person.

The design to copy is Salesforce's, plus Statuspage's notification when a grant is created.

---

## 5. Compliance requirements

### 5.1 PCI DSS v4.x — a contractual obligation, not a law

**Who enforces it.** PCI SSC writes the standard and disclaims enforcement: "Whether an entity is
required to comply with or validate compliance to a PCI SSC standard is at the discretion of
organizations that manage compliance programs, such as a payment brand, acquirer, or other entity"
([PCI DSS page](https://www.pcisecuritystandards.org/standards/pci-dss/)).

Umi's obligation therefore arrives through an acquirer or processor contract. Umi holds no such
contract today.

**Requirement text.** All quotes below come from
[PCI DSS v4.0 SAQ D for Service Providers](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-D-Service-Provider.pdf?agreement=true),
April 2022, which reproduces the requirements normatively.

#### Unique identity and shared accounts

**8.2.1** — "All users are assigned a unique ID before access to system components or cardholder data
is allowed."

The applicability note carves out the till operator: "This requirement is not intended to apply to
user accounts within point-of-sale terminals that have access to only one card number at a time to
facilitate a single transaction (such as IDs used by cashiers on point-of-sale terminals)."

**This carve-out matches Umi's PIN model.** `merchant.staff.operator_pin_lookup` identifies a barista
at a till. The carve-out does not extend to the dashboard, to the platform console, or to any
back-office role.

**8.2.2** — Shared accounts are allowed only under six conditions at once:

> "Group, shared, or generic accounts, or other shared authentication credentials are only used when
> necessary on an exception basis, and are managed as follows: • Account use is prevented unless needed
> for an exceptional circumstance. • Use is limited to the time needed for the exceptional
> circumstance. • Business justification for use is documented. • Use is explicitly approved by
> management. • Individual user identity is confirmed before access to an account is granted. • Every
> action taken is attributable to an individual user."

Note the last condition. It is the same rule that Salesforce implements with `DelegateUser`.

**8.2.3** — "**Additional requirement for service providers only:** Service providers with remote
access to customer premises use unique authentication factors for each customer premises."

The same note limits it: "This requirement is not intended to apply to service providers accessing
their own shared services environments, where multiple customer environments are hosted." Umi's
merchants come to a multi-tenant cloud, so 8.2.3 does not bite today. It would bite if Umi ever
remotes into a café to service POS hardware.

#### MFA — Requirements 8.4 and 8.5, not 8.3

Requirement 8.3.1 governs authentication factors, not MFA. The MFA requirements are:

- **8.4.1** — "MFA is implemented for all non-console access into the CDE for personnel with administrative access."
- **8.4.2** — "MFA is implemented for all access into the CDE." It excludes "Application or system accounts performing automated functions" and till operator accounts.
- **8.4.3** — "MFA is implemented for all remote network access originating from outside the entity's network that could access or impact the CDE", for personnel, third parties, and vendors.
- **8.5.1** — The MFA system "is not susceptible to replay attacks", "cannot be bypassed by any users, including administrative users unless specifically documented, and authorized by management on an exception basis, for a limited time period", uses "At least two different types of authentication factors", and requires "Success of all authentication factors ... before access is granted".

8.4.2 and 8.4.3 do not substitute for each other: "applying MFA to one type of access does not
replace the need to apply" the other.

#### Least privilege — Requirement 7.2

- **7.2.1** — the access control model grants "The least privileges required (for example, user, administrator) to perform a job function."
- **7.2.2** — "Access is assigned to users, including privileged users, based on: • Job classification and function. • Least privileges necessary to perform job responsibilities."
- **7.2.3** — "Required privileges are approved by authorized personnel."
- **7.2.5** (future-dated) — application and system accounts follow "the least privileges necessary for the operability of the system or application."
- **7.2.5.1** (future-dated) — those accounts are reviewed "Periodically", the access "remains appropriate for the function being performed", "Any inappropriate access is addressed", and "Management acknowledges that access remains appropriate."

#### Audit logs — Requirement 10.2

- **10.2.1.2** — "Audit logs capture all actions taken by any individual with administrative access, including any interactive use of application or system accounts."
- **10.2.1.5** — "Audit logs capture all changes to identification and authentication credentials including, but not limited to: • Creation of new accounts. • Elevation of privileges. • All changes, additions, or deletions to accounts with administrative access."
- **10.2.2** — each event records six fields: "• User identification. • Type of event. • Date and time. • Success and failure indication. • Origination of event. • Identity or name of affected data, system component, resource, or service".

**10.2.2 is a table schema.** Section 8.6 measures Umi's four audit tables against these six fields.

#### Scope

The standard applies to "Entities that store, process, or transmit cardholder data (CHD) and/or
sensitive authentication data (SAD) or could impact the security of the cardholder data environment
(CDE)" ([PCI DSS page](https://www.pcisecuritystandards.org/standards/pci-dss/)).

The CDE includes "System components that may not store, process, or transmit CHD/SAD but have
unrestricted connectivity to system components that store, process, or transmit CHD/SAD"
([PCI SSC glossary](https://www.pcisecuritystandards.org/glossary/)).

A service provider is a "Business entity that is not a payment brand, directly involved in the
processing, storage, or transmission of cardholder data (CHD) and/or sensitive authentication data
(SAD) on behalf of another entity" (same glossary). Note the words "directly involved". A SaaS that
never touches card data is not a service provider by that definition. The wider "could impact the
security of the CDE" clause is the one to watch.

The default posture is in-scope: "the best practice approach is to start with the assumption that
everything is in scope until verified otherwise"
([Scoping and Segmentation guidance](https://listings.pcisecuritystandards.org/documents/Guidance-PCI-DSS-Scoping-and-Segmentation_v1_1.pdf?agreement=true)).

**The highest-value scope decision available to Umi is P2PE.** SAQ P2PE contains only Requirement 3,
Requirement 9, and Requirement 12. Requirements 7, 8 and 10 are absent. Eligibility: "SAQ P2PE
merchants do not have access to clear-text account data on any computer system, and only enter
account data via payment terminals from a validated PCI-listed P2PE solution"
([SAQ P2PE](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-P2PE.pdf?agreement=true)).

SAQ A and SAQ A-EP do not help. Both state "This SAQ is not applicable to service providers", and SAQ
A adds "This SAQ is not applicable to face-to-face channels"
([SAQ A](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-A.pdf?agreement=true)).

Outsourcing does not transfer the liability: "The use of a TPSP, however, does not relieve the entity
of ultimate responsibility for its own PCI DSS compliance"
([Third-Party Security Assurance v1.1](https://listings.pcisecuritystandards.org/documents/ThirdPartySecurityAssurance_March2016_FINAL.pdf?agreement=true)).

#### The future-dated date

51 of the 64 new v4.x requirements were best practice until 31 March 2025. PCI SSC states: "Of the 64
new requirements, 51 are future-dated and will be effective as of 31 March 2025"
([PCI SSC blog](https://blog.pcisecuritystandards.org/now-is-the-time-for-organizations-to-adopt-the-future-dated-requirements-of-pci-dss-v4-x)).
That date has passed. Requirements 7.2.5 and 7.2.5.1 are therefore active, not aspirational.

#### Other PCI standards

PA-DSS is retired "as of 28 October 2022 and has been superseded by the Secure Software Standard and
the Secure Software Lifecycle Standard" ([PCI SSC standards](https://www.pcisecuritystandards.org/standards/)).

The Secure Software Standard covers Umi's population: it "is intended for software vendors and others
that develop Payment Software that is sold, distributed, or licensed to third parties", and it "is
**not** intended for Payment Software developed in-house for the sole use of the company that
developed the software"
([Secure Software Program Guide](https://listings.pcisecuritystandards.org/documents/Secure-Software-Program-Guide-v1.0.1.pdf?agreement=true)).

Umi sells UmiPOS to several cafés. Umi is therefore **eligible** for Secure Software validation. It
is not automatically **required** to validate. The payment brands decide.

### 5.2 SOC 2 Trust Services Criteria CC6 — contractual only

**Source caution.** The AICPA download needs a free account. The text below comes from a third-party
mirror of the March 2020 edition. It is **secondary and unverified**.

SOC 2 is an attestation, not a law and not a certification. AICPA's own notice describes the criteria
as "control criteria established by the Assurance Services Executive Committee (ASEC) of the AICPA
**for use in attestation or consulting engagements**". The service organisation selects the
categories. Only the common criteria, CC1 to CC9, appear in every SOC 2.

- **CC6.1** — "The entity implements logical access security software, infrastructure, and architectures over protected information assets to protect them from security events to meet the entity's objectives." One point of focus names "administrative authorities" among the assets to restrict.
- **CC6.2** — "Prior to issuing system credentials and granting system access, the entity registers and authorizes new internal and external users whose access is administered by the entity. For those users whose access is administered by the entity, user system credentials are removed when user access is no longer authorized." A point of focus requires a periodic review: "The appropriateness of access credentials is reviewed on a periodic basis for unnecessary and inappropriate individuals with credentials."
- **CC6.3** — "The entity authorizes, modifies, or removes access to data, software, functions, and other protected information assets based on roles, responsibilities, or the system design and changes, giving consideration to the concepts of **least privilege and segregation of duties**, to meet the entity's objectives."

**A negative finding worth recording.** Across the whole CC6 series, the word "privilege" appears
once — in CC6.3. SOC 2 states the principle and leaves the mechanism to the service organisation.
PCI DSS does the opposite and prescribes the mechanism.

### 5.3 NIST SP 800-53 Rev 5 — voluntary for Umi

NIST states the status in its own Authority section: the publication supports NIST's FISMA duties,
and "**This publication may be used by nongovernmental organizations on a voluntary basis** and is
not subject to copyright in the United States"
([SP 800-53 Rev 5](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)).

For a private Mexican and United States SaaS, 800-53 binds only through a contract. Its value is
vocabulary: it states in one line what PCI DSS spreads across three requirement families.

Control text, from the
[NIST OSCAL catalog release 5.2.0](https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json):

- **AC-2(7) PRIVILEGED USER ACCOUNTS** — "(a) Establish and administer privileged user accounts in accordance with [a role-based access scheme | an attribute-based access scheme]; (b) Monitor privileged role or attribute assignments; (c) Monitor changes to roles or attributes; and (d) Revoke access when privileged role or attribute assignments are no longer appropriate."
- **AC-6(2) NON-PRIVILEGED ACCESS FOR NONSECURITY FUNCTIONS** — "Require that users of system accounts (or roles) with access to [security functions or security-relevant information] use non-privileged accounts or roles, when accessing nonsecurity functions."
- **AC-6(5) PRIVILEGED ACCOUNTS** — "Restrict privileged accounts on the system to [personnel or roles]." Guidance: "Restricting privileged accounts to specific personnel or roles prevents day-to-day users from accessing privileged information or privileged functions."
- **AC-6(7) REVIEW OF USER PRIVILEGES** — "(a) Review [frequency] the privileges assigned to [roles and classes] to validate the need for such privileges; and (b) Reassign or remove privileges, if necessary".
- **AC-6(9) LOG USE OF PRIVILEGED FUNCTIONS** — "Log the execution of privileged functions."

### 5.4 Which is which

| Framework                           | Category                     | What binds Umi                                                      |
| ----------------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| PCI DSS v4.0.1                      | Contractual, and unavoidable | The acquirer or processor agreement. PCI SSC disclaims enforcement. |
| PCI Secure Software Standard / P2PE | Contractual, mostly optional | Payment brand programs. P2PE is a scope tool, not a duty.           |
| SOC 2 (AICPA TSC)                   | Contractual only             | Enterprise procurement asks for the report. No law requires it.     |
| NIST SP 800-53 Rev 5                | Voluntary common practice    | Mandatory only for United States federal systems, or by contract.   |

**Out of scope, and flagged.** Mexican data-protection law binds Umi by statute. None of the three
frameworks above substitutes for it. This report did not research it. Treat that as an open item.

---

## 6. How the first administrator is created

Seven systems, one pattern.

### 6.1 The pattern

**The bootstrap credential is created out of band. It never comes through the application's own API.**

Kubernetes states the reason plainly: "When bootstrapping the first roles and role bindings, it is
necessary for the initial user to grant permissions they do not yet have"
([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)).

An authorization system cannot authorize its own first grant. The authority therefore comes from a
lower layer: shell access, file ownership, a process environment variable, a localhost connection, or
possession of an email inbox.

| System         | How the first admin appears                                | How it retires                                        |
| -------------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| **Vault**      | `vault operator init` prints a root token                  | Manual revocation. The token has no expiry.           |
| **Kubernetes** | `kubeadm init` writes `super-admin.conf` to disk           | Move the file off the machine. RBAC cannot revoke it. |
| **PostgreSQL** | `initdb` creates the bootstrap superuser                   | Create other roles, then stop using the superuser.    |
| **Grafana**    | Default `admin` / `admin`, or `GF_SECURITY_ADMIN_PASSWORD` | Forced password change at first sign-in.              |
| **Keycloak**   | `KC_BOOTSTRAP_ADMIN_*`, or `bin/kc.sh bootstrap-admin`     | "the account needs to be removed manually"            |
| **GitLab**     | `/etc/gitlab/initial_root_password`                        | The file self-deletes after 24 hours.                 |
| **Django**     | `createsuperuser` on the host                              | No documented retirement.                             |

### 6.2 The retirement step is documented, and it is manual

Vault gives the clearest instruction:

> "The Vault team recommends that root tokens are only used for just enough initial setup (usually,
> setting up auth methods and policies necessary to allow administrators to acquire more limited
> tokens) or in emergencies, and are revoked immediately after they are no longer needed."

([Vault tokens](https://developer.hashicorp.com/vault/docs/concepts/tokens))

Vault repeats it in the hardening guide: "Once you complete initial Vault setup, you should revoke the
initial root token to reduce risk of exposure", and "Root tokens can be generated when needed, and
should be revoked when no longer needed"
([production hardening](https://developer.hashicorp.com/vault/docs/concepts/production-hardening)).

The initial token never expires by itself: "The initial root token generated at `vault operator init`
time -- this token has no expiration" ([Vault tokens](https://developer.hashicorp.com/vault/docs/concepts/tokens)).

Keycloak calls the account temporary in its own words:

> "A user or service admin account created using one of the methods described below is **temporary**.
> This means the account should exist only for the duration necessary to perform operations needed to
> gain permanent and more secure admin access. After that, the account needs to be removed manually."

([Keycloak bootstrap admin and recovery](https://www.keycloak.org/server/bootstrap-admin-recovery))

GitLab automates only the delivery channel. The account stays, but "GitLab generates a random password
and email address for the root administrator account stored in `/etc/gitlab/initial_root_password` for
24 hours. After 24 hours, this file is automatically removed for security reasons"
([GitLab install](https://docs.gitlab.com/install/package/ubuntu/)).

No system deletes the bootstrap account automatically. The order is universal: build the real
authentication first, then retire the bootstrap credential.

### 6.3 The recovery path is the real design decision

| System         | Recovery command                          | What an attacker needs                       |
| -------------- | ----------------------------------------- | -------------------------------------------- |
| **Vault**      | `vault operator generate-root`            | **A quorum of key holders.** Default 3 of 5. |
| **Keycloak**   | `bin/kc.sh bootstrap-admin user`          | A shell on the server.                       |
| **GitLab**     | `gitlab-rake "gitlab:password:reset"`     | A shell on the server.                       |
| **PostgreSQL** | `postgres --single`                       | Ownership of the data directory.             |
| **Kubernetes** | `super-admin.conf`, or the cluster CA key | Possession of a file.                        |
| **AWS**        | Root email password reset                 | Control of the root email inbox.             |

Vault is the only system that requires more than one person. It "generates a new root token by
combining a quorum of share holders"
([generate-root](https://developer.hashicorp.com/vault/docs/commands/operator/generate-root)).

Every other system reduces to one rule: shell or file access equals administrator. PostgreSQL states
it without apology. In single-user mode, "implicit superuser powers are granted to this user. This
user does not actually have to exist"
([postgres single-user mode](https://www.postgresql.org/docs/current/app-postgres.html)).

### 6.4 The mature refinement is two tiers

Kubernetes splits the break-glass identity from the everyday administrator identity.

- `super-admin.conf` carries `O = system:masters`. The docs call it "a break-glass, super user group that bypasses the authorization layer (for example RBAC). Do not share the `super-admin.conf` file with anyone."
- `admin.conf` carries `O = kubeadm:cluster-admins`. That group "is bound to the built-in `cluster-admin` ClusterRole" — an ordinary, revocable RBAC subject.

([Creating a cluster with kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/))

The break-glass identity is used exactly once, to create the RBAC binding that the everyday identity
then uses: `admin.conf` "is bound to the `cluster-admin` ClusterRole during `kubeadm init`, by using
the `super-admin.conf` file, which does not require RBAC"
([kubeadm implementation details](https://kubernetes.io/docs/reference/setup-tools/kubeadm/implementation-details/)).

AWS follows the same shape with the root user and an IAM Identity Center administrative user
([AWS account root user](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_root-user.html)).

---

## 7. Is a wildcard permission defensible?

### 7.1 The wildcard exists, and three major systems ship one

**Kubernetes.** The `cluster-admin` ClusterRole is literally a wildcard. The bootstrap policy source
reads:

```go
// a "root" role which can do absolutely anything
ObjectMeta: metav1.ObjectMeta{Name: "cluster-admin"},
Rules: []rbacv1.PolicyRule{
    rbacv1helpers.NewRule("*").Groups("*").Resources("*").RuleOrDie(),
    rbacv1helpers.NewRule("*").URLs("*").RuleOrDie(),
},
```

([kubernetes/plugin/pkg/auth/authorizer/rbac/bootstrappolicy/policy.go](https://raw.githubusercontent.com/kubernetes/kubernetes/master/plugin/pkg/auth/authorizer/rbac/bootstrappolicy/policy.go))

**AWS.** The `AdministratorAccess` managed policy is `{"Effect":"Allow","Action":"*","Resource":"*"}`,
unchanged since 6 February 2015
([AdministratorAccess](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AdministratorAccess.html)).

**PostgreSQL.** "A database superuser bypasses all permission checks, except the right to log in"
([role attributes](https://www.postgresql.org/docs/current/role-attributes.html)).

### 7.2 Each of the three tells you not to keep it

**Kubernetes** attaches a caution to its own wildcard example, and the example role is named
`example.com-superuser # DO NOT USE THIS ROLE, IT IS JUST AN EXAMPLE`:

> "Using wildcards in resource and verb entries could result in overly permissive access being granted
> to sensitive resources. For instance, if a new resource type is added, or a new subresource is
> added, or a new custom verb is checked, the wildcard entry automatically grants access, which may be
> undesirable. The principle of least privilege should be employed..."

([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/))

The RBAC good-practices page is blunter:

> "Avoid providing wildcard permissions when possible, especially to all resources. As Kubernetes is
> an extensible system, providing wildcard access gives rights not just to all object types that
> currently exist in the cluster, but also to all object types which are created in the future."

> "Administrators should not use `cluster-admin` accounts except where specifically needed."

([RBAC good practices](https://kubernetes.io/docs/concepts/security/rbac-good-practices/))

The same page requires a cadence: "It is vital to periodically review the Kubernetes RBAC settings for
redundant entries and possible privilege escalations."

**AWS** publishes the wildcard with no warning on the policy page itself, and then argues against it
everywhere else. Its security best-practices page treats breadth as a transitional state: "You might
start with broad permissions while you explore the permissions that are required for your workload or
use case. As your use case matures, you can work to reduce the permissions that you grant to work
toward least privilege." It also states "Require your human users to use temporary credentials when
accessing AWS" and "Regularly review and remove unused users, roles, permissions, policies, and
credentials" ([IAM security best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html)).

AWS sells a product to undo the wildcard. IAM Access Analyzer "analyzes your AWS CloudTrail logs to
identify actions and services that have been used by an IAM entity... It then generates an IAM policy
that is based on that access activity"
([IAM Access Analyzer](https://docs.aws.amazon.com/IAM/latest/UserGuide/what-is-access-analyzer.html)).

**PostgreSQL** is the strongest case, because the database that ships a superuser argues against it:

> "Superuser status is dangerous and should be used only when really needed."
> ([CREATE ROLE](https://www.postgresql.org/docs/current/sql-createrole.html))

> "This is a dangerous privilege and should not be used carelessly; it is best to do most of your work
> as a role that is not a superuser."
> ([role attributes](https://www.postgresql.org/docs/current/role-attributes.html))

PostgreSQL then decomposes the wildcard. Predefined roles exist to "provide access to certain,
commonly needed, privileged capabilities and information" without a superuser. Note the shape of
`pg_read_all_data`: it reads everything, and yet "This role does not bypass row-level security (RLS)
policies" ([predefined roles](https://www.postgresql.org/docs/current/predefined-roles.html)).

PostgreSQL 16 narrowed the admin path further: "Restrict the privileges of `CREATEROLE` and its
ability to modify other roles... Such changes, including adding members, now require the role
requesting the change to have `ADMIN OPTION` permission"
([PostgreSQL 16 release notes](https://www.postgresql.org/docs/16/release-16.html)).

The direction of travel over thirty years of PostgreSQL is away from the wildcard, never toward it.

### 7.3 A hard PostgreSQL constraint that affects Umi

PostgreSQL cannot time-box a role. "The `VALID UNTIL` clause defines an expiration time **for a
password only, not for the role per se.** In particular, the expiration time is not enforced when
logging in using a non-password-based authentication method"
([CREATE ROLE](https://www.postgresql.org/docs/current/sql-createrole.html)).

Umi must therefore enforce every time limit in the application layer. The database will not do it.

### 7.4 The canon against standing unbounded privilege

**Saltzer and Schroeder (1975)**, the origin text:

> "Least privilege: Every program and every user of the system should operate using the least set of
> privileges necessary to complete the job. Primarily, this principle limits the damage that can
> result from an accident or error. ... Thus, if a question arises related to misuse of a privilege,
> the number of programs that must be audited is minimized."

([The Protection of Information in Computer Systems](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html))

Two parts of that text are usually skipped. The primary justification is **accident**, not attack. The
secondary one is **auditability**. A wildcard destroys the ability to answer "who could have done
this?". The same paper's principle (b) states "Fail-safe defaults: Base access decisions on permission
rather than exclusion." A wildcard is the inverse of a fail-safe default.

**Google** rates the top sensitivity tier at zero standing access. Its own risk table reads "Highly
sensitive | No permanent access | High risk | High risk | High risk". The chapter also explains why a
temporary grant is better: "Temporary access also reduces ambient authority... when you accidentally
issue a command to delete all the data, the fewer permissions you have, the better!"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

**OWASP ASVS** requires explicit permissions and MFA on administrative interfaces:

- 4.1.3 — "Verify that the principle of least privilege exists - users should only be able to access functions, data files, URLs, controllers, services, and other resources, for which they possess specific authorization."
- 4.3.1 — "Verify that administrative interfaces use appropriate multi-factor authentication to prevent unauthorized use."

([ASVS 4.0 V4 Access Control](https://raw.githubusercontent.com/OWASP/ASVS/master/4.0/en/0x12-V4-Access-Control.md))

ASVS 5.0 renumbers the chapter to V8 and repeats the word "explicit": 8.2.1 — "Verify that the
application ensures that function-level access is restricted to consumers with explicit permissions."
It also requires that "changes to values on which authorization decisions are made are applied
immediately" (8.3.2)
([ASVS 5.0 V8 Authorization](https://raw.githubusercontent.com/OWASP/ASVS/master/5.0/en/0x17-V8-Authorization.md)).

A wildcard is by definition not explicit. It is the absence of an enumeration.

**A fair counterweight.** Google's own chapter concedes the cost: "A highly granular security posture
is a very powerful tool, but it's also complex and therefore challenging to manage", and "While a
strict model of least privilege is likely appropriate for sensitive data and services, a more relaxed
approach in other areas can provide tangible benefits". Its example of an acceptable relaxation is
broad **read** access to source code. It never defends a standing administrative wildcard
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

### 7.5 Verdict

No primary source defends a standing, unbounded, always-on wildcard grant.

Every system that ships one documents it as a **bootstrap and break-glass primitive**. Kubernetes
documents `cluster-admin` under the heading "bootstrapping". If a system uses the wildcard as its
steady state, the bootstrap never ended.

The defensible pattern is the same across all sources:

1. Enumerate the scoped grants.
2. Keep exactly one wildcard path.
3. Make that path break-glass: few holders, MFA, an expiry, a justification, and a loud log record.
4. Test the path.
5. Review the grants on a fixed cadence, and remove unused breadth.

---

## 8. Application to the Umi schema

This section maps every finding above onto Umi's own tables and files.

### 8.1 The current state, in facts

| Fact                                                                                  | Evidence                                                                                                                         |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `super_admin` resolves to `['*']` in application code.                                | [`roles.ts:37`](../../apps/umi-api/src/modules/auth/roles.ts)                                                                    |
| One hardcoded email receives the only platform grant.                                 | [`seed_rbac.sql`](../migration/build-v3/backfill/seed_rbac.sql)                                                                  |
| No API path and no script creates a second platform administrator.                    | [`seed_rbac.sql`](../migration/build-v3/backfill/seed_rbac.sql)                                                                  |
| `developer` and `tech_assist` sit in `ROLE_PRECEDENCE` with no `umi.role` row.        | [`roles.ts:15-16`](../../apps/umi-api/src/modules/auth/roles.ts)                                                                 |
| `umi.user_role` has no expiry, no status, and no justification.                       | [`10_umi.sql:111`](../migration/build-v3/10_umi.sql)                                                                             |
| A grant can only be deleted, never revoked with a reason.                             | [`SECURITY_GATE.md`](../migration/build-v3/SECURITY_GATE.md)                                                                     |
| `umi.user_role` is sealed from the `api` pool. Auth queries run on the `worker` pool. | [`90_rls.sql`](../migration/build-v3/90_rls.sql), [`auth.repository.ts`](../../apps/umi-api/src/modules/auth/auth.repository.ts) |
| `umi.role.is_platform` exists, but nothing enforces it on `umi.user_role`.            | [`10_umi.sql:108-110`](../migration/build-v3/10_umi.sql)                                                                         |
| `runtime.elevation_grant` exists in DDL. No application code reads or writes it.      | [`30_runtime.sql:432`](../migration/build-v3/30_runtime.sql)                                                                     |
| `merchant.staff_permission_override` already carries `expires_at` and `granted_by`.   | [`20_merchant.sql:319`](../migration/build-v3/20_merchant.sql)                                                                   |
| `umi.user` has no MFA column.                                                         | [`10_umi.sql:33`](../migration/build-v3/10_umi.sql)                                                                              |

Two facts deserve credit. The `api` pool cannot read `umi.user_role`, and `merchant.staff_permission_override`
already implements a time-boxed grant. Umi already holds the pattern. It applies it to café staff and
not to its own operators.

### 8.2 `umi.role`

**Problem 1. Two parked strings outrank a real role.** `ROLE_PRECEDENCE` places `developer` and
`tech_assist` above `staff`. `normalizeRoleKey` returns the highest-precedence entry. A user who
somehow held `developer` would reduce to `developer`, outrank `staff`, and then receive zero
permissions, because no `umi.role_permission` row exists. The result is a role that ranks high and
grants nothing. That mismatch is a silent hazard, not forward compatibility.

**Action.** Choose one of two paths:

- Remove both strings from `ROLE_PRECEDENCE` until a seed defines them.
- Seed both as `is_platform` roles with an explicit, narrow permission set in the same change.

Do not leave a name in a precedence list with no definition behind it.

**Problem 2. `is_platform` is a comment, not a constraint.** The DDL comment states the rule and then
declines to enforce it: "NOT enforceable as a CHECK (it needs a lookup)".

**Action.** A composite foreign key enforces it without a trigger:

```sql
alter table umi.role
  add constraint role_id_platform_uq unique (id, is_platform);

alter table umi.user_role
  add column is_platform boolean not null generated always as (true) stored,
  add constraint user_role_platform_only_fk
    foreign key (role_id, is_platform) references umi.role (id, is_platform);
```

This is NIST AC-6(5), "Restrict privileged accounts on the system to [personnel or roles]", expressed
in DDL.

### 8.3 `umi.user_role`

Today the table holds `user_id`, `role_id`, `granted_by`, and `created_at`. It grants forever.

**Action.** Add five columns:

| Column           | Purpose                                        | Source                                      |
| ---------------- | ---------------------------------------------- | ------------------------------------------- |
| `expires_at`     | An automatic end to the grant.                 | NIST AC-2(2); Google PAM maximum of 7 days. |
| `revoked_at`     | A revocation that keeps the history.           | `SECURITY_GATE.md` records the gap.         |
| `revoked_reason` | Why the access ended.                          | NIST AC-2(7)(d).                            |
| `justification`  | A structured reference: a ticket or a case id. | Google: free text defeats automated checks. |
| `approved_by`    | A second person, distinct from `granted_by`.   | Entra PIM: "at least two approvers".        |

Add a CHECK that ties revocation to its reason, in the same style as `runtime.session`:

```sql
constraint user_role_revocation_ck
  check ((revoked_at is null) = (revoked_reason is null))
```

Set a policy, not only a column: a grant that resolves to the wildcard must carry a non-null
`expires_at`. `merchant.staff_permission_override` already permits `expires_at` to be NULL for a
scoped café permission. A platform wildcard is a different risk class.

Remember section 7.3. PostgreSQL will not enforce the expiry. `SUPER_ADMIN_SA_CTE` must add the
predicate itself:

```sql
AND (ur.expires_at IS NULL OR ur.expires_at > now())
AND ur.revoked_at IS NULL
```

Without that predicate the new columns are decoration.

### 8.4 `roles.ts`

**Problem. `effectivePermissions` returns `['*']`.** This is the Kubernetes defect, in Umi's own code.
`10_umi.sql` added eight POS permission keys in July 2026. All eight reached `super_admin` with no
review, because the wildcard grants permissions that did not exist when the wildcard was written.

**Action, in three parts.**

1. Enumerate a platform permission set. Seed it into `umi.role_permission` for `super_admin`, exactly
   as `owner` and `admin` are seeded. A new permission key then requires a deliberate grant.
2. Keep `hasPermission` unchanged. The `granted.includes('*')` branch stays as the single break-glass
   path.
3. Resolve `['*']` only when an active elevation grant exists for the request. Without a grant, a
   platform operator receives the enumerated set.

The result matches Kubernetes' two-tier split: one revocable everyday administrator role, and one
break-glass path that is used rarely and logged loudly.

**Also add a read-only support role.** Sections 4.1 to 4.5 show that support work is mostly reading.
A `support` platform role with read permissions covers most cases without any wildcard. Google states
the principle: "When breakglass access is required for a specific task, it often signals a need to
provide a safer or more secure way to perform that task as part of the normal API."

### 8.5 `seed_rbac.sql`

Section 6 confirms that Umi's approach is correct in shape. A SQL seed run by an operator is exactly
the out-of-band bootstrap that Vault, Kubernetes, GitLab, and Keycloak all use. Keep it. Do not build
an API path that creates a platform administrator.

Three defects remain.

**Defect 1. The email is hardcoded and committed.** `hola@umiconsulting.co` sits in the repository
history. The repository was briefly public. A committed administrator address is an enumeration
target.

**Action.** Read the address from a psql variable, and fail the seed when it is unset:

```sql
\if :{?bootstrap_admin_email}
\else
  \echo 'ERROR: set -v bootstrap_admin_email=... before you run this seed'
  \quit 1
\endif
```

**Defect 2. The seed grant has no retirement step.** Vault, Keycloak, and AWS all document one.

**Action.** Add a retirement block to the file header, as a numbered list:

1. Run the seed with the bootstrap address.
2. Sign in and create the real platform operators, with MFA.
3. Set `expires_at` on the bootstrap grant, or revoke it.
4. Record the retirement in `umi.audit_log`.

**Defect 3. The grant writes no audit record.** `umi.audit_log` already admits `action in ('grant','revoke')`
and names `'user_role'` as an example entity. The seed does not use it.

**Action.** Insert a `umi.audit_log` row for every grant and every revocation. PCI DSS 10.2.1.5
requires exactly this once PCI applies: audit logs capture "Elevation of privileges" and "All changes,
additions, or deletions to accounts with administrative access".

### 8.6 The audit tables against PCI DSS 10.2.2

Requirement 10.2.2 names six fields. Umi has four audit tables with four different shapes.

| Field                          | `umi.audit_log` | `merchant.audit_log` | `merchant.audit_event` | `runtime.security_audit_event` |
| ------------------------------ | --------------- | -------------------- | ---------------------- | ------------------------------ |
| User identification            | `actor_user_id` | `actor_user_id`      | `actor_user_id`        | `actor_user_id`                |
| Type of event                  | `action`        | `action`             | `event_type`           | `event_type`                   |
| Date and time                  | `at`            | `at`                 | `occurred_at`          | `occurred_at`                  |
| Success and failure indication | **absent**      | **absent**           | `outcome`              | `outcome`                      |
| Origination of event           | **absent**      | **absent**           | `correlation_id` only  | `request_id`                   |
| Affected resource              | `entity`        | `entity`             | `entity_type`          | `entity_type`                  |

`umi.audit_log` is the platform-privileged audit table, and it is the weakest of the four. It records
no outcome and no origin. `runtime.security_audit_event` is the strongest and already matches the
shape.

**Action.** Add `outcome` and `request_id` to `umi.audit_log` and to `merchant.audit_log`. Both
tables are append-only by grant, so the change is additive.

### 8.7 The missing column that matters most: `delegate_user_id`

Umi has no impersonation feature today. A `super_admin` who acts inside a café writes their own
`actor_user_id` into `merchant.audit_log`. That is already better than Zendesk.

The risk is future. The moment Umi ships a "log in as" or "view as merchant" feature, one of two
things happens:

- The trail records the Umi operator, and the café cannot see whose account acted.
- The trail records the café user, and the Umi operator disappears. This is the Zendesk defect.

Salesforce solves it with two columns. `CreatedBy` holds the impersonated user. `DelegateUser` holds
"The Login-As user who executed the action in Setup".

**Action.** Add `delegate_user_id uuid references umi.user(id)` to `merchant.audit_log` and to
`merchant.audit_event`, before any impersonation feature ships. PCI DSS 8.2.2 requires the same
outcome for shared credentials: "Every action taken is attributable to an individual user."

Note that `merchant.audit_event` is hash-chained. Add the column before the chain grows, so no
back-fill has to touch a chained row.

### 8.8 Support access to merchant data

Umi has no consent mechanism. A `super_admin` reaches every café by construction, and the café learns
nothing.

Four of the five vendors studied require consent. Umi's cafés are small businesses with a direct
relationship to Umi, so the risk is lower than at Salesforce scale. That is a reason to phase the
work, not to skip it.

**Action, in order.**

1. Write the operator's identity into `merchant.audit_log` for every cross-merchant action. Do this first, because it costs nothing and it makes the access visible.
2. Add `merchant.support_access_grant`, with a merchant approver, an `expires_at`, and a revocation. Follow the Salesforce duration model.
3. Notify the café owner when a grant is created, as Statuspage does.

Keep the emergency path. Zendesk reserves access "to prevent serious harm", and Google PAM lets an
emergency responder skip approval but keep the justification. A consent model with no emergency path
will be bypassed the first time a café is down.

### 8.9 Should `runtime.elevation_grant` serve platform admins?

**No. Add a sibling table in the sealed `umi` schema instead.**

The mechanism is right. The placement is wrong. `runtime.elevation_grant` already carries
`permission_key`, `method`, `approved_by`, `expires_at`, and `consumed_at`. That is a just-in-time
elevation record, and it matches Google PAM's entitlement shape closely.

Five obstacles block reuse:

1. `merchant_id uuid not null`. A platform action has no merchant.
2. `session_id references runtime.session(id)`, and `runtime.session.merchant_id` is also `not null`. A platform operator session cannot exist without a café.
3. `method in ('manager_approval','operator_pin')`. Neither value describes a platform approval.
4. The RLS policy is `merchant_isolation` on `merchant_id`. A row with a NULL merchant would need a second policy, and a fail-open mistake there is a cross-merchant defect.
5. `grant select, insert, update on runtime.elevation_grant to api`. The request path can read and write it.

Point 5 is decisive. `umi.user_role` is sealed from `api` on purpose, and `security_gate.sql` asserts
the seal. A platform elevation record must obey the same rule. If the request path can write the
elevation record, the request path can elevate itself.

**Action.** Add `umi.access_grant` in the sealed schema, with the same column vocabulary:

```sql
create table umi.access_grant (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references umi.user(id) on delete cascade,
  permission_key text not null,
  merchant_id    uuid,              -- null = platform-wide
  method         text not null check (method in ('platform_approval','break_glass')),
  justification  text not null,
  approved_by    uuid references umi.user(id),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
```

Then grant it to `worker` only, revoke it from `api` and `readonly`, and add the assertion to
`security_gate.sql` beside the existing `umi.user_role` check.

One design note. `runtime.elevation_grant` is single-use, because `consumed_at` closes it after one
action. That fits a till void. It does not fit support work, which needs a window. `umi.access_grant`
therefore needs `expires_at` as the primary control, and `consumed_at` as an optional one for a
single-action break-glass.

### 8.10 MFA

`umi.user` holds `password_hash`, `password_salt`, and `password_algorithm`. It holds no second
factor. No MFA code exists in `apps/umi-api`.

Two sources require MFA for administrative access:

- PCI DSS 8.4.1 — "MFA is implemented for all non-console access into the CDE for personnel with administrative access." This binds when PCI applies.
- OWASP ASVS 4.3.1 — "Verify that administrative interfaces use appropriate multi-factor authentication to prevent unauthorized use." This is consensus, at every ASVS level.

AWS requires MFA on the root user of every account type, without exception
([root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)).

**Action.** Add MFA for platform grant holders before PCI applies. A platform grant with no second
factor is one stolen password away from every café.

### 8.11 One residual risk to record

The `worker` pool is BYPASSRLS, and the authentication queries run on it. That is correct, because
`umi.user_role` is invisible to `api`. It also means any defect on a worker code path is unbounded by
the database. `SECURITY_GATE.md` already records the related finding that RBAC scope is not
database-enforced. Section 8.9 keeps `umi.access_grant` on the same pool, so the same residual risk
applies to it. Record it; do not try to remove it at this size.

---

## 9. What is not required of Umi yet

| Requirement                               | Status today      | What starts the obligation                                                               |
| ----------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| PCI DSS v4.0.1, all requirements          | Not binding       | An acquirer or processor contract for the POS. PCI SSC leaves enforcement to that party. |
| PCI DSS 8.2.3 (per-merchant credentials)  | Not binding       | The first time Umi staff remote into a café's premises to service POS hardware.          |
| PCI DSS 8.4.1 (MFA for admin access)      | Not binding       | The moment any Umi system enters the cardholder data environment.                        |
| PCI DSS 7.2.5.1 (periodic account review) | Not binding       | The same moment. This requirement is already effective, since 31 March 2025.             |
| PCI Secure Software Standard validation   | Eligible, not due | A payment brand or acquirer that requires validated payment software.                    |
| SOC 2 Type II report                      | Not binding       | The first enterprise customer that asks for it in procurement.                           |
| NIST SP 800-53 Rev 5                      | Not binding       | A United States federal, FedRAMP, or CMMC-adjacent contract.                             |
| Merchant consent for support access       | Not binding       | A contract term, or a merchant that asks. No studied source makes it a legal duty.       |

### 9.1 The PCI trigger, stated precisely

Umi's own architecture record leaves the question open.
[`2026-07-28-umipos-branch-reconciliation.md`](../architecture/2026-07-28-umipos-branch-reconciliation.md)
§C4 states that "Does the POS process payments or only record them?" is "**Still open**", and that it
is "the business-model decision in §6".

That open question **is** the PCI trigger. Three outcomes:

1. **The POS only records a transaction that a separate SIM terminal processed.** Card data never enters Umi. Umi is likely outside the cardholder data environment. Scoping guidance still says to assume in scope until an assessor verifies otherwise.
2. **The POS drives a validated PCI-listed P2PE terminal.** The merchant's questionnaire becomes SAQ P2PE, which contains only Requirements 3, 9, and 12. Requirements 7, 8, and 10 leave the merchant's scope. This is the highest-value architectural choice available.
3. **The POS handles clear-text account data anywhere.** Umi becomes a service provider, and SAQ D applies in full. All the requirements in section 5.1 bind.

**Action.** Ask the acquirer, in writing, which questionnaire and which validation level apply. Do
this before the POS takes its first card payment, not after.

### 9.2 What Umi should do anyway, before any trigger

Three items cost little now and cost much later:

1. Enumerate the platform permissions. A wildcard is far harder to remove after a year of code depends on it.
2. Add `delegate_user_id` to the audit tables. `merchant.audit_event` is hash-chained, so a late addition is more expensive.
3. Add `outcome` and `request_id` to `umi.audit_log`. PCI DSS 10.2.2 names six fields, and Umi's platform audit table has four.

---

## 10. Recommendations

Each item carries one label:

- **Obligation** — a rule that binds Umi now, or that will bind Umi at a named trigger.
- **Strong industry consensus** — every primary source studied agrees.
- **Judgement call** — the sources support it, but Umi's size makes the timing a choice.

### Immediate — do these before the next platform change

1. **Remove `developer` and `tech_assist` from `ROLE_PRECEDENCE`, or seed them with real permissions in the same change.**
   A name that ranks above `staff` and grants nothing is a defect, not forward compatibility.
   _Judgement call._

2. **Enforce `is_platform` on `umi.user_role` with a composite foreign key.**
   NIST AC-6(5) requires that privileged accounts are restricted to defined roles. A comment does not restrict anything.
   _Strong industry consensus._

3. **Add `expires_at`, `revoked_at`, `revoked_reason`, `justification`, and `approved_by` to `umi.user_role`. Add the expiry predicate to `SUPER_ADMIN_SA_CTE`.**
   NIST AC-2(2) requires automatic expiry of emergency accounts. PostgreSQL will not enforce the expiry, so the query must.
   _Strong industry consensus._

4. **Write a `umi.audit_log` row for every platform grant and every revocation.**
   The `action` CHECK already admits `'grant'` and `'revoke'`. Nothing writes them.
   _Obligation once PCI applies (10.2.1.5). Strong industry consensus now._

### Near term — before the POS takes a card payment

5. **Replace `['*']` with an enumerated platform permission set. Keep one wildcard path, gated by an active grant.**
   Kubernetes states the reason: a wildcard automatically grants access to resources and verbs that do not exist yet. Umi already saw this happen with eight POS permission keys.
   _Strong industry consensus._

6. **Add MFA for every holder of a platform grant.**
   PCI DSS 8.4.1 requires it for administrative access into the cardholder data environment. OWASP ASVS 4.3.1 requires it for administrative interfaces at every level.
   _Obligation once PCI applies. Strong industry consensus now._

7. **Add `delegate_user_id` to `merchant.audit_log` and `merchant.audit_event`.**
   Do this before any "log in as" feature. Salesforce keeps both identities. Zendesk keeps one, and its documentation admits that impersonated actions appear as the assumed user.
   _Strong industry consensus._

8. **Add `outcome` and `request_id` to `umi.audit_log` and `merchant.audit_log`.**
   PCI DSS 10.2.2 names six fields. These two tables carry four.
   _Obligation once PCI applies. Judgement call now._

9. **Parameterise the bootstrap email in `seed_rbac.sql`, and add a written retirement step.**
   Vault, Keycloak, GitLab, and AWS all document how to retire the bootstrap credential. Umi documents none.
   _Strong industry consensus._

10. **Ask the acquirer in writing which questionnaire and validation level apply to UmiPOS.**
    PCI SSC does not enforce the standard. The acquirer does. Section 9.1 lists the three possible outcomes.
    _Obligation, at the point of the contract._

### Later — when support work grows past the founders

11. **Add `umi.access_grant` in the sealed schema. Do not extend `runtime.elevation_grant`.**
    The mechanism fits. The placement does not: `runtime.elevation_grant` is granted to `api`, requires a merchant, and requires a merchant-bound session. A platform grant that the request path can write is not a control.
    _Judgement call._

12. **Add a read-only `support` platform role.**
    Most support work is reading. Google states that a recurring break-glass need signals a missing normal API.
    _Judgement call._

13. **Add `merchant.support_access_grant`: merchant-approved, time-boxed, revocable, and notified.**
    Four of five vendors studied require consent, and four of five time-box it. Salesforce is the model. Keep an emergency path that skips approval and keeps the justification.
    _Judgement call now. Obligation if PCI DSS 8.2.3 ever applies._

14. **Review every platform grant on a fixed cadence, and remove unused breadth.**
    PCI DSS 7.2.5.1 requires a periodic review with management acknowledgement. NIST AC-6(7) requires the same. AWS recommends a monthly or quarterly review of management-account access.
    _Obligation once PCI applies. Strong industry consensus now._

15. **Test the break-glass path on a schedule, and review its use with a second person.**
    Google requires both: the mechanism "should be tested regularly", and a peer review catches a coworker who "repeatedly uses a breakglass action to access an unusual resource".
    _Strong industry consensus._

---

## 11. Decision basis

**Documented fact:** No primary source defends a standing, unbounded wildcard grant. Kubernetes, AWS,
and PostgreSQL all ship one and all document limits on it.

**Documented fact:** Every studied system creates the first administrator out of band, and documents a
manual retirement step. Umi's SQL seed matches the pattern, and lacks the retirement step.

**Documented fact:** Salesforce is the only studied vendor that stores the acting person separately
from the impersonated person. Zendesk documents the opposite behaviour as a known property.

**Documented fact:** PCI DSS binds through an acquirer contract, not through law. PCI SSC states that
enforcement belongs to the payment brands and acquirers.

**Source-backed tradeoff:** An enumerated permission set costs a seed change for every new permission
key. A wildcard costs nothing until a permission key appears that nobody meant to grant.

**Source-backed tradeoff:** Merchant consent for support access adds friction to every support call.
Consent without an emergency path will be bypassed during the first outage.

**Umi-specific inference:** Umi already implements time-boxed, approved, expiring grants — for café
staff, in `merchant.staff_permission_override`, and for till operators, in `runtime.elevation_grant`.
The platform layer is the only layer that grants forever. The correct fix applies Umi's own pattern to
Umi's own operators.
