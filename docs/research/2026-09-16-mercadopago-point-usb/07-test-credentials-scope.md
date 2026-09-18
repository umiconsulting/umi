# What the test credentials can do, and what they cannot

- Date: 2026-09-17. Method: live calls against the test account.
- Question answered: do we need production credentials to connect the terminal in UmiPOS?

## 1. The answer in one line

The test credentials build and prove the whole integration, except the physical terminal.
The physical terminal needs the Access Token of the account it is paired to.

## 2. Why, in the vendor's own model

**Field observation.** "Credenciales de prueba" does not mean "a test mode of the real
account". It means **a separate account**. `GET /users/me` with the test token answers:

```json
{"id": 3696430142, "nickname": "TESTUSER5545458632263290392",
 "site_id": "MLM", "tags": ["user_product_seller", "test_user", "normal"]}
```

So the test user is its own seller, with its own user id, its own money, and its own
stores. The Point terminal belongs to a different account: the real one. A test user holds
no terminal.

**Documented fact.** Mercado Pago describes the test accounts in the same terms. Source:
[Test accounts](https://www.mercadopago.com.mx/developers/en/docs/your-integrations/test/accounts.md).

## 3. The evidence, from calls made today

| Action                                               | With the test token | Result                                                                |
| ---------------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| `GET /v1/orders` for a real terminal                 | refused             | The terminal is not reachable from this account.                      |
| `POST /v1/orders` against `NEWLAND_N950__SBX0000001` | accepted            | `201`, order `ORDTST01M2Q33RDXR1W5SXB1MPZFTB0H`                       |
| `POST /users/{id}/stores`                            | accepted            | `201`, store `87482378`, status `active`                              |
| `POST /v2/pos`                                       | accepted            | `201`, point of sale `138301467`, linked to that store                |
| `GET /terminals/v1/list`                             | empty               | `total: 0`, and still `0` after the store and the point of sale exist |
| `GET /terminals/v1/list?store_id=87482378`           | empty               | `total: 0`                                                            |
| `get_credentials` on the MCP                         | refused             | Needs OAuth, not a token.                                             |

**Conclusion.** A test user can own a store and a point of sale, and it can order against
the virtual terminal. It can never own our N950. The empty terminal list is not a
configuration mistake; it is the boundary of the test account.

## 4. What this means for the work

Two tracks, and neither blocks the other.

| Track                       | Credential                                         | What it can finish                                                                                          |
| --------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Develop and prove the flow  | The test token we already have                     | The transport, the order shape, the status mapping, the webhook, the refund path, and the quality checklist |
| Touch the physical terminal | The Access Token of the account that owns the N950 | The terminal list, the `PDV` mode, and the first real charge                                                |

"Production credentials" is the name of the credential of a real account. It does not mean
"charge a real customer now". A read of the terminal list costs nothing.

## 5. API details learned while testing

Each of these is a real error that cost a call, and each is worth knowing before the
transport is written.

| Detail                                                    | Evidence                                                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| An order of `1.00` is refused. The minimum is `5.00`.     | `400`, `Must be greater than or equal to 5.00`                                              |
| `location.city_name` is a closed catalogue, with accents. | `Culiacan` is refused; `Culiacán` is accepted. The error lists the valid cities of Sinaloa. |
| `POST /v2/pos` requires an `X-Idempotency-Key` header.    | `400`, `Missing X-Idempotency-Key header`                                                   |
| `POST /v2/pos` requires `store_id` as a string.           | `400`, `store_id expected string, but got number`                                           |
| `external_id` of a point of sale rejects hyphens.         | `400`, `external_id does not meet the expected format`; `umipos001` is accepted.            |
| Creating a point of sale returns a QR payload.            | The `201` carries `config.qr.operating_mode: standalone` and a QR image URL.                |

## 6. Where the production credential must live

**Documented fact.** The vendor's own quality checklist requires centralized credentials:
"Make sure merchant's credentials are stored in a central server and not in every PoS."
Source: the `quality_checklist` tool of the Mercado Pago MCP server.

So the token belongs to `apps/umi-api`, never to the Flutter POS. For the demo account the
value lives in `apps/umi-api/.env`. For many merchants the same rule points at per-merchant
storage on the server, reached with OAuth.

## 7. Correction, later the same day: the test account DOES own the N950

**The conclusion in §1 and §3 is WRONG, and this section is the evidence.** It said "it can
never own our N950" and called the empty terminal list "the boundary of the test account".
That was an inference from a list taken **before the terminal was paired**, and it does not
survive the pairing.

**Field observation, 2026-09-17, after the N950 was paired to the test seller from the
Mercado Pago app.** The same token, the same endpoint:

```json
{"data": {"terminals": [{"id": "NEWLAND_N950__N950NCCB05317715",
                         "pos_id": 138301467,
                         "store_id": "87482378",
                         "external_pos_id": "umipos001",
                         "operating_mode": "STANDALONE"}]},
 "paging": {"total": 1, "limit": 50, "offset": 0}}
```

So the boundary this note drew in §3 was the boundary of an UNPAIRED account, not of a test
account. What is true, and what the table in §3 still shows correctly, is that a test account
cannot order against a terminal it does not own — which is why the list was empty and why the
earlier `GET /v1/orders` was refused. The correction matters because the wrong reading sent
this work toward "the physical terminal needs production credentials to be addressable at
all", when the only thing production is genuinely required for is a REAL CARD PAYMENT
(note 09 §1, which had it right: "the physical terminal links to the test seller account, so
orders created with test credentials arrive on the real device").

**Also observed in the same call:** `PATCH /terminals/v1/setup` with
`operating_mode: "PDV"` answers `200` and echoes `PDV`, while the LIST still reports
`STANDALONE` until the device is restarted — the vendor's own ordering, and the reason Phase 0
step 2 names the restart.
