# Umi API Cash Context

This context defines the Cash terms that the canonical backend owns.

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
