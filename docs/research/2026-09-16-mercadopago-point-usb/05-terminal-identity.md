# Terminal identity record — Point Smart 2 (Newland N950)

- Date observed: 2026-09-16.
- Source: the terminal label, read by the owner.
- This is the first record the deferred hardware validation asks for: device, version,
  environment, reference, and result. See
  `docs/certification/UMIPOS_DEFERRED_HARDWARE_VALIDATION.md`.

## 1. The observed data

| Field                 | Value                 |
| --------------------- | --------------------- |
| Product               | Point Smart 2         |
| Model                 | Newland N950          |
| Serial number (SN)    | `NCCB05317715`        |
| Part number (PN)      | `NCU-GC7LBE601M`      |
| Hardware version (HW) | `NC_01_42_01_01 2549` |

**Documented fact.** The Point Smart N950 runs Android 12, and a SmartApp on it must
declare a minimum API level of 31. Source:
[SmartApp restrictions](https://www.mercadopago.com.mx/developers/en/docs/smartapps/restrictions.md).

**Documented fact.** The Orders API accepts one of two terminal models: the Newland N950
and the PAX A910. Source: `01-official-integration-paths.md`.

## 2. The candidate terminal id

The Orders API expects `config.point.terminal_id`, and its format is
`type + "__" + serial`. The documented example is `NEWLAND_N950__N950NCB801293324`, whose
serial portion carries an `N950` prefix. Source:
[create order reference](https://www.mercadopago.com.mx/developers/en/reference/in-person-payments/point/orders/create-order/post).

**Inference.** The id for this terminal is probably `NEWLAND_N950__N950NCCB05317715`.

**Do not write that value into code or configuration yet.** The authority is
`GET https://api.mercadopago.com/terminals/v1/list`, which returns the exact value for the
account. A guessed terminal id is a create-order failure, and the failure is silent enough
to waste an afternoon.

## 3. The USB attempt, recorded

Result: **the terminal did not enumerate on the host, not even once.**

The owner removed the keyboard and connected the terminal to the same port. The kernel
journal for that port fixes the timeline:

| Time                 | Event on port `1-3`                                                           |
| -------------------- | ----------------------------------------------------------------------------- |
| 22:40:28             | `USB disconnect, device number 3` — the keyboard leaves the port.             |
| 22:40:28 to 22:43:18 | **No event at all.** The terminal occupied the port for this window.          |
| 22:43:18             | `New USB device found, idVendor=04d9, idProduct=a293` — the keyboard returns. |

The device that appeared at the end is the keyboard, and its descriptors prove it: four HID
interfaces (keyboard, consumer control, mouse, and gamepad), `Manufacturer: OBINS`,
`Product: OBINS`. A payment terminal does not present a gamepad interface.

| Observation      | Value                                                                     |
| ---------------- | ------------------------------------------------------------------------- |
| Method           | A `lsusb` diff loop, plus the kernel journal over the same window         |
| Result           | No enumeration event, and no descriptor read error, for the whole window  |
| Interfaces found | No PAX id, no Newland id, no vendor-specific interface, no `/dev/ttyACM*` |

**Documented fact.** Only a development unit has the USB port enabled. Source:
[SmartApps overview](https://www.mercadopago.com.mx/developers/en/docs/smartapps/overview.md).

**Inference.** This unit is a production unit, so its USB port carries power and nothing
else. A charge-only cable is the remaining alternative explanation, and it changes nothing:
the identity above came from the label, and the API is the operational source of truth.

## 4. What this record closes

1. The model question is answered, so the operating system and the minimum API level are
   known.
2. The serial question is answered, so the terminal id can be read from the API and matched.
3. The USB question is answered with evidence, so no workstream starts from a cable.
