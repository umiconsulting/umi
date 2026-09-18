# One credential or many: can UmiPoint serve Umi's clients?

- Date: 2026-09-17. Source: the vendor's go-to-production page, read directly.
- Question answered: does one production credential let us onboard Umi's clients?

## 1. The answer

**No. One production credential serves one account.** Umi's clients are other sellers,
so Umi needs the **third-party model**: each client authorizes Umi with OAuth, and Umi
operates on that client's behalf with that client's own token.

**Documented fact.** The go-to-production page splits the path in two and says the
credentials are obtained in different ways: self-integration, or third-party integration.
Source:
[Go to production](https://www.mercadopago.com.mx/developers/en/docs/mp-point/go-to-production.md).

| Model            | Whose account receives the money | Credential                                             |
| ---------------- | -------------------------------- | ------------------------------------------------------ |
| Self-integration | Umi's own account                | One production Access Token from the panel             |
| Third-party      | Each client's own account        | One OAuth token per client, obtained per authorization |

**Inference.** The distinction is not a formality. If Umi charged every client through
Umi's own account, Umi would collect other businesses' income, and their sales would not
reach their own books or their own CFDI. That is a different business, with different
regulatory duties.

## 2. What the third-party flow requires

**Documented fact.** These steps come from the third-party tab of the same page.

1. Declare a **redirect URL** in the application's advanced settings. It must be static and
   use `https`. PKCE is optional and adds a layer.
2. Send the seller to the authorization URL:

   ```
   https://auth.mercadopago.com/authorization?client_id=APP_ID&response_type=code
     &platform_id=mp&state=RANDOM_ID&redirect_uri=https://our-redirect
   ```

3. The seller logs in and approves. The redirect returns `?code=CODE&state=RANDOM_ID`.
4. Exchange the code at `POST https://api.mercadopago.com/oauth/token` with
   `client_secret`, `client_id`, `grant_type=authorization_code`, `code`, `redirect_uri`,
   and `test_token: false`.
5. The answer carries `access_token`, `refresh_token`, `user_id`, `public_key`, and
   `expires_in: 15552000`.

**The 180-day clock is the operational risk.** The token lasts 180 days, and the vendor
states that without the renewal flow the integration stops working. The `refresh_token`
and the `code` must be stored, because losing them forces the whole authorization again,
with the client in front of the screen.

## 3. The rest of the production checklist

**Documented fact.** The same page lists what changes when the integration leaves the
sandbox. Three items are easy to miss.

1. **The stores and points of sale must be created again** for the production credential.
   The ones made during development belong to the test account.
2. **The terminal must be reassociated.** Log out of the session on the terminal and scan
   its QR with the Mercado Pago mobile application, logged into the production account.
3. **Every terminal must be in `PDV` mode**, confirmed one by one.
4. **Webhooks are configured once, in the application of the main account.** In a
   third-party integration the notifications are not configured per seller.
5. Reports are optional and recommended for reconciliation.

Item 2 is the practical answer for our own N950: the terminal moves to the account that
will receive the money by scanning the QR from that account's application.

## 4. What this costs in code

The tender path already treats a provider as a slug behind a port, so a second brand costs
one adapter. Per-merchant credentials cost more, because they do not exist yet.

| Piece                 | State today                                                                              | What is missing                                                              |
| --------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| The token             | `MERCADO_PAGO_POINT_ACCESS_TOKEN` in the environment: one value for the whole deployment | A row per merchant, encrypted, read per request                              |
| The account link      | Nothing                                                                                  | `external_account_id`, the `user_id` from OAuth, and the token state         |
| The OAuth flow        | Nothing                                                                                  | The authorization redirect, the callback, the code exchange, and the renewal |
| The store and POS ids | Nothing                                                                                  | A column per merchant, created with that merchant's token                    |
| The terminal id       | Nothing                                                                                  | A column per terminal, or per register                                       |
| The webhook           | Nothing                                                                                  | One route in Umi's main application, with the signature check                |

**Documented fact.** The vendor's quality checklist requires centralized credentials, so
every one of these values belongs on the server. Source: `quality_checklist` of the
Mercado Pago MCP server.

## 5. Still open

1. Does the panel application suffice for the third-party model at our scale, or does the
   commercial team require an agreement first? Our earlier notes mark this UNVERIFIED.
2. The certification page documents an Integrator ID and a process, and the MCP carries a
   `form_homologation` tool. The exact requirements for a `point` application are not yet
   read.
3. Does one Umi application serve many sellers, or does each seller need its own
   application? The flow above implies one application with many authorizations.
