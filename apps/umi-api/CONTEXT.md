# Umi API Cash Context

This context defines the Cash terms that the canonical backend owns.

## Cash web compatibility

Cash preserves its public, business admin, and internal UMI admin interfaces.
The API owns their data access on the canonical schemas.
`CashPublicController` exposes an explicit public projection.
`CashPlatformController` requires canonical authentication and the `super_admin` role.
Business interfaces retain their canonical merchant permissions.
Provider tools live in `scripts/`. Cash holds no provider keys or database credentials.

## Language

**Gift Card**:
A one-use bearer value that one merchant issues. The bearer supplies the clear code; the database stores only its hash.
_Avoid_: Voucher, coupon

**Gift Card Ledger**:
The append-only record of each change to a Gift Card value. The remaining value is the sum of its entries.
_Avoid_: Balance table, transaction history

**Gift Card Redemption**:
The final transfer of a Gift Card value to one Loyalty Card.
_Avoid_: Claim, cash-out

**Loyalty Card**:
The customer record that receives loyalty stamps, rewards, and stored value for one merchant.
_Avoid_: Gift Card, account

## Isolated wallet tests

The staging API uses `WALLET_MODE=test`; the worker retains `WALLET_MODE=isolated`.
Test mode permits signing and updates only for `WALLET_TEST_MERCHANT_IDS`.
The provider services reject other merchants before any outbound update or batch touch.
Isolated mode permits test signing but blocks every outbound update.
Apple push supports the original signing certificate when no APN token key is configured.
New merchants use their UUID as the public wallet reference. Existing handles stay unchanged.
Signing credentials belong only to the API container through a private optional file.
See `docs/deployment/cash-cloudflare-staging.md` before a backend rollback.
