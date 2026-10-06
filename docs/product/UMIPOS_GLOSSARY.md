# UmiPOS Canonical Glossary

Updated: 2026-08-13

Use one term for each concept. Historical aliases are explanatory only.

| Term                 | Meaning                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| UMI                  | The platform that owns identity, merchant authority, business commands, PostgreSQL facts, and shared contracts.    |
| UmiPOS               | The UMI application for point-of-sale operations. Flutter owns the device presentation and local safe state.       |
| Organization         | The platform identity boundary that can contain a merchant business. Do not use it as a substitute for a location. |
| Merchant or business | The commercial authority boundary for catalog, sales, customers, inventory, and stored value.                      |
| Tenant               | The isolation concept used by platform security and RLS. Normal operator UI uses business language.                |
| Location             | One physical or operational site inside a merchant. Location scope limits data and actions.                        |
| Membership           | The link between a user, merchant, role, status, and assigned locations.                                           |
| Owner                | The highest merchant role. Last-Owner protection prevents loss of merchant control.                                |
| Manager              | A role with approved operational authority inside assigned scope. It is not a platform administrator.              |
| Cashier              | A POS operator with sale and cash permissions for an assigned context. `Staff` remains a compatibility profile.    |
| Viewer               | A read-only merchant role.                                                                                         |
| Device               | An enrolled client identity with trust, status, credentials, and merchant or location scope.                       |
| Register             | The configured point of sale that owns device, location, hardware, and cash-shift association.                     |
| Shift                | One operational cash-custody period on a register. A shift is not register configuration.                          |
| Sale                 | An immutable committed business transaction. An editable cart is not a sale.                                       |
| Tender               | One allocated payment fact, such as cash, manual terminal, wallet, or gift card.                                   |
| Manual terminal      | An operator assertion that an external terminal completed payment. UmiPOS does not claim provider authorization.   |
| Refund               | A separate immutable compensation fact. It never rewrites the original sale.                                       |
| Void                 | A narrow server-authorized exception inside the configured policy.                                                 |
| Receipt              | An immutable transaction representation. Printing and COPY jobs do not create a new sale.                          |
| Customer             | A merchant-scoped profile with privacy-safe contacts, consent, and transaction history.                            |
| Loyalty              | The points and reward domain. Ledgers contain facts; policy defines future behavior.                               |
| Wallet               | Merchant, customer, and currency scoped stored value with an immutable ledger.                                     |
| Gift card            | Merchant stored value found through a protected secret. Normal views use a masked identity.                        |
| Inventory ledger     | The immutable sequence of stock facts. It is the source for inventory reconstruction.                              |
| Projection           | A reproducible current view calculated from authoritative facts. It is not an independent authority.               |
| On hand              | Stock physically attributed to the location before availability restrictions.                                      |
| Reserved             | Stock held for a sale that has not completed or released.                                                          |
| Available            | Stock allowed for new sale allocation after reservations and blocked states.                                       |
| Committed            | Stock consumed by an authoritative sale effect.                                                                    |
| Quarantine           | Stock that exists but cannot be sold until an authorized release.                                                  |
| Waste or damage      | Explicit stock states recorded through immutable operational facts.                                                |
| KDS                  | The Kitchen Display System. It reads backend-owned kitchen work and has no financial authority.                    |
| Outbox               | Durable pending delivery written with a business transaction. A worker relays it with stable identity.             |
| Reconciliation       | A comparison between authoritative facts and their expected projection or total.                                   |
| Recovery Center      | The operational view for uncertain or failed commands with only safe actions.                                      |
| Correlation ID       | A safe support reference that links one operation across services and logs. It is not a credential.                |
| Release candidate    | A frozen build identity with source, artifacts, schema, configuration, and evidence.                               |
| Pilot                | A controlled deployment with bounded scope, support, evidence, and stop conditions.                                |
| Provider             | An external service that UMI does not control, such as a payment or storage provider.                              |
| Object storage       | Optional provider storage for files or media. RC2 does not require it.                                             |
| RLS                  | PostgreSQL row-level security. It enforces tenant and merchant access inside the database.                         |
| NEXO                 | A historical source project. It has no UmiPOS runtime dependency.                                                  |
