# Pairing the terminal, and the two levels of testing

- Date: 2026-09-17. Source: the configure-terminal and integration-test pages, read directly.
- Question answered: can we test with the Point terminal we already own?

## 1. The answer

**Yes, and there are two levels.** The physical terminal links to the **test seller
account**, so orders created with test credentials arrive on the real device. Real card
payments on that device need a production account.

**Documented fact.** "It is not possible to process real payments on the physical terminal
using test accounts; to perform real transactions on the Point device, you must use a
production account with real payment methods." The same page adds: "Although the
simulation allows you to validate the integration without interaction with the terminal in
each test transaction, it is recommended that the terminal is previously linked to your
test credentials." Source:
[Integration test](https://www.mercadopago.com.mx/developers/en/docs/mp-point/integration-test.md).

| Level | Account                    | Terminal link                    | What it proves                                                                                | Money           |
| ----- | -------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------- | --------------- |
| 1     | The test seller            | Linked to the test account       | The order reaches the real device, the operator sees it, the statuses and the webhooks behave | None            |
| 2     | Our own production account | Linked to the production account | A real charge, and the path the integrator will run for each client                           | Real, and small |

## 2. The ordering, which the vendor fixes

**Documented fact.** The steps come in this order, and the terminal link sits in the
middle. Source:
[Configure terminal](https://www.mercadopago.com.mx/developers/en/docs/mp-point/configure-terminal.md).

1. Create the store.
2. Create the point of sale inside that store. **One point of sale takes one terminal in
   `PDV` mode.** A second terminal needs a second point of sale.
3. Associate the terminal, from the Mercado Pago mobile application.
4. Set `PDV` mode through `PATCH /terminals/v1/setup`.
5. Restart the terminal, and confirm `PDV` in "More options > Settings > Pairing mode".

Our test account already has steps 1 and 2 done:

| Object        | Id          |
| ------------- | ----------- |
| Store         | `87482378`  |
| Point of sale | `138301467` |

## 3. The association, step by step

**Documented fact.** The vendor's own words: "access the application and log in with the
test seller account, whose username and password are available in Your integrations >
Integration data > Test credentials > Test credentials information. Then, press the QR icon
at the bottom and scan the code presented by the terminal."

So the operator needs the test seller's user name and password, the ones the panel shows
under "Credenciales de prueba". Then:

1. Turn the terminal on. It shows "Log in to this device with your Mercado Pago account".
2. Choose "I am the business owner".
3. The terminal shows a QR code.
4. In the Mercado Pago app, logged in as the test seller, press the QR icon and scan it.
5. The terminal asks for the store and the point of sale. Select store `87482378` and point
   of sale `138301467`.
6. The terminal asks for a password for safe use. Set one and keep it.
7. The screen shows "Ready! You can now charge with your Point".

**Important.** If the terminal is already linked to another account, log out of that
session on the device first. A terminal serves one account at a time.

## 4. The terminal id, now confirmed

**Documented fact.** The list returns ids in the format
`"terminal type" + "__" + "terminal serial"`, and the vendor says: "You can identify the
Point you want through the last characters of this field, which should match the serial
that appears on the back label of the physical terminal."

**Inference, now well founded.** Our label serial is `NCCB05317715`, so our id is:

```
NEWLAND_N950__N950NCCB05317715
```

`GET /terminals/v1/list` confirms it. The response also carries `pos_id`, `store_id`,
`external_pos_id`, and `operating_mode`.

## 5. What the simulated statuses now explain

**Documented fact.** "The status change may take up to 10 seconds to be processed (or up to
40 seconds to simulate the `action_required` status) and, during this process, the order
will automatically change to the `at_terminal` status before reaching the requested final
status, except in the case of the `refunded` status, which transitions directly."

This explains what we saw on 2026-09-17: a simulated `processed` event answered `204`, and
the order read back as `at_terminal`. The intermediate state is documented, not a defect.

Another documented limit: the standard virtual device `SBX0000001` "is not valid for
integration quality measurement". A real terminal and a real order are needed to pass that
measurement.

## 6. Why level 2 still matters for a third-party product

The OAuth layer changes one thing: **where the token comes from**. Everything else is the
same call with a different bearer. The store, the point of sale, the terminal list, the
`PDV` switch, the order, and the webhook behave identically for our own account and for a
client's account.

**Inference.** So a test against our own account exercises the whole third-party code path
except the authorization step and the per-merchant token storage. It is the right first
target, and it costs one real charge of `5.00`.
