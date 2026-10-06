# The Mercado Pago MCP server, and the official tooling around it

- Date: 2026-09-17. Method: live calls against the server, plus the published index.
- Status: the MCP server is connected in this Codex installation. Nothing in the repo
  depends on it.

## 1. What the MCP server is

**Documented fact.** Mercado Pago runs a remote MCP server at
`https://mcp.mercadopago.com/mcp`. Source:
[MCP overview](https://www.mercadopago.com.mx/developers/en/docs/mcp-server/overview.md).

It is a **development-lifecycle** server, not a payment runtime. It searches documentation,
creates applications, configures webhooks, makes test users, and measures integration
quality. **It does not create orders and it does not list terminals.** The POS still calls
the Orders API over HTTPS for every charge.

## 2. The two authentication models, and what each unlocks

| Model                    | How                                                                             | What it unlocks                                                                   |
| ------------------------ | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| OAuth                    | The client opens an authorization page, the user picks the country and approves | Everything, including `get_credentials`, `create_application`, `application_list` |
| Access Token as a bearer | `Authorization: Bearer <ACCESS_TOKEN>`                                          | The rest of the tools                                                             |

**Documented fact.** The connection page states that with a token instead of OAuth, the
application management tools are unavailable. Source:
[Connect to MCP Server](https://www.mercadopago.com.mx/developers/en/docs/mcp-server/connection.md).

**Live observation, 2026-09-17.** The documented restriction is only partly right.

| Call               | Token of a test user | Result                                                 |
| ------------------ | -------------------- | ------------------------------------------------------ |
| `initialize`       | accepted             | `200`, server `mercadopago-mcp-server` version `1.0.0` |
| `tools/list`       | accepted             | 11 tools                                               |
| `application_list` | accepted             | It listed application `2040479802223096`               |
| `get_credentials`  | refused              | `OAuth ownership validation failed`                    |

So `application_list` works with a bearer token, and `get_credentials` does not. The
`get_credentials` answer is the only route that would hand us the production Access Token
without a person copying it from the panel.

## 3. The live tool list, which differs from the published page

**Live observation.** `tools/list` returns 11 tools. The published
[Available tools](https://www.mercadopago.com.mx/developers/en/docs/mcp-server/tools.md) page
lists 10 names and different parameter names.

| Tool                    | Use for us                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_documentation`  | Search the developer site. Live parameters: `term`, `siteId` (`MLM` for Mexico), `language` (`en`, `es`, `pt`). The published page calls them `query` and `language`. |
| `quality_checklist`     | The fields Mercado Pago evaluates. See section 5.                                                                                                                     |
| `quality_evaluation`    | Score an integration from a `payment_id` or an `order_id`.                                                                                                            |
| `save_webhook`          | Configure the production and sandbox callback URLs and the topics.                                                                                                    |
| `notifications_history` | Diagnose webhook delivery.                                                                                                                                            |
| `create_test_user`      | Create a test seller, buyer, or integrator.                                                                                                                           |
| `add_money_test_user`   | Load funds into a test user.                                                                                                                                          |
| `application_list`      | List the applications of the account.                                                                                                                                 |
| `create_application`    | Create an application. OAuth only.                                                                                                                                    |
| `get_credentials`       | Return the credentials. OAuth only.                                                                                                                                   |
| `form_homologation`     | Collect the homologation data. Not on the published page.                                                                                                             |

## 4. Connecting it to Codex

**Live observation.** The Codex CLI supports a streamable HTTP MCP server with a bearer
token read from an environment variable:

```bash
codex mcp add mercadopago --url https://mcp.mercadopago.com/mcp \
  --bearer-token-env-var MERCADO_PAGO_MCP_TOKEN
```

This is done, and `codex mcp list` shows the server as enabled. The token itself is NOT in
the config file: Codex reads it from the environment, so the operator exports
`MERCADO_PAGO_MCP_TOKEN` before a session that needs the server.

**Live observation: the OAuth route is blocked in this client.** Adding the server with
`--oauth-client-registration auto` starts the flow and fails with:

```
Error: OAuth authorization endpoint origin does not match the authorization server origin
without issuer-bound callbacks
```

The authorization endpoint and the MCP endpoint sit on different origins, and the Codex
client refuses the callback. Cursor, VS Code, and Claude Code are the clients that the
vendor documents for the OAuth flow. Codex is not on that list.

**Fallback that always works.** The server speaks JSON-RPC over streamable HTTP, so a plain
`curl` call drives it:

```bash
curl -s -X POST https://mcp.mercadopago.com/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

The answer arrives as a server-sent event. Strip the `data: ` prefix to read the JSON.

## 5. The quality checklist, which is the vendor's own acceptance list

`quality_checklist` answers "what does Mercado Pago measure before it calls the integration
good". Two of the entries settle decisions we had open.

**Required items.**

1. Collection on a Point device (`point_payment`).
2. Collection with PDV integration (`payment_intent_id`).
3. Branch administration: create the stores through the API.
4. POS administration: create, edit, and delete the points of sale through the API.
5. `external_reference`: a unique code that links the Mercado Pago id to the sale of our
   system.
6. Webhook notifications (`webhooks_point`).
7. **Centralized credentials: the merchant's credentials live on a central server and not
   on every point of sale.**

**Good practices that match the product the owner asked for.**

1. A complete rejected-payment flow.
2. Cancel the intent before it reaches the terminal.
3. Refunds, partial and total, from our system.
4. A search after each notification, instead of trusting the payload alone.
5. An implementation manual, and an operations manual.
6. Logs.
7. **Search terminals by API**, filtering by store or by point of sale.
8. **A device manager that switches the terminal between `PDV` and `STANDALONE`.**
9. Device alerts.

Items 7 and 8 are the `/devices` menu. Item 7 in the required list is the answer to the
question about where the token lives: on the server, never on the POS device.

## 6. The catalog of integration forms

**Documented fact.** The complete catalog is the documentation index:
`https://www.mercadopago.com.mx/developers/es/llms.txt`. It is written for language models,
and it lists every product, every guide, and every reference page with a one-line summary.

The Point family is one product among several. The Point path has seven stages, in order:

1. Create the application.
2. Configure the terminal.
3. Integrate the payment processing.
4. Configure the notifications.
5. Configure the printings.
6. Run the integration test.
7. Go to production.

The other in-person and online families in the same index are Checkout Pro, Checkout API,
Checkout Bricks, QR, Subscriptions, Wallet Connect, and Marketplace.

**Documented fact.** Mercado Pago also publishes an official CLI and an official plugin for
AI agents, and the plugin page names Codex as a supported client. Sources:
[MP CLI](https://www.mercadopago.com.mx/developers/en/docs/mp-cli/overview.md),
[MP Plugin](https://www.mercadopago.com.mx/developers/en/docs/mp-plugin/overview.md).

## 7. Sandbox facts confirmed live

All of these come from real calls against the test account, not from a reading.

| Fact                                                                     | Evidence                                                                                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The minimum order amount is `5.00`.                                      | A `1.00` order answers `400` with `Must be greater than or equal to 5.00`.                                                                                       |
| A test user can order against the virtual terminal.                      | `201` for `NEWLAND_N950__SBX0000001`, order `ORDTST01M2Q33RDXR1W5SXB1MPZFTB0H`.                                                                                  |
| Sandbox order ids carry a `TST` marker.                                  | `ORDTST...`, against `ORD` on a live order.                                                                                                                      |
| The default print mode is `seller_ticket`.                               | The create response sets `print_on_terminal: "seller_ticket"`.                                                                                                   |
| The event endpoint accepts six statuses.                                 | `at_terminal` is refused; `processed`, `canceled`, `failed`, `refunded`, `expired`, `action_required` are accepted.                                              |
| A simulated event applies asynchronously.                                | `POST .../events` with `processed` answered `204`, and the order later read back as `at_terminal`.                                                               |
| The order status vocabulary has a `status_detail` beside every `status`. | `processed`/`accredited`, `processed`/`partially_refunded`, `processing`/`in_process`, `action_required`/`waiting_payment`, `action_required`/`waiting_capture`. |

**Open item.** The simulated `processed` event left the order at `at_terminal` instead of
`processed`. Read the integration-test page
(`docs/mp-point/integration-test.md`) before the next attempt, because the order may need a
separate payment simulation to reach the credited state.
