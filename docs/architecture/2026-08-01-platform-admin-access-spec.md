# Platform administrator access — specification and implementation plan

**Date:** 2026-08-01
**Status:** Specification and phased plan. Not applied. No DDL and no code changed yet.
**Scope:** Platform-level administrator accounts, developer access, break-glass, and support access to merchant data
**Companion:** [`docs/reports/2026-08-01-platform-admin-and-support-access.md`](../reports/2026-08-01-platform-admin-and-support-access.md) holds the vendor and compliance evidence
**Decision owner:** Umi product and engineering owners
**Confidence:** High on the engineering evidence. Medium on the sizing of the review controls, for the reason in section 1.4.

---

## 0. How to read this document

### 0.1 Requirement keywords

> "The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT",
> "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as
> described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown
> here."

([RFC 2119](https://www.rfc-editor.org/rfc/rfc2119.txt), [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174.txt))

### 0.2 The shape of each specification

Each specification has eight parts:

1. **Label** — obligation, strong industry consensus, or judgement call.
2. **Problem** — the defect, with evidence from this repository.
3. **Evidence** — engineering literature first, then vendor documentation.
4. **Specification** — numbered normative statements.
5. **Change surface** — the files that change.
6. **Acceptance criteria** — testable results.
7. **Verification** — the command that proves the result.
8. **Adversarial review** — the strongest objection, the cost, the answer, and when to reject the specification.

### 0.3 One planning fact that sets every cost

build-v3 has **not** cut over to production. Phase P7 is pending
([`GATED_CUTOVER_PLAN.md`](../migration/build-v3/GATED_CUTOVER_PLAN.md)). The spine is DDL-first, so
the schema files themselves are the change surface. A column added today costs one line in
`10_umi.sql`. The same column after cutover costs a migration, a backfill, and — for
`merchant.audit_event` — a rewrite of a hash chain.

This asymmetry is the reason to act now, and it is the answer to most "why not later" objections.

---

## 1. What the engineering evidence changed

This plan is not the companion report restated. Six findings from the engineering literature changed
the recommendations. Read this section before the specifications.

### 1.1 Scope discipline beats review. This reorders everything.

Røstad and Edsberg audited every access log of a hospital record system across eight hospitals, with
16,723 users and 1,794,153 accesses in one month. The deployment ran two override mechanisms at once.
That makes it a natural experiment.

| Mechanism             | Users who held it | Share of all accesses |
| --------------------- | ----------------- | --------------------- |
| Broad "actualization" | 12,298 (74%)      | 297,742 (**17%**)     |
| "Emergency access"    | 41 (**0.25%**)    | 67 (**0.004%**)       |

([Røstad and Edsberg, ACSAC 2006](https://www.acsac.org/2006/papers/77.pdf))

The narrow grant stayed exceptional. The broad grant became routine. Both had the same audit trail.

The authors' conclusion is direct: "We found that the uses of the exception mechanisms were too
frequent and widespread to be considered exceptions." And: "Minimizing risk includes minimizing the
user base that has the potential for exploiting exception mechanisms."

**Effect on this plan.** The controls that narrow _who holds_ the authority rank above the controls
that _watch_ the authority. SPEC-01 to SPEC-05 come first for this reason.

### 1.2 A menu of reasons destroys the justification

The same study measured the reason field. Users chose a predefined reason in 98.24% of invocations.
Only 1.76% wrote a reason. The authors state the result: "The predefined reasons are so broadly
defined that they convey very little information about the user's needs", and the log is therefore
"infeasible to audit ... for misuse".

Google asks for the opposite: a structured reference, "such as a bug number, ticket number, or
customer case number", because "It would be much harder to automate log verification if we relied
upon free-text fields"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).

**Effect on this plan.** The two sources agree once you split the field. SPEC-05 requires a
**machine-checkable reference** and a **free-text reason**, and forbids a menu of canned reasons.

### 1.3 The prompt does more work than the review

In the BTG-RBAC deployment at Hospital S. João, 385 users met the break-glass disclaimer. 208
continued. 177 stopped — 46% abandoned the access at the prompt, before any log entry existed and
before any manager saw anything
([Ferreira et al., ACSAC 2009](https://kar.kent.ac.uk/31989/1/ACSACfinalSubmitted.pdf)).

Povey states the design rule that produces this: "It should not be possible for a user to
accidentally invoke higher privileges, but should require an explicit, conscious decision"
([Povey, NSPW 1999](https://www.nspw.org/papers/1999/nspw1999-povey.pdf)).

**Effect on this plan.** A deliberate-decision prompt is a new control, added as SPEC-05.3. Umi's
`['*']` today is the exact opposite: it is invoked with no decision at all, on every request.

### 1.4 The case for heavy review is weaker than the report implied

Four primary sources push back on "review every privileged event".

- **Povey concedes the cost.** "analysis of the audit trail by a system administrator will be labour intensive – a further motivation for educating users to use the mechanism only in extreme circumstances."
- **Axelsson proves the arithmetic.** With a low base rate of real events, a detector produces mostly false alarms. He states the human consequence: a low true-alarm rate "would quickly 'teach' the SSO to safely ignore all alarms" ([Axelsson, CCS 1999](https://users.ece.cmu.edu/~dbrumley/courses/18487-f15/reading/Axelsson_1999_The%20base-rate%20fallacy%20and%20its%20implications%20for%20the%20difficulty%20of%20intrusion%20detection.pdf)).
- **NIST says operators do not do it.** "many administrators consider log analysis to be boring and to provide little benefit for the amount of time required" ([NIST SP 800-92](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-92.pdf)).
- **Verizon says the threat is small and falls.** Privilege Misuse is "just under 4% of breaches", down from about 8%; internal actors fell from 18% to 12%; and 60% of misuse motives are **Convenience**, not financial gain ([2026 DBIR](https://www.verizon.com/business/resources/T1ae/reports/2026-dbir-data-breach-investigations-report.pdf)). This is vendor-published primary research, and it is counter-evidence to my own recommendation.

**Effect on this plan.** SPEC-13 and SPEC-14 are sized down. Review becomes exception-triggered, not
exhaustive. The "Convenience 60%" figure also argues for SPEC-11: make the legitimate read path easy,
and people stop reaching for the wildcard.

### 1.5 The proposed DDL in the companion report is wrong. Corrected here.

The report proposed a `GENERATED ALWAYS AS (true) STORED` column as the referencing side of a
composite foreign key. Three problems:

1. `ALTER TABLE ... ADD COLUMN ... STORED` **rewrites the table and all its indexes**: "Adding a column with a volatile DEFAULT ..., a stored generated column, an identity column, or a column with a domain data type that has constraints will cause the entire table and its indexes to be rewritten" ([ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)).
2. PostgreSQL 18 makes generated columns **VIRTUAL by default**, and "foreign key constraints on virtual generated columns are not supported". The `STORED` keyword becomes mandatory.
3. A foreign key on a stored generated column works on PostgreSQL 15 to 18, but **the documentation never says so**. The restriction list at [Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html) does not mention foreign keys. The behaviour is only visible in `tablecmds.c`.

**Corrected form**, used in SPEC-02: a plain column with a `CHECK`. It gives the same guarantee, it is
documented, and a nullable-or-defaulted plain column needs no rewrite on PostgreSQL 11 and later.

### 1.6 A hash chain does not stop truncation

`merchant.audit_event` is hash-chained. Schneier and Kelsey define exactly what that buys:

> "He can delete a block of entries (or the entire log [file]), but he cannot create new entries,
> either past entries to replace them or future entries. The next time U interacts with T, T will
> realize that entries have been deleted"

([Schneier and Kelsey, USENIX Security 1998](https://www.usenix.org/legacy/publications/library/proceedings/sec98/full_papers/schneier/schneier.pdf))

The detection depends on an external party `T`. Umi has no `T`. The chain detects **edits**, and it
detects **deletions only against an off-box anchor**.

Anderson states the same rule for administrators: "the system administrator can do anything, so we
have difficulty implementing an audit trail as a file that they cannot modify ... The traditional,
and still the most common, way to protect logs against root compromise is to keep them separate"
([Security Engineering 3rd ed., Ch. 6](https://www.cl.cam.ac.uk/archive/rja14/Papers/SEv3-ch06.pdf)).

**Effect on this plan.** SPEC-08 is new. It exports the chain head off the database.

---

## 2. Design principles

Seven principles carry the specifications. Each has a primary engineering source.

**P1 — Remove ambient authority.**
Ambient authority is "authority that is exercised, but not selected, by its user"
([Miller, Yee, Shapiro 2003](https://papers.agoric.com/assets/pdf/papers/capability-myths-demolished.pdf)).
Umi's `['*']` is ambient by construction. Nothing selects it, and every request carries it.

**P2 — Narrow the holder set before you build the watchtower.**
See section 1.1.

**P3 — Make the exceptional path an explicit decision.**
See section 1.3.

**P4 — Time-box the grant.**
ANSI INCITS 359-2004 names the property: dynamic separation of duty "ensure[s] that permissions do
not persist beyond the time that they are required for performance of duty. This aspect of least
privilege is often referred to as **timely revocation of trust**"
([ANSI INCITS 359-2004](https://profsandhu.com/journals/tissec/ANSI+INCITS+359-2004.pdf)).

**P5 — For the exceptional path, prefer attribution over prevention.**
Povey's optimistic security requires four supports: strong authentication, a detailed log, a reason,
and the ability to compensate. "The basic approach of an optimistic security system is to assume that
any access is legitimate and should be granted"
([Povey, NSPW 1999](https://www.nspw.org/papers/1999/nspw1999-povey.pdf)).
Note his own scope limit: optimistic security "is not suited to financial or trading systems where
the risk of fraud is high". A POS is such a system. Section 4.3 records what this excludes.

**P6 — Automate credential expiry. Never put the expiry burden on human memory.**
NIST hardened its rule between revisions. Revision 4 states: "Verifiers and CSPs SHALL NOT require
subscribers to change passwords periodically"
([SP 800-63B rev 4](https://pages.nist.gov/800-63-4/sp800-63b.html)).
Machine credentials went the other way. The CA/Browser Forum mandates a fall from 398 days to 47 days
between 2026 and 2029
([Baseline Requirements §6.3.2](https://cabforum.org/working-groups/server/baseline-requirements/requirements/)).
The variable is who pays the rotation cost. Automated rotation is good. Human rotation is not.

**P7 — Keep the audit trail outside the reach of the role it audits.**
See section 1.6. Umi already applies this: `runtime.security_audit_event` is `INSERT`-only for `api`,
and `umi.audit_log` is ungranted to `api` ([`90_rls.sql`](../migration/build-v3/90_rls.sql)).

---

## 3. The specifications

### Phase A — Narrow the authority (pre-cutover, low cost)

---

## SPEC-01 · Resolve the parked roles

**Label:** judgement call

**Problem.** `ROLE_PRECEDENCE` contains `developer` and `tech_assist`. Neither has a `umi.role` row.
`normalizeRoleKey` returns the highest-precedence entry, and both entries rank above `staff`. A holder
would therefore outrank a barista and hold zero permissions, because no `umi.role_permission` row
exists. The name promises authority. The catalog delivers none.

**Evidence.** Sandhu and colleagues define a role as a member of a fixed set `R` with a
permission-assignment relation `PA ⊆ P × R`
([Sandhu et al., IEEE Computer 1996](https://csrc.nist.gov/CSRC/media/Projects/Role-Based-Access-Control/documents/sandhu96.pdf)).
A name with no `PA` edge is not a role. ANSI INCITS 359-2004 agrees: a role is "a job function within
the context of an organization with some associated semantics regarding the authority and
responsibility conferred".

**Specification.**

1. The system MUST NOT list a role key in `ROLE_PRECEDENCE` unless a `umi.role` row holds that key.
2. The team MUST choose one option:
   - Option A: delete both keys from `ROLE_PRECEDENCE`.
   - Option B: seed both keys as `is_platform` roles, with an explicit permission set, in the same change.
3. Option A is RECOMMENDED. SPEC-11 defines the real support role.

**Change surface.** `apps/umi-api/src/modules/auth/roles.ts`.
Option B also touches `docs/migration/build-v3/backfill/seed_rbac.sql`.

**Acceptance criteria.**

- `ROLE_PRECEDENCE` and the seeded `umi.role` key set are equal.
- A unit test asserts the equality, and fails when either side changes alone.

**Verification.** `pnpm --filter umi-api test`.

**Adversarial review.**

- _Objection._ The code comment calls the keys "forward-compat", so removal costs future work.
- _Cost of the objection._ Re-adding a string is a one-line change. The comment already admits the promotion is "a pure seed change with zero code churn", which is equally true after removal.
- _What actually breaks._ Nothing today. No row holds either key.
- _Answer._ The hazard is asymmetric. An inert string costs nothing to restore, and it costs a silent privilege mismatch if anyone ever seeds it without reading the precedence list.
- _Reject this specification if_ the team seeds both roles inside the next two weeks. Then Option B is simply the same work, done once.

---

## SPEC-02 · Constrain `umi.user_role` to platform roles

**Label:** strong industry consensus

**Problem.** The DDL comment states the rule and declines to enforce it: "NOT enforceable as a CHECK
(it needs a lookup): role_id must name a role with is_platform = true"
([`10_umi.sql:108`](../migration/build-v3/10_umi.sql)). A merchant role inserted here would be
accepted, and it would grant nothing, silently.

**Evidence.** NIST AC-6(5) requires that the system "Restrict privileged accounts on the system to
[personnel or roles]"
([SP 800-53 Rev 5](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-53r5.pdf)).
Sandhu and colleagues make the general case for constraints: "Constraints are a powerful mechanism
for laying out higher-level organizational policy. Once certain roles are declared to be mutually
exclusive, there need not be so much concern about the assignment of individual users to roles."

A comment is not a constraint. PostgreSQL supports the constraint directly.

**Specification.**

1. `umi.role` MUST carry a unique constraint on `(id, is_platform)`.
2. `umi.user_role` MUST carry a composite foreign key on `(role_id, is_platform)`.
3. The referencing column MUST be a plain column with a `CHECK`, not a generated column. See section 1.5.
4. The foreign key MUST use `NO ACTION` or `RESTRICT` referential actions.

**Change surface.** `docs/migration/build-v3/10_umi.sql`.

```sql
alter table umi.role
  add constraint role_id_platform_uq unique (id, is_platform);

alter table umi.user_role
  add column is_platform boolean not null default true,
  add constraint user_role_is_platform_ck check (is_platform),
  add constraint user_role_platform_only_fk
    foreign key (role_id, is_platform) references umi.role (id, is_platform);
```

The referenced side must be a full unique constraint. PostgreSQL requires that the referenced columns
"refer to the columns of a non-deferrable unique or primary key constraint or be the columns of a
non-partial unique index" ([CREATE TABLE](https://www.postgresql.org/docs/current/sql-createtable.html)).
A partial unique index cannot serve here.

**Acceptance criteria.**

- An insert of a merchant role into `umi.user_role` fails with a foreign key violation.
- An insert of `super_admin` succeeds.
- `ADD COLUMN` performs no table rewrite.

**Verification.** Add a `security_gate.sql` row:

```sql
('umi.user_role admits platform roles only',
  (select case when exists (
     select 1 from pg_constraint
      where conname = 'user_role_platform_only_fk'
        and conrelid = 'umi.user_role'::regclass)
   then 'PASS' else 'FAIL' end)),
```

**Adversarial review.**

- _Objection._ Five cafés and one operator do not need a database constraint. Application code can check it.
- _Cost of the objection._ The constraint costs two DDL lines and one index. The application check costs a code path that every future writer must remember.
- _What actually breaks._ A composite foreign key needs the extra unique constraint, which adds one index to a table with a handful of rows.
- _Answer._ `SECURITY_GATE.md` already records that "RBAC scope not DB-enforced" is an accepted residual, and it accepted that residual because a per-row policy function costs planner time. This constraint costs no planner time on the request path, because `api` never reads the table.
- _Reject this specification if_ the team decides that `umi.user_role` will hold merchant-scoped grants again. Then the invariant is false, and the constraint is wrong.

---

## SPEC-03 · Give `umi.user_role` a lifecycle

**Label:** strong industry consensus

**Problem.** The table holds `user_id`, `role_id`, `granted_by`, `created_at`. It grants forever.
`SECURITY_GATE.md` already records the gap: "A grant cannot be revoked, only deleted ... it leaves no
audit trail of _why_ access ended and no 'suspended' state."

**Evidence.**

- ANSI INCITS 359-2004 names the property as "timely revocation of trust". See P4.
- NIST AC-2(2) requires the system to "Automatically [remove/disable] temporary and emergency accounts after [time period]", and states the reason: removal happens "automatically after a predefined time period rather than at the convenience of the system administrator".
- NIST AC-2(7)(d) requires "Revoke access when privileged role or attribute assignments are no longer appropriate".
- Google Cloud Privileged Access Manager caps a grant at seven days, with a supported range "between 30 minutes (1800s) and 168 hours (604800s)" ([PAM entitlements](https://docs.cloud.google.com/iam/docs/pam-create-entitlements)).
- Umi already implements this pattern one layer down. `merchant.staff_permission_override` carries `expires_at` and `granted_by` ([`20_merchant.sql:319`](../migration/build-v3/20_merchant.sql)).

**Specification.**

1. `umi.user_role` MUST carry `expires_at`, `revoked_at`, `revoked_reason`, `justification`, and `approved_by`.
2. A grant that resolves to the wildcard MUST carry a non-null `expires_at`.
3. `expires_at` SHOULD NOT exceed 7 days for a wildcard grant.
4. `SUPER_ADMIN_SA_CTE` MUST exclude an expired grant and a revoked grant.
5. `revoked_at` and `revoked_reason` MUST be set together.
6. The system MUST NOT reuse a row after revocation. A new grant is a new row.

**Change surface.** `docs/migration/build-v3/10_umi.sql`,
`apps/umi-api/src/modules/auth/rbac.sql.ts`.

```sql
alter table umi.user_role
  add column expires_at     timestamptz,
  add column revoked_at     timestamptz,
  add column revoked_reason text,
  add column justification  text,
  add column approved_by    uuid references umi.user(id),
  add constraint user_role_revocation_ck
    check ((revoked_at is null) = (revoked_reason is null));
```

The `CHECK` form matters. PostgreSQL states that "a check constraint is satisfied if the check
expression evaluates to true **or the null value**"
([Constraints](https://www.postgresql.org/docs/current/ddl-constraints.html)). The naive form
`check (revoked_at is not null and revoked_reason is not null)` evaluates to NULL on a live row and
passes silently. The `IS NULL` equality form always returns true or false, so it binds on every row.

The query predicate is the part that carries the enforcement:

```sql
sa AS (
  SELECT EXISTS (
    SELECT 1 FROM umi.user_role AS ur
    JOIN umi.role AS r ON r.id = ur.role_id
    WHERE ur.user_id = $1::uuid
      AND r.key = 'super_admin'
      AND ur.revoked_at IS NULL
      AND (ur.expires_at IS NULL OR ur.expires_at > now())
  ) AS is_sa
)
```

PostgreSQL will not enforce the expiry for us. `VALID UNTIL` "sets a date and time after which **the
role's password** is no longer valid"
([CREATE ROLE](https://www.postgresql.org/docs/current/sql-createrole.html)). It expires a password,
not a role, and it cannot express a per-grant expiry at all.

**Acceptance criteria.**

- An expired grant yields `is_sa = false`.
- A revoked grant yields `is_sa = false`.
- A revocation without a reason fails.
- Adding the five columns performs no table rewrite. All five are nullable with no default.

**Verification.** An integration test against a local build-v3 database, plus
`pnpm --filter umi-api test`.

**Adversarial review.**

- _Objection._ NIST forbids periodic credential rotation. This specification adds periodic rotation.
- _Cost of the objection._ If wrong, the founder re-requests a grant every week, forever.
- _Answer._ The two cases differ on who pays. NIST forbids rotation of "memorized secrets" — a password a human retypes. This specification expires a **grant record**, and the renewal is a database row, not a remembered secret. The direction of travel for non-memorized credentials is the opposite: 398 days to 47 days for TLS certificates, and continuous rotation for SPIFFE identities, where lifetime limits exist "for the purpose of mitigating the likelihood of a key compromise and the damage associated with it" ([SPIFFE-ID.md](https://github.com/spiffe/spiffe/blob/main/standards/SPIFFE-ID.md)).
- _What actually breaks._ A forgotten renewal locks the only operator out of the platform. Microsoft documents this exact failure and its fix: "Avoid this situation by configuring emergency access accounts" ([Entra PIM](https://learn.microsoft.com/en-us/entra/id-governance/privileged-identity-management/pim-how-to-change-default-settings)).
- _Mandatory companion._ Do not ship SPEC-03 without SPEC-10. The bootstrap seed is the lockout recovery path.
- _Reject this specification if_ SPEC-10 does not ship with it.

---

## SPEC-04 · Enumerate the platform permissions, and retire the ambient wildcard

**Label:** strong industry consensus

**Problem.** `effectivePermissions` returns `['*']` for `super_admin`
([`roles.ts:37`](../../apps/umi-api/src/modules/auth/roles.ts)). The wildcard is ambient: no request
selects it, and it covers permission keys that did not exist when it was written. `10_umi.sql` added
eight POS permission keys in July 2026. All eight reached `super_admin` with no review.

**Evidence.**

- **The theory.** Harrison, Ruzzo and Ullman proved that the safety question — will this configuration ever leak a right? — is undecidable in general: "It is undecidable whether a given configuration of a given protection system is safe for a given generic right" ([HRU, CACM 1976](https://dl.acm.org/doi/10.1145/360303.360333)). You cannot compute what an open-ended grant will permit. Enumeration replaces the undecidable question with a list.
- **The practice.** Kubernetes states the same result operationally: "if a new resource type is added, or a new subresource is added, or a new custom verb is checked, the wildcard entry automatically grants access, which may be undesirable" ([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)).
- **The failure mode.** Anderson names why teams reach for the wildcard: "Programmers are often lazy or facing tight deadlines; so they just make the application suid root, so it can do anything. This practice leads to some shocking security holes" ([Security Engineering 3rd ed., Ch. 6](https://www.cl.cam.ac.uk/archive/rja14/Papers/SEv3-ch06.pdf)).
- **The rate argument for roles.** Ferraiolo and Kuhn explain why the permission set belongs to the role and not to the person: "Once the transactions of a Role are established within a system, these transactions tend to remain relatively constant or change slowly over time" ([Ferraiolo and Kuhn, 1992](https://csrc.nist.gov/CSRC/media/Projects/Role-Based-Access-Control/documents/ferraiolo-kuhn-92.pdf)).

**Specification.**

1. `umi.role_permission` MUST hold explicit rows for `super_admin`.
2. `effectivePermissions` MUST NOT return `['*']` from a role key alone.
3. `hasPermission` MUST keep the `'*'` branch. It is the single break-glass path, and SPEC-05 supplies the only caller.
4. A new `umi.permission` key MUST NOT reach `super_admin` without a seed change.
5. A seed change that adds a permission to `super_admin` SHOULD name the reason in a comment.

**Change surface.** `apps/umi-api/src/modules/auth/roles.ts`,
`docs/migration/build-v3/backfill/seed_rbac.sql`.

**Acceptance criteria.**

- `effectivePermissions('super_admin', [...])` returns the catalog set, not `['*']`.
- A test adds a new permission key and asserts that `super_admin` does **not** gain it.
- Every route that a `super_admin` uses today still resolves. This needs a route inventory before the change.

**Verification.** `pnpm --filter umi-api test`, plus a manual pass over the dashboard as the platform
operator.

**Adversarial review.**

- _Objection — the strongest one in this document._ Enumeration produces role explosion. NIST names it: "Trying to implement these kinds of access control decisions would require the creation of numerous roles that are ad hoc and limited in membership, leading to what is often termed 'role explosion'" ([SP 800-162](https://nvlpubs.nist.gov/nistpubs/specialpublications/NIST.sp.800-162.pdf)). Kuhn, Coyne and Weil put a bound on it: "attempting to implement the same controls in RBAC could, in a worst case, require 2ⁿ roles" ([IEEE Computer 2010](https://csrc.nist.gov/files/pubs/journal/2010/06/adding-attributes-to-rolebased-access-control/final/docs/kuhn-coyne-weil-10.pdf)).
- _Cost of the objection._ Every future permission key needs a deliberate seed edit. That is real, recurring work.
- _Answer._ The bound applies to **attribute** combinations, not to a fixed permission catalog. Umi has 12 permission keys and 5 roles. The explosion argument bites when access depends on time, place, or training. It does not bite on a list of 12. NIST also declines to endorse the alternative: "ABAC is not the right solution for every access control problem", and its cost "may exceed its benefits in the long term".
- _Second objection._ Saltzer and Schroeder list psychological acceptability as a co-equal principle, and warn that the eight principles "do not represent absolute rules—they serve best as warnings" ([MIT copy](https://web.mit.edu/Saltzer/www/publications/protection/Basic.html)). An operator who cannot do their job will find a way around the control.
- _Answer._ SPEC-05 keeps a working escape path, and SPEC-11 makes the common read case easy without any escape. Google concedes the same balance: "a more relaxed approach in other areas can provide tangible benefits", with broad **read** access as its example.
- _Reject this specification if_ the route inventory shows that `super_admin` genuinely needs every permission key. Then the honest change is to enumerate them all once, and to keep the enumeration, so that the **next** key is a decision.

---

## SPEC-05 · A break-glass path with a deliberate decision

**Label:** strong industry consensus

**Problem.** After SPEC-04, a platform operator holds a bounded set. Some emergencies need more.
Today the only mechanism is a standing wildcard. `runtime.elevation_grant` exists in DDL, and no code
reads or writes it ([`30_runtime.sql:432`](../migration/build-v3/30_runtime.sql)).

**Evidence.**

- Google defines break-glass as a full bypass, restricted to a small team, closely monitored, and regularly tested ([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).
- Povey supplies the requirement list: constrained entry points, accountability, auditability, recoverability, deterrents ([NSPW 1999](https://www.nspw.org/papers/1999/nspw1999-povey.pdf)).
- Ferreira and colleagues supply the interaction model: "the system is frozen until the user agrees or not with breaking the glass, and chooses a reason for doing it", and the obligations reset the state, for example "set BTGi to FALSE after 30 minutes or ... after 3 BTG accesses" ([ACSAC 2009](https://kar.kent.ac.uk/31989/1/ACSACfinalSubmitted.pdf)).
- The prompt is measurably effective. See section 1.3.

**Specification.**

1. The system MUST hold platform elevation records in a new table `umi.access_grant`, inside the sealed `umi` schema.
2. The system MUST NOT extend `runtime.elevation_grant` for platform access. See the adversarial review.
3. An elevation request MUST capture a machine-checkable `reference` and a free-text `justification`.
4. The system MUST NOT offer a menu of predefined reasons. See section 1.2.
5. The user interface MUST present an explicit confirmation before elevation, and MUST record the abandonment as well as the acceptance.
6. An elevation grant MUST carry `expires_at`. It SHOULD NOT exceed 60 minutes.
7. `effectivePermissions` MUST return `['*']` only when an unexpired, unconsumed `umi.access_grant` row matches the request.
8. `umi.access_grant` MUST be granted to `worker` only. `api` and `readonly` MUST hold no privilege on it.

**Change surface.** `docs/migration/build-v3/10_umi.sql`,
`docs/migration/build-v3/90_rls.sql`, `docs/migration/build-v3/security_gate.sql`,
`apps/umi-api/src/modules/auth/*`.

```sql
create table umi.access_grant (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references umi.user(id) on delete cascade,
  permission_key text not null,          -- '*' for a full bypass
  merchant_id    uuid,                   -- null = platform-wide
  method         text not null check (method in ('platform_approval','break_glass')),
  reference      text not null,          -- machine-checkable: ticket or case id
  justification  text not null,          -- free text, never a menu
  approved_by    uuid references umi.user(id),
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
```

**Acceptance criteria.**

- Without a grant, a platform operator holds the enumerated set only.
- With a live grant, `hasPermission` passes any key.
- An expired grant grants nothing.
- `has_table_privilege('api', 'umi.access_grant', 'SELECT')` is false.
- The confirmation screen writes a `runtime.security_audit_event` row on both outcomes.

**Verification.** Add a `security_gate.sql` row that asserts the seal, in the same style as the
existing `umi.user_role sealed from the request path` check.

**Adversarial review.**

- _Objection._ `runtime.elevation_grant` already exists and already has `permission_key`, `method`, `approved_by`, `expires_at`, and `consumed_at`. A second table duplicates it.
- _Cost of the objection._ One extra table, and two mechanisms that a reader must tell apart.
- _Answer._ Five properties block reuse, and the fifth is decisive.
  1. `merchant_id` is `not null`. A platform action has no merchant.
  2. `session_id` references `runtime.session`, whose `merchant_id` is also `not null`.
  3. `method` admits only `manager_approval` and `operator_pin`.
  4. The RLS policy keys on `merchant_id`. A NULL merchant makes the policy expression NULL, and PostgreSQL states the effect: "if false or null is returned then the row is not visible" for `USING`, while for `WITH CHECK` "if false or null is returned then an error occurs" ([CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html)). The row would be silently unreadable and loudly un-insertable.
  5. `90_rls.sql` grants `select, insert, update on runtime.elevation_grant to api`. A platform elevation record that the request path can write is not a control.
- _Second objection._ Povey's own scope limit says optimistic security "is not suited to financial or trading systems where the risk of fraud is high". Umi will process card payments.
- _Answer._ Correct, and section 4.3 records the limit. Break-glass here covers **support and recovery**, not money movement. A refund and a void keep their own approval path, which is what `runtime.elevation_grant` already models.
- _Third objection._ The 60-minute window is arbitrary.
- _Answer._ It is a judgement inside a sourced range. Google PAM permits 30 minutes to 168 hours. BTG-RBAC used a 30-minute obligation reset. 60 minutes sits between them. Record it as a tunable, not as a finding.
- _Reject this specification if_ the team accepts a nullable `merchant_id` on `runtime.elevation_grant`, moves it out of `api` reach, and adds the third `method`. That is a defensible alternative, and it is a bigger change to a table the POS depends on.

---

### Phase B — Make the trail answer the question (pre-cutover)

---

## SPEC-06 · Complete the audit record, and record the grant

**Label:** obligation once PCI DSS applies. Judgement call now.

**Problem.** PCI DSS 10.2.2 names six fields. `umi.audit_log` carries four. It records no outcome and
no origin. It is the platform-privileged audit table, and it is the weakest of the four audit tables.
`seed_rbac.sql` also writes no audit row for the grant it creates, although the `action` CHECK already
admits `'grant'` and `'revoke'`.

| Field                          | `umi.audit_log` | `merchant.audit_log` | `merchant.audit_event` | `runtime.security_audit_event` |
| ------------------------------ | --------------- | -------------------- | ---------------------- | ------------------------------ |
| User identification            | yes             | yes                  | yes                    | yes                            |
| Type of event                  | yes             | yes                  | yes                    | yes                            |
| Date and time                  | yes             | yes                  | yes                    | yes                            |
| Success and failure indication | **absent**      | **absent**           | `outcome`              | `outcome`                      |
| Origination of event           | **absent**      | **absent**           | partial                | `request_id`                   |
| Affected resource              | yes             | yes                  | yes                    | yes                            |

**Evidence.** PCI DSS 10.2.1.5 requires that logs capture "Elevation of privileges" and "All changes,
additions, or deletions to accounts with administrative access". 10.2.2 lists the six fields
([SAQ D for Service Providers v4.0](https://listings.pcisecuritystandards.org/documents/PCI-DSS-v4-0-SAQ-D-Service-Provider.pdf?agreement=true)).
NIST AC-6(9) requires the system to "Log the execution of privileged functions".

**Specification.**

1. `umi.audit_log` and `merchant.audit_log` MUST carry `outcome` and `request_id`.
2. Every write to `umi.user_role` and `umi.access_grant` MUST produce a `umi.audit_log` row.
3. The grant record MUST name the actor, the subject, the role, and the reason.
4. `seed_rbac.sql` MUST write its own grant record.

**Change surface.** `docs/migration/build-v3/10_umi.sql`,
`docs/migration/build-v3/20_merchant.sql`, `docs/migration/build-v3/backfill/seed_rbac.sql`,
`apps/umi-api/src/modules/auth/*`.

**Acceptance criteria.**

- Every one of the six PCI DSS 10.2.2 fields maps to a column, in all four audit tables.
- A grant and a revoke each produce exactly one `umi.audit_log` row.

**Verification.** An integration test plus a `security_gate.sql` column-presence check.

**Adversarial review.**

- _Objection._ PCI DSS does not bind Umi today, so this is speculative work.
- _Cost of the objection._ Two nullable columns on two tables, and one insert per grant.
- _Answer._ Both tables are append-only by grant, so the addition is additive and needs no rewrite: a nullable column with no default requires no table rewrite ([ALTER TABLE](https://www.postgresql.org/docs/current/sql-altertable.html)). The alternative is a migration on a live audit table after cutover.
- _Honest limit._ An audit field does not make anybody read the record. Section 1.4 is the evidence that they will not. This specification buys **answerability after an incident**, not detection. Do not oversell it.
- _Reject this specification if_ the team decides that `runtime.security_audit_event` is the single platform audit surface, and retires `umi.audit_log`. That is a smaller schema and an acceptable answer.

---

## SPEC-07 · Preserve the acting person before any impersonation feature

**Label:** strong industry consensus

**Problem.** Umi has no impersonation feature today. The moment one ships, the audit trail records one
identity where two acted.

**Evidence.**

- Hardy named the underlying defect. A deputy carries authority from two sources and "has no way to keep them apart"; the compiler "had no way of expressing these intents" ([Hardy, 1988](http://cap-lore.com/CapTheory/ConfusedDeputy.html)). An impersonation feature makes the Umi operator a deputy for the café.
- Salesforce solves it with two columns. `SetupAuditTrail.DelegateUser` is "The Login-As user who executed the action in Setup. If a Login-As user didn't perform the action, this field is blank" ([object reference](https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_setupaudittrail.htm)). `CreatedBy` keeps the impersonated user.
- Zendesk documents the opposite outcome: "any actions you take, such as creating a ticket or adding a comment to a ticket, are done by the user you're logged in as" ([Assuming end-users](https://support.zendesk.com/hc/en-us/articles/4408894200474-Assuming-end-users)).
- PCI DSS 8.2.2 requires the same property for any shared credential: "Every action taken is attributable to an individual user."
- CERT names privileged users as the specific risk: they "can usually conceal their actions by using their privileged access to log in as other users" ([Common Sense Guide, 7th ed., 2022](https://insights.sei.cmu.edu/documents/619/2022_019_001_886876.pdf)).

**Specification.**

1. `merchant.audit_log` and `merchant.audit_event` MUST carry `delegate_user_id uuid references umi.user(id)`.
2. `delegate_user_id` MUST hold the Umi operator when an action runs on behalf of a merchant user.
3. `actor_user_id` MUST keep the identity under which the action ran.
4. The system MUST NOT ship an impersonation feature before this column exists.

**Change surface.** `docs/migration/build-v3/20_merchant.sql`.

**Acceptance criteria.**

- Both tables carry the column.
- A cross-merchant action by a platform operator sets both columns.

**Verification.** A `security_gate.sql` column-presence check on both tables.

**Adversarial review.**

- _Objection._ Umi has no impersonation feature. This column will hold NULL forever.
- _Cost of the objection._ Two nullable columns.
- _Answer._ `merchant.audit_event` is hash-chained. `previous_hash` and `event_hash` are set by trigger ([`20_merchant.sql:1414`](../migration/build-v3/20_merchant.sql)). A column added after the chain grows forces a decision about whether the new column enters the hash, and a rewrite of every prior row if it does. Adding it before the first row is free.
- _Second objection._ Today a `super_admin` writes their own id into `actor_user_id`, which is already better than Zendesk. So the trail is fine.
- _Answer._ True, and that is the argument for keeping the current behaviour explicit rather than accidental. The column makes the invariant nameable and testable.
- _Reject this specification if_ the team commits, in writing, never to ship impersonation. That commitment is worth more than the column.

---

## SPEC-08 · Anchor the audit chain off the database

**Label:** judgement call

**Problem.** `merchant.audit_event` is hash-chained. The chain detects an edit. It does not detect a
truncation. Nothing outside the database holds a copy of the chain head.

**Evidence.**

- Schneier and Kelsey state the exact limit: an attacker "can delete a block of entries (or the entire log [file]), but he cannot create new entries", and detection happens only when the machine "interacts with T", the trusted external party ([USENIX Security 1998](https://www.usenix.org/legacy/publications/library/proceedings/sec98/full_papers/schneier/schneier.pdf)).
- Anderson gives the operational rule: "The traditional, and still the most common, way to protect logs against root compromise is to keep them separate" ([Security Engineering 3rd ed., Ch. 6](https://www.cl.cam.ac.uk/archive/rja14/Papers/SEv3-ch06.pdf)).
- PostgreSQL confirms who can still truncate: a table owner can revoke their own privileges, but "The right to drop an object, or to alter its definition in any way, is not treated as a grantable privilege; it is inherent in the owner" ([GRANT](https://www.postgresql.org/docs/current/sql-grant.html)). Superusers "bypass all permission checks".

**Specification.**

1. A scheduled job MUST export the latest `event_hash` per merchant, with a count and a timestamp.
2. The export target MUST NOT be writable by the database roles `api`, `worker`, or the table owner.
3. A verification job SHOULD compare the stored head against the live chain, and SHOULD raise an alert on a mismatch or on a count that falls.

**Change surface.** A new worker job in `apps/umi-api/src/jobs/`, plus a target store.

**Acceptance criteria.**

- The export runs on a schedule and records a head per merchant.
- A manual deletion of the last audit row produces an alert on the next verification pass.

**Verification.** A manual test on a local build-v3 database.

**Adversarial review.**

- _Objection._ This adds an external dependency and a scheduled job for a five-café system, against an attacker who already owns the database.
- _Cost of the objection._ One job, one store, one alert path, and the operational work to keep them alive.
- _Answer._ The cost is real, and this is the weakest specification in the document. It is a judgement call, and it is placed last in its phase for that reason.
- _Cheaper alternative._ Write the head into the existing deployment artifact store, or mail it. Any destination outside the database satisfies the property. Perfection is not required; separation is.
- _Reject this specification if_ the incident response plan already accepts total database compromise as unrecoverable. Then the chain is documentation, not a control, and it should be labelled as such.

---

### Phase C — Before the POS takes a card payment

---

## SPEC-09 · MFA for platform grant holders

**Label:** obligation once PCI DSS applies. Strong industry consensus now.

**Problem.** `umi.user` holds `password_hash`, `password_salt`, `password_algorithm`. It holds no
second factor. No MFA code exists in `apps/umi-api`. A platform grant is one stolen password from
every café.

**Evidence.**

- PCI DSS 8.4.1: "MFA is implemented for all non-console access into the CDE for personnel with administrative access." 8.5.1 requires that the MFA system "is not susceptible to replay attacks" and uses "At least two different types of authentication factors".
- OWASP ASVS 4.3.1: "Verify that administrative interfaces use appropriate multi-factor authentication to prevent unauthorized use" ([ASVS 4.0 V4](https://raw.githubusercontent.com/OWASP/ASVS/master/4.0/en/0x12-V4-Access-Control.md)).
- NIST SP 800-63B rev 4 defines phishing resistance as the ability to prevent disclosure to an impostor verifier "**without relying on the vigilance of the claimant**", and states that manual-entry authenticators "SHALL NOT be considered phishing-resistant because the manual entry does not bind the authenticator output to the specific session" ([rev 4 §3.2.5](https://pages.nist.gov/800-63-4/sp800-63b.html)).
- WebAuthn provides the binding in the protocol: the authenticator "ensures that all operations are scoped to a particular origin, and cannot be replayed against a different origin, by incorporating the origin in its responses" ([W3C WebAuthn Level 3](https://www.w3.org/TR/webauthn-3/)).

**Specification.**

1. Every holder of a `umi.user_role` grant MUST hold a second authentication factor.
2. The second factor SHOULD be a WebAuthn credential.
3. A TOTP factor MAY serve as a fallback. It is not phishing-resistant, and the specification MUST record that.
4. The system MUST require the second factor before it issues a `umi.access_grant`.
5. The system MUST NOT require a periodic password change. See P6.

**Amendment, 2026-08-01, after the owner chose email codes.**

`email_otp` shipped first. This specification did not authorise it, so the deviation is
recorded here rather than left as a difference between the plan and the code.

- **What shipped.** A six-digit code, mailed through the existing `EmailAdapter`, stored as HMAC-SHA256 under a pepper held outside the database, single-use, and capped at five attempts.
- **Why it does not satisfy item 1 for PCI DSS.** NIST SP 800-63B §5.1.3.1: "Methods that do not prove possession of a specific device, such as voice-over-IP (VOIP) or email, SHALL NOT be used for out-of-band authentication." Email proves possession of nothing. It is a second step, not a second factor, and PCI DSS 8.5.1 requires "At least two different types of authentication factors".
- **Why it shipped anyway.** The state it replaces is a password alone guarding cross-café authority. The improvement is large and immediate, and the enrolment ceremony is zero.
- **What closes the gap.** `totp`. It needs no vendor and no new infrastructure. `umi.user.mfa_method` already admits the value, and `MfaService` is shaped so that adding it touches two methods.
- **Status of item 1.** OPEN until `totp` or WebAuthn ships. `security_gate.sql` asserts that every live platform grant holder has _a_ method; it deliberately does not assert _which_, because that assertion belongs with the acquirer determination in SPEC-15.

**Change surface.** `docs/migration/build-v3/10_umi.sql`, a new auth module in `apps/umi-api`.

**Acceptance criteria.**

- A platform grant holder with no second factor cannot sign in.
- A break-glass request re-checks the second factor.

**Verification.** Integration tests plus a manual pass.

**Adversarial review.**

- _Objection._ This is the largest single item in the plan. It needs a credential store, a registration flow, a recovery flow, and a lockout path. Umi has one platform operator.
- _Cost of the objection._ Weeks, not days. WebAuthn recovery is the hard part, not registration.
- _Answer._ The obligation arrives with the acquirer contract, and it is not negotiable at that point. The work does not shrink by waiting.
- _Staging that reduces the risk._ Ship TOTP first. It satisfies PCI DSS 8.4.1 as a second factor. It does not satisfy phishing resistance, and NIST rev 4 requires AAL2 applications to **offer** a phishing-resistant option. Record the gap, and close it with WebAuthn before the acquirer review.
- _Reject this specification if_ the acquirer determination in SPEC-15 places Umi outside the cardholder data environment **and** the team accepts the ASVS gap in writing.

---

## SPEC-10 · Bootstrap the first administrator, and retire the credential

**Label:** strong industry consensus

**Problem.** `seed_rbac.sql` hardcodes `hola@umiconsulting.co`. The repository was briefly public. The
seed has no retirement step and writes no audit record.

**Evidence.** Every studied system creates the first administrator out of band, and documents a manual
retirement step.

| System     | Bootstrap credential                   | Documented retirement                                  |
| ---------- | -------------------------------------- | ------------------------------------------------------ |
| Vault      | `vault operator init` root token       | "revoked immediately after they are no longer needed"  |
| Keycloak   | `KC_BOOTSTRAP_ADMIN_*`                 | "the account needs to be removed manually"             |
| GitLab     | `/etc/gitlab/initial_root_password`    | The file self-deletes after 24 hours                   |
| Kubernetes | `super-admin.conf` in `system:masters` | "Do not share the `super-admin.conf` file with anyone" |
| PostgreSQL | `initdb` bootstrap superuser           | Create other roles; stop using the superuser           |

Sources: [Vault tokens](https://developer.hashicorp.com/vault/docs/concepts/tokens),
[Keycloak bootstrap admin](https://www.keycloak.org/server/bootstrap-admin-recovery),
[GitLab install](https://docs.gitlab.com/install/package/ubuntu/),
[kubeadm](https://kubernetes.io/docs/setup/production-environment/tools/kubeadm/create-cluster-kubeadm/).

Kubernetes states why an application API cannot do this: "When bootstrapping the first roles and role
bindings, it is necessary for the initial user to grant permissions they do not yet have"
([Kubernetes RBAC](https://kubernetes.io/docs/reference/access-authn-authz/rbac/)).

Vault is the only studied system that needs more than one person to recover: `generate-root`
"generates a new root token by combining a quorum of share holders"
([generate-root](https://developer.hashicorp.com/vault/docs/commands/operator/generate-root)).

**Specification.**

1. The bootstrap grant MUST come from `seed_rbac.sql`, run by an operator with database access.
2. The system MUST NOT expose an API path that creates a platform grant.
3. `seed_rbac.sql` MUST read the address from a variable, and MUST fail when the variable is unset.
4. The bootstrap grant MUST carry an `expires_at`.
5. The file MUST document the retirement procedure as a numbered list.
6. The recovery procedure MUST be written down, and MUST NOT depend on one individual.

**Change surface.** `docs/migration/build-v3/backfill/seed_rbac.sql`.

```sql
\if :{?bootstrap_admin_email}
\else
  \echo 'ERROR: set -v bootstrap_admin_email=... before you run this seed'
  \quit 1
\endif
```

Retirement procedure, to sit in the file header:

1. Run the seed with the bootstrap address.
2. Sign in, and register the second factor.
3. Create the real platform operators.
4. Revoke the bootstrap grant, with a reason.
5. Confirm the `umi.audit_log` record exists.

**Acceptance criteria.**

- The seed refuses to run without the variable.
- The seeded grant carries `expires_at` and a `umi.audit_log` row.
- The retirement procedure is in the file.

**Verification.** Run the seed twice on a local database: once without the variable, once with it.

**Adversarial review.**

- _Objection._ A committed email is not a secret. Anyone can guess `hola@` at a company domain.
- _Answer._ Correct. The address is not the vulnerability. The value is that the seed stops encoding one company's identity, so a second environment does not silently grant the founder's account. AWS makes the same point when it recommends that "No one person should have access to both the email inbox and phone number" ([root user best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/root-user-best-practices.html)).
- _Second objection._ An expiry on the bootstrap grant can lock the only operator out.
- _Answer._ That is why the seed stays runnable. The seed **is** the recovery path, exactly as `gitlab-rake "gitlab:password:reset"` and `kc.sh bootstrap-admin` are. Whoever holds database access holds recovery. Record that fact rather than hide it.
- _Reject this specification if_ the team wants a Vault-style quorum. That is a bigger design, and it is not proportionate to a company of this size today.

---

## SPEC-11 · A read-only support role

**Label:** judgement call

**Problem.** Support work is mostly reading. Today the only platform role is the wildcard. Every
support question therefore uses maximum authority.

**Evidence.**

- Røstad and Edsberg's natural experiment is the direct argument. See section 1.1. Narrow grants stay rare.
- DBIR reports that Convenience is the motive in 60% of privilege-misuse cases ([2026 DBIR](https://www.verizon.com/business/resources/T1ae/reports/2026-dbir-data-breach-investigations-report.pdf)). An easy legitimate path removes the motive.
- Google states the same rule for break-glass: "When breakglass access is required for a specific task, it often signals a need to provide a safer or more secure way to perform that task as part of the normal API" ([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).
- NIST AC-6(2) requires that privileged users "use non-privileged accounts or roles, when accessing nonsecurity functions".

**Specification.**

1. `umi.role` MUST hold a `support` role with `is_platform = true`.
2. The `support` role MUST hold read permissions only.
3. The `support` role MUST NOT hold `merchant.manage`, `checkout.commit`, or `loyalty.operate`.
4. Support work SHOULD use `support`. `super_admin` is for platform administration.

**Change surface.** `docs/migration/build-v3/backfill/seed_rbac.sql`,
`apps/umi-api/src/modules/auth/roles.ts`.

**Acceptance criteria.**

- A `support` holder can read a café's data and cannot write it.
- The role appears in `ROLE_PRECEDENCE` below `admin`.

**Verification.** `pnpm --filter umi-api test`.

**Adversarial review.**

- _Objection._ One company, two people. A second role is bureaucracy.
- _Answer._ The evidence is against this objection, and it is the cleanest result in the literature: the same organisation kept a narrow mechanism at 0.004% of accesses and let a broad one reach 17%. The variable was scope, not headcount.
- _Second objection._ Read access to every café is still a large authority. A support role that reads all customer records is a privacy exposure, not a small grant.
- _Answer._ Valid. SPEC-12 adds merchant consent, and it applies to `support` first. Until then, `support` is narrower than the status quo, which is the wildcard.
- _Reject this specification if_ SPEC-04's route inventory shows that support work needs writes in practice. Then the honest design is a scoped write role, not a read role that everyone bypasses.

---

## SPEC-12 · Merchant-consented support access

**Label:** judgement call now. Obligation if PCI DSS 8.2.3 applies.

**Problem.** A `super_admin` reaches every café by construction. The café learns nothing.

**Evidence.** Four of five studied vendors require consent, and four of five time-box it.

| Vendor     | Consent                   | Time box                         |
| ---------- | ------------------------- | -------------------------------- |
| Salesforce | Required, per user        | 1 day to 1 year, maximum 1 year  |
| Shopify    | Merchant code plus accept | 90 days of inactivity            |
| Atlassian  | "consent control checker" | Statuspage: 7 days plus 24 hours |
| Zendesk    | Opt-in for paid accounts  | 1 day to indefinite              |
| Stripe     | Not documented            | Not documented                   |

Salesforce is explicit: "No one within Salesforce Support may log in to your organization to resolve
issues without this explicit permission and duration for the access", and "No one other than the
individual customer user can change or revoke Login Access on behalf of that user"
([Grant Login Access](https://help.salesforce.com/s/articleView?id=000388857&language=en_US&type=1)).

Statuspage adds the notification: an "Activity log entry is generated", and both the contacting team
member and the account owner receive one
([Statuspage data access grants](https://support.atlassian.com/statuspage/docs/customer-data-access-grants-information/)).

Rissanen and colleagues supply the engineering constraint on who to notify. A review mechanism must be
"Safe: Only legitimate authorities should be notified" and "Unobtrusive: Among the legitimate
authorities, we should notify those who are most likely to understand the override and least likely to
be bothered unnecessarily"
([FAST 2004](https://www.doc.ic.ac.uk/~mjs/publications/override-fast2004.pdf)).

**Specification.**

1. `merchant.support_access_grant` MUST record a merchant approver, an `expires_at`, and a revocation.
2. The café owner MUST be able to revoke the grant at any time.
3. The system MUST notify the café owner when a grant is created.
4. The system MUST keep an emergency path that skips approval and keeps the reason.
5. The emergency path MUST notify the café owner after the event.

**Change surface.** `docs/migration/build-v3/20_merchant.sql`, a new module in `apps/umi-api`.

**Acceptance criteria.**

- Without a grant, `support` reads nothing outside an emergency path.
- The café sees the grant and can revoke it.
- The emergency path produces a notification.

**Verification.** Integration tests.

**Adversarial review.**

- _Objection._ Umi's cafés are small businesses with a direct relationship to the founders. Consent adds friction to every support call, and the café will approve every time without reading.
- _Cost of the objection._ Real. A consent screen that is always approved is theatre, and it delays a fix while a café is down.
- _Answer._ This is why the specification is a judgement call, and why it sits last. Ship step 1 of the ordering below first, which costs nothing and delivers most of the value.
- _Ordering that reduces the risk._
  1. Write the operator's identity into `merchant.audit_log` for every cross-merchant action. Visibility with no friction.
  2. Notify the café owner after the fact.
  3. Require consent up front.
     Steps 1 and 2 are cheap. Step 3 is the one that adds friction, and it can wait for the first café that asks.
- _Reject this specification if_ a contract term makes step 3 unnecessary. Zendesk shows that a documented reservation of rights is an accepted market position.

---

### Phase D — Operate

---

## SPEC-13 · Review access on a cadence, sized honestly

**Label:** obligation once PCI DSS applies. Strong industry consensus now.

**Problem.** No review exists. No cadence is written down.

**Evidence for the control.**

- PCI DSS 7.2.5.1 requires a periodic review of application and system accounts, that "Any inappropriate access is addressed", and that "Management acknowledges that access remains appropriate".
- NIST AC-6(7) requires the team to review privileges "to validate the need for such privileges" and to "Reassign or remove privileges, if necessary".
- AWS recommends "a monthly or quarterly review" of who can reach the management account ([management account best practices](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_best-practices_mgmt-acct.html)).

**Evidence against an exhaustive review.** See section 1.4. Axelsson, NIST SP 800-92, Povey and the
DBIR all argue that a large mandatory review becomes an unread review.

**Specification.**

1. The team MUST review every live `umi.user_role` grant each quarter.
2. The review MUST record the reviewer, the date, and the decision per grant.
3. The team MUST NOT commit to a review of every audit record.
4. The team SHOULD review `umi.access_grant` rows at each occurrence, because SPEC-05 makes them rare.
5. An alert SHOULD fire when the count of `umi.access_grant` rows in 30 days exceeds a threshold. That is the signal that a normal API is missing.

**Change surface.** A written procedure. Optionally a scheduled report.

**Acceptance criteria.**

- The grant list fits on one screen. If it does not, SPEC-04 or SPEC-11 has failed.
- Each quarter produces a dated record.

**Verification.** The record exists.

**Adversarial review.**

- _Objection._ A quarterly review of a table with one row is ceremony.
- _Answer._ It is, today. It is also the artifact an assessor asks for, and its cost scales with the row count, which SPEC-04 and SPEC-11 keep small. If the table stays at one row, the review is one minute.
- _Second objection._ Item 5 sets a threshold with no sourced number.
- _Answer._ Correct, and it is marked SHOULD for that reason. Use the first 90 days to measure the baseline, then set the threshold. Google's rule is qualitative, not numeric: frequent break-glass "signals a need to provide a safer or more secure way to perform that task".
- _Reject this specification if_ the team writes down that it accepts the risk instead. An accepted, dated risk is more honest than a review that nobody performs.

---

## SPEC-14 · Test the break-glass path

**Label:** strong industry consensus

**Problem.** An untested emergency path fails during the emergency.

**Evidence.** Google states it directly: "The breakglass mechanism should be tested regularly by the
team(s) responsible for production services, to make sure it functions when you need it"
([BSRS Ch. 5](https://google.github.io/building-secure-and-reliable-systems/raw/ch05.html)).
Google also asks for peer review, because "a peer is well equipped to notice if a coworker repeatedly
uses a breakglass action to access an unusual resource that they likely don't actually need".

**Specification.**

1. The team MUST exercise the SPEC-05 path each quarter, in a non-production environment.
2. The test MUST cover the lockout case: no live grant, and no reachable approver.
3. A second person SHOULD review each real break-glass use.
4. The team MUST record each test with a date and a result.

**Change surface.** A written procedure, and a test fixture.

**Acceptance criteria.**

- A quarterly record exists.
- The lockout case has a documented, tested recovery.

**Verification.** The record exists, and the recovery works.

**Adversarial review.**

- _Objection._ Peer review needs two people. Umi may have one on call.
- _Answer._ Item 3 is a SHOULD for exactly this reason. Povey's `m of n` and CERT's two-person rule both assume a team. With one person, the honest control is the record plus the SPEC-13 threshold alert, not a fictional second reviewer. CERT states the general risk: "Workforce members can easily circumvent separation of duties if it is enforced by policy rather than by technical controls" ([Common Sense Guide, 7th ed.](https://insights.sei.cmu.edu/documents/619/2022_019_001_886876.pdf)).
- _Reject this specification if_ the team documents the single-operator reality and accepts it. Do not write a two-person policy that one person performs.

---

## SPEC-15 · Determine PCI DSS applicability in writing

**Label:** obligation, at the point of the acquirer contract

**Problem.** Umi's own architecture record leaves the trigger open.
[`2026-07-28-umipos-branch-reconciliation.md`](2026-07-28-umipos-branch-reconciliation.md) §C4 states
that "Does the POS process payments or only record them?" is "**Still open**".

**Evidence.** PCI SSC does not enforce the standard: compliance "is at the discretion of organizations
that manage compliance programs, such as a payment brand, acquirer, or other entity"
([PCI DSS page](https://www.pcisecuritystandards.org/standards/pci-dss/)). The default posture is
in-scope: "the best practice approach is to start with the assumption that everything is in scope
until verified otherwise"
([Scoping and Segmentation guidance](https://listings.pcisecuritystandards.org/documents/Guidance-PCI-DSS-Scoping-and-Segmentation_v1_1.pdf?agreement=true)).

**Specification.**

1. The team MUST ask the acquirer, in writing, which questionnaire and which validation level apply.
2. The team MUST ask before the POS takes its first card payment.
3. The team MUST record the answer in this repository.

Three possible answers, and what each costs:

| Answer                                                            | Consequence                                                                                                           |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The POS records a transaction that a separate terminal processed. | Umi is likely outside the cardholder data environment. Scoping guidance still says to assume in scope until verified. |
| The POS drives a validated PCI-listed P2PE terminal.              | SAQ P2PE applies. It contains only Requirements 3, 9 and 12. Requirements 7, 8 and 10 leave scope.                    |
| The POS handles clear-text account data anywhere.                 | SAQ D applies in full. Every requirement in the companion report binds.                                               |

**Change surface.** A written record.

**Acceptance criteria.** The acquirer's answer exists in writing.

**Adversarial review.**

- _Objection._ Asking invites scrutiny before the product is ready.
- _Answer._ The acquirer decides the answer whether or not Umi asks. Asking early makes P2PE a design choice. Asking late makes it a rebuild. The middle row of the table is worth the whole plan: it removes Requirements 7, 8 and 10 from scope, which is most of this document.
- _Reject this specification if_ the business decision in §6 of the reconciliation document lands on "record only, never process". Then re-ask this at the next payment change.

---

## 4. Sequencing and scope

### 4.1 Order

| Phase | Specs                   | Gate to enter                     |
| ----- | ----------------------- | --------------------------------- |
| A     | SPEC-01, 02, 03, 04, 05 | None. Do these before P7 cutover. |
| B     | SPEC-06, 07, 08         | Phase A merged.                   |
| C     | SPEC-09, 10, 11, 12, 15 | Before the first card payment.    |
| D     | SPEC-13, 14             | After Phase C.                    |

SPEC-10 must ship with SPEC-03. SPEC-05 must ship with SPEC-04. SPEC-07 must ship before any
impersonation feature, whatever phase that lands in.

### 4.2 Cost shape

Phase A and Phase B are DDL edits and small code changes, because the cutover has not happened.
SPEC-09 is the only large item. SPEC-12 is the only item that changes a customer-facing flow.

### 4.3 What this plan deliberately does not do

- **It does not apply optimistic security to money.** Povey excludes "financial or trading systems where the risk of fraud is high". A refund, a void and a discount keep their own approval path in `runtime.elevation_grant`.
- **It does not move to attribute-based access control.** NIST states that "ABAC is not the right solution for every access control problem" and that its cost "may exceed its benefits in the long term". Umi has 12 permission keys.
- **It does not promise static verification of the permission model.** HRU proved the general safety question undecidable, and noted that even decidable cases "are probably too slow to be of practical utility".
- **It does not add periodic password rotation.** NIST rev 4 forbids it.
- **It does not build a quorum recovery path.** Vault's `generate-root` model is correct and disproportionate here.
- **It does not commit to reading every audit record.** Section 1.4 is the reason.

---

## 5. Open questions

1. **The break-glass window.** SPEC-05 proposes 60 minutes. Sourced range: 30 minutes to 168 hours. Needs an owner decision.
2. **The SPEC-13 threshold.** No sourced number exists. Measure for 90 days first.
3. **`umi.audit_log` or `runtime.security_audit_event`.** Two platform audit tables exist. SPEC-06 improves both. A single surface may be the better answer.
4. **Mexican data-protection law.** Not researched. It binds Umi by statute, and none of PCI DSS, SOC 2 or NIST substitutes for it. This is the largest open item in the compliance picture.
5. **The generated-column behaviour.** SPEC-02 avoids it. If a future change needs it, prove it on the target server version first. It is real in `tablecmds.c` and absent from the documentation.

---

## 6. Source quality

### 6.1 Verified primary sources

The engineering claims in sections 1 and 2 come from full texts that were retrieved and quoted
directly: HRU 1976, Lampson 1974, Hardy 1988, Miller/Yee/Shapiro 2003, Ferraiolo and Kuhn 1992,
Sandhu et al. 1996, ANSI INCITS 359-2004, NIST SP 800-162, Kuhn/Coyne/Weil 2010, Zanzibar 2019,
Anderson SEv3 Ch. 6, Povey NSPW 1999, Ferreira et al. CBMS 2006 and ACSAC 2009, Rissanen et al. FAST
2004, Røstad and Edsberg ACSAC 2006, Axelsson CCS 1999, Schneier and Kelsey USENIX 1998, CERT Common
Sense Guide 7th ed. 2022, NIST SP 800-92, NIST SP 800-53 Rev 5, NIST SP 800-63B rev 3 and rev 4, W3C
WebAuthn Level 3, CA/Browser Forum Baseline Requirements, RFC 2119, RFC 8174, RFC 9700, SPIFFE
standards, and the PostgreSQL 18 documentation.

### 6.2 Corrections to earlier claims

- **Least privilege is Saltzer and Schroeder 1975, not Lampson 1974.** The word "privilege" does not appear in Lampson's paper.
- **Break-glass is not in the Google SRE book.** It is in _Building Secure and Reliable Systems_, Chapter 5. The SRE book has zero occurrences of "least privilege".
- **Axelsson: cite CCS 1999, not TISSEC 2000.** The TISSEC version is paywalled. The result is the same.
- **The companion report's composite-FK DDL is wrong.** See section 1.5.

### 6.3 Unverified — do not cite

- **Clark and Wilson 1987.** IEEE paywall, nine mirrors failed. The rules quoted in the literature reach this document only through Povey, who quotes them with attribution.
- **Rumpole (SACMAT 2011, TISSEC 2014).** Abstract only, from a publisher index, not the paper.
- **Coyne and Weil 2013**, and **"Towards Managed Role Explosion" (NSPW 2015).** No reachable full text.
- **The ACM alert-fatigue survey (CSUR 2025).** Paywalled. The circulating "40%/62%/67% of alerts ignored" figures trace to vendor blogs with no reachable primary source. They are not used here.
- **AICPA Trust Services Criteria CC6.** The companion report's CC6 text comes from a third-party mirror of the March 2020 edition, not from AICPA.
- **PCI DSS v4.0.1 standard PDF.** Gated. The requirement text comes from SAQ D for Service Providers v4.0, which reproduces it.
