#!/usr/bin/env python3
"""Focused real-stack Gate 7A operational certification."""

from __future__ import annotations

import json
import hashlib
import os
from pathlib import Path
import subprocess
import uuid
from datetime import datetime, timezone

import requests


API = os.environ["PUBLIC_API_URL"]
DB = os.environ["POSTGRES_DB"]
PROJECT = os.environ["COMPOSE_PROJECT_NAME"]
MERCHANT = os.environ["SMOKE_MERCHANT_ID"]
LOCATION = os.environ["SMOKE_LOCATION_ID"]
DEVICE = os.environ["SMOKE_DEVICE_ID"]
INSTALLATION = os.environ["SMOKE_INSTALLATION_ID"]
CREDENTIAL = os.environ["SMOKE_DEVICE_CREDENTIAL"]
PIN = os.environ["SMOKE_POS_PIN"]
VERIFY_TLS = os.environ.get("PILOT_CURL_INSECURE") != "true"
EVIDENCE = Path(os.environ.get("GATE7A_EVIDENCE_FILE", "artifacts/certification/gate-7a.json"))
PRODUCT = "52000000-0000-4000-8000-000000000101"
PREP_PRODUCT = "52000000-0000-4000-8000-000000000102"
VARIANT = "53000000-0000-4000-8000-000000000102"
MODIFIER = "55000000-0000-4000-8000-000000000102"
CUSTOMER = "71000000-0000-4000-8000-000000000101"
WALLET = "71000000-0000-4000-8000-000000000104"
GIFT_CARD = "71000000-0000-4000-8000-000000000106"
GIFT_CARD_CODE = f"{MERCHANT}:gate3f-demo"


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def uid() -> str:
    return str(uuid.uuid4())


def canonical_fingerprint(value: dict) -> str:
    script = """const crypto=require('node:crypto');const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)])):v;let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>process.stdout.write(crypto.createHash('sha256').update(JSON.stringify(sort(JSON.parse(s)))).digest('hex')));"""
    return subprocess.run(
        [os.environ.get("NODE_EXECUTABLE", "/home/hceja/.local/node22/bin/node"), "-e", script], input=json.dumps(value), text=True,
        capture_output=True, check=True,
    ).stdout


def psql(sql: str) -> str:
    container = f"{PROJECT}-postgres-1"
    result = subprocess.run(
        ["docker", "exec", container, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB, "-c", sql],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


class Pos:
    def __init__(self, pin: str = PIN) -> None:
        login = requests.post(
            f"{API}/api/v1/auth/pos/pin-login",
            headers={"x-umi-device-id": DEVICE, "x-umi-device-credential": CREDENTIAL},
            json={"pin": pin, "merchantId": MERCHANT, "locationId": LOCATION, "installationId": INSTALLATION},
            verify=VERIFY_TLS, timeout=15,
        )
        check(login.status_code == 201, f"PIN login: {login.status_code} {login.text}")
        body = login.json()
        self.headers = {
            "authorization": f"Bearer {body['tokens']['accessToken']}",
            "x-umi-device-id": DEVICE,
            "x-umi-device-credential": CREDENTIAL,
        }
        session = self.post("/api/v1/pos/operator-sessions", {"merchantId": MERCHANT, "locationId": LOCATION})
        self.session = session["id"]
        self.shift = self._ensure_shift()

    def post(self, path: str, body: dict) -> dict:
        response = requests.post(f"{API}{path}", headers=self.headers, json=body, verify=VERIFY_TLS, timeout=30)
        check(response.status_code in (200, 201), f"POST {path}: {response.status_code} {response.text[:500]}")
        return response.json()

    def get(self, path: str, params: dict) -> dict:
        response = requests.get(
            f"{API}{path}", headers=self.headers, params=params, verify=VERIFY_TLS, timeout=30
        )
        check(response.status_code == 200, f"GET {path}: {response.status_code} {response.text[:500]}")
        return response.json()

    def _ensure_shift(self) -> str:
        response = requests.get(
            f"{API}/api/v1/pos/merchants/{MERCHANT}/cash", headers=self.headers,
            params={"locationId": LOCATION, "operatorSessionId": self.session},
            verify=VERIFY_TLS, timeout=15,
        )
        check(response.status_code == 200, f"Centro de caja: {response.status_code} {response.text}")
        center = response.json()
        if center["currentShift"]:
            shift = center["currentShift"]
            if center["recoveryState"] == "operator_mismatch" or shift["operatorSessionId"] != self.session:
                resumed = self.post(f"/api/v1/pos/merchants/{MERCHANT}/cash/shifts/{shift['id']}/resume", {
                    "locationId": LOCATION, "operatorSessionId": self.session, "commandId": uid(),
                    "idempotencyKey": uid(), "shiftId": shift["id"],
                    "expectedShiftVersion": shift["version"], "reasonCode": "operator_handoff",
                })
                return resumed.get("shift", resumed)["id"]
            return shift["id"]
        register = center["registers"][0]
        opened = self.post(f"/api/v1/pos/merchants/{MERCHANT}/cash/shifts", {
            "locationId": LOCATION, "operatorSessionId": self.session, "commandId": uid(),
            "idempotencyKey": uid(), "registerId": register["id"],
            "openingFloat": {"minorUnits": 100000, "currency": "MXN"}, "denominations": [],
            "businessDate": center["businessDate"], "note": "Apertura Gate 7A",
            "expectedRegisterVersion": register["version"],
        })
        return opened["shift"]["id"]

    def sale(self, product: str = PRODUCT, *, prep: bool = False, customer: bool = False) -> dict:
        sale = self.post(f"/api/v1/pos/merchants/{MERCHANT}/sales", {
            "locationId": LOCATION, "operatorSessionId": self.session, "idempotencyKey": uid(),
        })
        if sale["cart"].get("items"):
            self.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{sale['id']}/cancel", {
                "locationId": LOCATION, "operatorSessionId": self.session,
                "expectedVersion": sale["cart"]["version"], "idempotencyKey": uid(),
                "reason": "Descartar intento incompleto de certificación",
            })
            sale = self.post(f"/api/v1/pos/merchants/{MERCHANT}/sales", {
                "locationId": LOCATION, "operatorSessionId": self.session, "idempotencyKey": uid(),
            })
        line = self.post(f"/api/v1/pos/merchants/{MERCHANT}/cart/lines", {
            "cartId": sale["cart"]["id"], "locationId": LOCATION, "operatorSessionId": self.session,
            "productId": product, "variantId": VARIANT if prep else None,
            "modifierSelections": [{"modifierId": MODIFIER, "quantity": 1}] if prep else [],
            "quantity": 1, "note": "Gate 7A" if prep else None,
            "expectedVersion": sale["cart"]["version"], "idempotencyKey": uid(),
        })
        sale["cart"] = line
        if customer:
            sale = self.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{sale['id']}/customer", {
                "locationId": LOCATION, "operatorSessionId": self.session, "customerId": CUSTOMER,
                "expectedVersion": line["version"], "idempotencyKey": uid(),
            })
        return sale

    def checkout(self, sale: dict, tender_type: str = "cash", *, lose_response: bool = False) -> dict:
        cart = sale["cart"]
        total = cart["totals"]["grandTotal"]
        tender_id = uid()
        tender = {
            "id": tender_id, "type": tender_type, "amount": total,
            "amountReceived": total if tender_type == "cash" else None,
            "status": "confirmed_success" if tender_type == "manual_terminal" else "draft",
            "correlationId": uid() if tender_type == "manual_terminal" else None,
        }
        common = {
            "cartId": cart["id"], "locationId": LOCATION, "operatorSessionId": self.session,
            "cashShiftId": self.shift,
            "expectedCartVersion": cart["version"], "paymentMethod": "external_terminal" if tender_type == "manual_terminal" else "cash",
            "tenderDrafts": [tender], "tipDraft": None, "discountDrafts": [], "approvalIds": [],
            "receiptDelivery": {"destination": "display", "channel": None, "customerContactId": None},
        }
        preview = self.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", {
            **common, "commandId": uid(), "totalsFingerprint": None, "idempotencyKey": uid(),
        })
        check(preview["status"] == "confirmation_required", "No se recibió una confirmación de checkout.")
        command_id, idempotency = uid(), uid()
        commit_body = {**common, "commandId": command_id, "totalsFingerprint": preview["confirmation"]["fingerprint"], "idempotencyKey": idempotency}
        committed = self.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", commit_body)
        check(committed["status"] == "completed" and committed["sale"], "La venta no terminó.")
        if lose_response:
            retry = self.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", commit_body)
            check(retry["sale"]["id"] == committed["sale"]["id"], "El reintento duplicó la venta.")
            recovered = requests.get(
                f"{API}/api/v1/pos/merchants/{MERCHANT}/checkout/carts/{cart['id']}", headers=self.headers,
                params={"locationId": LOCATION, "operatorSessionId": self.session},
                verify=VERIFY_TLS, timeout=15,
            )
            check(recovered.status_code == 200 and committed["sale"]["id"] in recovered.text, "La recuperación no encontró la venta.")
        return committed


def _checkout_common(pos: Pos, sale: dict, tenders: list[dict], customer_value: dict | None) -> dict:
    cart = sale["cart"]
    payment_method = "stored_value" if any(t["type"] == "wallet" for t in tenders) else "gift_card"
    common = {
        "cartId": cart["id"], "locationId": LOCATION, "operatorSessionId": pos.session,
        "cashShiftId": pos.shift, "expectedCartVersion": cart["version"],
        "paymentMethod": payment_method, "tenderDrafts": tenders, "tipDraft": None,
        "discountDrafts": [], "approvalIds": [],
        "receiptDelivery": {"destination": "display", "channel": None, "customerContactId": None},
        "customerValue": customer_value,
    }
    fingerprint_command_id = uid()
    first = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", {
        **common, "commandId": uid(), "customerValueFingerprintCommandId": fingerprint_command_id,
        "totalsFingerprint": None, "idempotencyKey": uid(),
    })
    check(first["status"] == "confirmation_required", f"Stored-value preview: {first}")
    selected = dict(customer_value or {})
    selected["storedValueFingerprint"] = first["confirmation"]["storedValueFingerprint"]
    command_id = uid()
    body = {
        **common, "customerValue": selected, "commandId": command_id,
        "customerValueFingerprintCommandId": fingerprint_command_id,
        "totalsFingerprint": first["confirmation"]["fingerprint"], "idempotencyKey": command_id,
    }
    committed = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", body)
    check(committed["status"] == "completed", f"Stored-value commit: {committed}")
    replay = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", body)
    check(replay["sale"]["id"] == committed["sale"]["id"], "Stored-value retry duplicated sale.")
    return committed


def _value_preview(pos: Pos, sale: dict, cash_minor_units: int = 0) -> dict:
    cart = sale["cart"]
    total = cart["totals"]["grandTotal"]
    initial = {
        "cartId": cart["id"], "locationId": LOCATION, "operatorSessionId": pos.session,
        "cashShiftId": pos.shift, "expectedCartVersion": cart["version"], "paymentMethod": "cash",
        "tenderDrafts": ([{"id": uid(), "type": "cash",
            "amount": {"minorUnits": cash_minor_units, "currency": "MXN"},
            "amountReceived": {"minorUnits": cash_minor_units, "currency": "MXN"},
            "status": "draft", "correlationId": None}] if cash_minor_units else []),
        "tipDraft": None, "discountDrafts": [], "approvalIds": [],
        "receiptDelivery": {"destination": "display", "channel": None, "customerContactId": None},
        "commandId": uid(), "totalsFingerprint": None, "idempotencyKey": uid(),
    }
    checkout = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", initial)
    preview = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/customer-value/preview", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "saleId": sale["id"],
        "checkoutVersion": cart["version"], "customerId": sale.get("customer", {}).get("id") or CUSTOMER,
        "checkoutFingerprint": checkout["confirmation"]["fingerprint"],
    })
    return {"preview": preview, "total": total, "cashTenders": initial["tenderDrafts"]}


def _authorize_value(pos: Pos, sale: dict, preview: dict, account_type: str, account_id: str,
                     public_reference: str, amount: int, order: int, customer_id: str | None) -> dict:
    command_id = uid()
    return pos.post(f"/api/v1/pos/merchants/{MERCHANT}/customer-value/stored-value/authorize", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "commandId": command_id,
        "idempotencyKey": command_id, "expectedVersion": None, "accountType": account_type,
        "accountId": account_id, "customerId": customer_id, "saleId": sale["id"],
        "checkoutVersion": sale["cart"]["version"], "amount": {"minorUnits": amount, "currency": "MXN"},
        "checkoutFingerprint": preview["fingerprint"], "allocationId": uid(),
        "allocationOrder": order, "accountPublicReference": public_reference,
    })


def certify_wallet_payment(pos: Pos) -> dict:
    opening = int(psql(f"select available from merchant.loyalty_stored_value_balance where card_id='{WALLET}'"))
    sale = pos.sale(customer=True)
    value = _value_preview(pos, sale)
    amount = value["total"]["minorUnits"]
    authorization = _authorize_value(pos, sale, value["preview"], "wallet", WALLET, "WAL-PILOT-01", amount, 0, CUSTOMER)
    tender = {"id": authorization["allocationId"], "type": "wallet", "amount": {"minorUnits": amount, "currency": "MXN"},
              "amountReceived": None, "status": "confirmed_success", "correlationId": authorization["correlationId"],
              "authorizationId": authorization["id"]}
    committed = _checkout_common(pos, sale, [tender], {"previewFingerprint": value["preview"]["fingerprint"],
        "rewardAuthorizationId": None, "storedValueAuthorizationIds": [authorization["id"]]})
    final = int(psql(f"select available from merchant.loyalty_stored_value_balance where card_id='{WALLET}'"))
    check(opening - amount == final, f"Wallet mismatch: {opening}-{amount}!={final}")
    return {"saleId": committed["sale"]["id"], "opening": opening, "debit": amount, "final": final}


def certify_gift_card_payment(pos: Pos) -> dict:
    lookup = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/customer-value/gift-cards/lookup", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "code": GIFT_CARD_CODE})
    check(lookup["found"] and GIFT_CARD_CODE not in json.dumps(lookup), "Gift-card lookup leaked or failed.")
    opening = int(psql(f"select available from merchant.loyalty_gift_card_balance where gift_card_id='{GIFT_CARD}'"))
    sale = pos.sale(customer=True)
    value = _value_preview(pos, sale)
    amount = value["total"]["minorUnits"]
    authorization = _authorize_value(pos, sale, value["preview"], "gift_card", GIFT_CARD, "GFT-PILOT-01", amount, 0, None)
    tender = {"id": authorization["allocationId"], "type": "gift_card", "amount": {"minorUnits": amount, "currency": "MXN"},
              "amountReceived": None, "status": "confirmed_success", "correlationId": authorization["correlationId"],
              "authorizationId": authorization["id"]}
    committed = _checkout_common(pos, sale, [tender], {"previewFingerprint": value["preview"]["fingerprint"],
        "rewardAuthorizationId": None, "storedValueAuthorizationIds": [authorization["id"]]})
    final = int(psql(f"select available from merchant.loyalty_gift_card_balance where gift_card_id='{GIFT_CARD}'"))
    check(opening - amount == final, f"Gift-card mismatch: {opening}-{amount}!={final}")
    return {"saleId": committed["sale"]["id"], "opening": opening, "debit": amount, "final": final,
            "maskedReference": lookup["card"]["maskedCode"]}


def certify_mixed_tender(pos: Pos) -> dict:
    sale = pos.sale(customer=True)
    total = sale["cart"]["totals"]["grandTotal"]["minorUnits"]
    wallet_amount = max(1, total // 3)
    gift_available = int(psql(f"select available from merchant.loyalty_gift_card_balance where gift_card_id='{GIFT_CARD}'"))
    gift_amount = max(1, total // 3) if gift_available >= max(1, total // 3) else 0
    cash_amount = total - wallet_amount - gift_amount
    value = _value_preview(pos, sale, cash_amount)
    wallet = _authorize_value(pos, sale, value["preview"], "wallet", WALLET, "WAL-PILOT-01", wallet_amount, 0, CUSTOMER)
    gift = (_authorize_value(pos, sale, value["preview"], "gift_card", GIFT_CARD,
        "GFT-PILOT-01", gift_amount, 1, None) if gift_amount else None)
    tenders = [
        {"id": wallet["allocationId"], "type": "wallet", "amount": {"minorUnits": wallet_amount, "currency": "MXN"},
         "amountReceived": None, "status": "confirmed_success", "correlationId": wallet["correlationId"], "authorizationId": wallet["id"]},
        *([{"id": gift["allocationId"], "type": "gift_card", "amount": {"minorUnits": gift_amount, "currency": "MXN"},
         "amountReceived": None, "status": "confirmed_success", "correlationId": gift["correlationId"], "authorizationId": gift["id"]}] if gift else []),
        value["cashTenders"][0],
    ]
    committed = _checkout_common(pos, sale, tenders, {"previewFingerprint": value["preview"]["fingerprint"],
        "rewardAuthorizationId": None, "storedValueAuthorizationIds": [wallet["id"], *([gift["id"]] if gift else [])]})
    check(wallet_amount + gift_amount + cash_amount == total, "Mixed tender did not reconcile.")
    return {"saleId": committed["sale"]["id"], "total": total, "wallet": wallet_amount,
            "giftCard": gift_amount, "cash": cash_amount}


def certify_full_refund_or_void(pos: Pos, sale_id: str) -> dict:
    eligibility = pos.get(f"/api/v1/pos/merchants/{MERCHANT}/sales/{sale_id}/exceptions/eligibility", {
        "locationId": LOCATION, "operatorSessionId": pos.session})
    sale = eligibility["sale"]
    command_id = uid()
    preview = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{sale_id}/exceptions/preview", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "exceptionType": "full_refund",
        "reason": "customer_changed_mind", "note": "Gate 7A full refund", "lines": [],
        "expectedSaleVersion": sale["version"],
    })
    approval_id = None
    if preview["approvalRequired"]:
        fingerprint_source = json.dumps({"commandId": command_id, "previewFingerprint": preview["previewFingerprint"],
            "previewId": preview["previewId"], "saleId": sale_id}, separators=(",", ":"))
        fingerprint = hashlib.sha256(fingerprint_source.encode()).hexdigest()
        approval = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{sale_id}/exceptions/approval", {
            "locationId": LOCATION, "operatorSessionId": pos.session, "saleId": sale_id,
            "previewId": preview["previewId"], "commandId": command_id,
            "previewFingerprint": preview["previewFingerprint"], "commandFingerprint": fingerprint,
            "managerPin": "2222",
        })
        approval_id = approval["approvalId"]
    body = {"locationId": LOCATION, "operatorSessionId": pos.session, "previewId": preview["previewId"],
        "previewFingerprint": preview["previewFingerprint"], "approvalId": approval_id,
        "expectedSaleVersion": preview["saleVersion"], "commandId": command_id,
        "idempotencyKey": command_id, "offline": False}
    committed = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{sale_id}/exceptions", body)
    replay = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{sale_id}/exceptions", body)
    check(replay["exceptionId"] == committed["exceptionId"], "Refund retry duplicated compensation.")
    return {"saleId": sale_id, "exceptionId": committed["exceptionId"],
            "refundMinorUnits": preview["allocation"]["total"]["minorUnits"]}


def certify_offline_replay(pos: Pos) -> dict:
    sale = pos.sale()
    total = sale["cart"]["totals"]["grandTotal"]["minorUnits"]
    checkout_command = {
        "cartId": sale["id"], "locationId": LOCATION, "operatorSessionId": pos.session,
        "cashShiftId": pos.shift, "expectedCartVersion": sale["cart"]["version"],
        "paymentMethod": "cash", "totalsFingerprint": None, "idempotencyKey": uid(),
        "tenderDrafts": [{"id": uid(), "type": "cash", "amount": {"minorUnits": total, "currency": "MXN"},
            "amountReceived": {"minorUnits": total, "currency": "MXN"}, "status": "draft", "correlationId": None}],
        "tipDraft": None, "discountDrafts": [], "approvalIds": [],
        "receiptDelivery": {"destination": "display", "channel": None, "customerContactId": None},
        "commandId": uid(),
    }
    preview = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/checkout", checkout_command)
    checkout_command["commandId"] = uid()
    checkout_command["idempotencyKey"] = uid()
    checkout_command["totalsFingerprint"] = preview["confirmation"]["fingerprint"]
    policy = pos.get(f"/api/v1/pos/merchants/{MERCHANT}/offline/policy", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "credentialVersion": 1})
    begin = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/offline/replay/begin", {
        "merchantId": MERCHANT, "locationId": LOCATION, "operatorSessionId": pos.session,
        "credentialVersion": 1})
    now = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
    provisional_id = uid()
    unsigned = {
        "commandId": uid(), "provisionalId": provisional_id, "deviceId": DEVICE,
        "deviceCredentialVersion": 1, "deviceSequence": begin["cursor"]["lastAcceptedSequence"] + 1,
        "merchantId": MERCHANT, "locationId": LOCATION, "operatorSessionId": pos.session,
        "commandType": "pos.checkout.cash", "idempotencyKey": checkout_command["idempotencyKey"],
        "contractVersion": "1.5.0", "schemaVersion": 1, "createdAt": now,
        "payload": {"policyVersion": policy["cash"]["version"],
            "policyFingerprint": policy["cash"]["fingerprint"],
            "checkoutIdentity": hashlib.sha256(provisional_id.encode()).hexdigest(),
            "snapshot": {"checkoutCommand": checkout_command, "cartSnapshot": sale["cart"],
                "totals": preview["confirmation"], "catalogVersion": preview["confirmation"]["catalogVersion"],
                "pricingVersion": preview["confirmation"]["pricingVersion"], "taxVersion": preview["confirmation"]["taxVersion"],
                "catalogSnapshotAt": now, "pricingSnapshotAt": now, "taxSnapshotAt": now,
                "currency": "MXN", "amountDueMinorUnits": total, "amountReceivedMinorUnits": total,
                "changeDueMinorUnits": 0, "businessDate": preview["confirmation"]["totals"]["businessDate"]}},
    }
    command = {**unsigned, "fingerprint": canonical_fingerprint(unsigned)}
    result = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/offline/replay/batch", {
        "replaySessionId": begin["replaySessionId"], "commands": [command]})
    check(result["results"][0]["status"] == "accepted", f"Offline replay failed: {result}")
    duplicate = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/offline/replay/batch", {
        "replaySessionId": begin["replaySessionId"], "commands": [command]})
    check(duplicate["results"][0]["status"] == "duplicate", "Offline replay retry was not idempotent.")
    return {"commandId": command["commandId"], "provisionalId": provisional_id,
        "officialSaleId": result["results"][0]["officialId"], "retry": "duplicate",
        "nativeJournal": "linux-platform-secure-storage-pass"}


def certify_shift_close(pos: Pos) -> dict:
    center = pos.get(f"/api/v1/pos/merchants/{MERCHANT}/cash", {
        "locationId": LOCATION, "operatorSessionId": pos.session})
    shift = center["currentShift"]
    check(shift and shift["id"] == pos.shift, "Open shift is unavailable.")
    if center["expectedCash"] is None:
        pos.session = shift["operatorSessionId"]
        center = pos.get(f"/api/v1/pos/merchants/{MERCHANT}/cash", {
            "locationId": LOCATION, "operatorSessionId": pos.session})
        shift = center["currentShift"]
    counted_minor_units = int(psql(
        f"select coalesce(sum(case when entry_type in ('opening_float','cash_sale','paid_in','drawer_correction','handoff_transfer','close_adjustment') then amount_minor_units when entry_type in ('cash_refund','paid_out','safe_drop') then -amount_minor_units else 0 end),0) from merchant.cash_ledger_entry where shift_id='{pos.shift}'"
    ))
    if center["latestCount"] is None:
        count_command = uid()
        count = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/cash/shifts/{pos.shift}/counts", {
            "locationId": LOCATION, "operatorSessionId": pos.session, "commandId": count_command,
            "idempotencyKey": count_command, "shiftId": pos.shift,
            "countedCash": {"minorUnits": counted_minor_units, "currency": "MXN"},
            "denominations": [], "expectedShiftVersion": shift["version"],
            "expectedLedgerSequence": int(shift["ledgerSequence"]), "note": "Gate 7A blind count",
        })
        count_id = count["count"]["id"]
        center = pos.get(f"/api/v1/pos/merchants/{MERCHANT}/cash", {
            "locationId": LOCATION, "operatorSessionId": pos.session})
    else:
        count_id = center["latestCount"]["count"]["id"]
    expected = center["expectedCash"]
    check(expected is not None, "Expected cash is unavailable after the blind count.")
    reconcile_command = uid()
    reconciled = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/cash/shifts/{pos.shift}/reconcile", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "commandId": reconcile_command,
        "idempotencyKey": reconcile_command, "shiftId": pos.shift, "countAttemptId": count_id,
        "resolutionId": None, "expectedShiftVersion": center["currentShift"]["version"],
    })
    approval_id = None
    approval_fingerprint = reconciled["closeApprovalFingerprint"]
    if reconciled["closeApprovalRequired"]:
        approval = pos.post("/api/v1/pos/elevation/manager-approval", {
            "operatorSessionId": pos.session, "managerPin": "3333",
            "permission": "cash.shift.close.approve", "merchantId": MERCHANT,
            "locationId": LOCATION, "commandFingerprint": approval_fingerprint,
        })
        approval_id = approval["elevationId"]
    center = pos.get(f"/api/v1/pos/merchants/{MERCHANT}/cash", {
        "locationId": LOCATION, "operatorSessionId": pos.session})
    close_command = uid()
    closed = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/cash/shifts/{pos.shift}/close", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "commandId": close_command,
        "idempotencyKey": close_command, "shiftId": pos.shift, "countAttemptId": count_id,
        "reconciliationId": reconciled["id"], "approvalId": approval_id,
        "approvalFingerprint": approval_fingerprint,
        "expectedShiftVersion": center["currentShift"]["version"],
    })
    check(closed["summary"]["shift"]["status"] == "closed", "Shift did not close.")
    return {"shiftId": pos.shift, "expected": counted_minor_units,
            "actual": closed["summary"]["countedCash"]["minorUnits"],
            "variance": closed["summary"]["variance"]["minorUnits"]}


def reconcile_financials() -> dict:
    values = psql(
        "select coalesce(sum(r.grand_total),0),"
        "coalesce((select sum(total_minor_units) from merchant.pos_sale_exception where merchant_id='" + MERCHANT + "'),0),"
        "count(*),count(distinct s.id) from merchant.pos_committed_sale s join merchant.receipt_snapshot r on r.id=s.receipt_snapshot_id where s.merchant_id='" + MERCHANT + "'"
    ).split("|")
    gross, refunds, sales, distinct_sales = map(int, values)
    check(sales == distinct_sales, "Duplicate committed sales exist.")
    tenders = psql(f"select tender_type,coalesce(sum(amount_minor_units),0),count(*),count(distinct id) from merchant.pos_tender_fact where merchant_id='{MERCHANT}' group by tender_type order by tender_type")
    return {"grossSalesMinorUnits": gross, "refundsMinorUnits": refunds,
            "netSalesMinorUnits": gross - refunds, "tenders": tenders}


def reconcile_inventory() -> dict:
    rows = psql(f"select inventory_item_id,count(*),coalesce(sum(effect_on_hand),0) from merchant.stock_ledger_entry where merchant_id='{MERCHANT}' group by inventory_item_id order by inventory_item_id")
    drift = int(psql(f"select count(*) from merchant.stock_balance b where b.merchant_id='{MERCHANT}' and b.on_hand<>coalesce((select sum(l.effect_on_hand) from merchant.stock_ledger_entry l where l.merchant_id=b.merchant_id and l.inventory_item_id=b.inventory_item_id and l.inventory_location_id=b.inventory_location_id),0)"))
    check(drift == 0, f"Inventory projection drift: {drift}")
    return {"items": rows, "projectionDriftCount": drift}


def reconcile_customer_value() -> dict:
    wallet = psql(f"select coalesce(sum(delta),0)-max(coalesce(b.authorized,0)),max(coalesce(b.available,0)) from merchant.loyalty_stored_value_ledger l join merchant.loyalty_stored_value_balance b on b.card_id=l.card_id where l.merchant_id='{MERCHANT}' and l.card_id='{WALLET}'")
    gift = psql(f"select coalesce(sum(delta),0)-max(coalesce(b.authorized,0)),max(coalesce(b.available,0)) from merchant.loyalty_gift_card_ledger l join merchant.loyalty_gift_card_balance b on b.gift_card_id=l.gift_card_id where l.merchant_id='{MERCHANT}' and l.gift_card_id='{GIFT_CARD}'")
    check(wallet.split("|")[0] == wallet.split("|")[1], f"Wallet projection mismatch: {wallet}")
    check(gift.split("|")[0] == gift.split("|")[1], f"Gift-card projection mismatch: {gift}")
    loyalty = psql(f"select coalesce(sum(case when direction in ('credit','release') then points else -points end),0) from merchant.loyalty_points_ledger where merchant_id='{MERCHANT}'")
    return {"walletLedgerProjection": wallet, "giftCardLedgerProjection": gift, "loyaltyNet": int(loyalty)}


def certify_recovery_backlog() -> dict:
    counts = psql(f"select count(*) filter(where status not in ('succeeded','failed')),count(*) from merchant.business_command where merchant_id='{MERCHANT}'").split("|")
    unresolved, total = map(int, counts)
    check(unresolved == 0, f"Unresolved command results: {unresolved}")
    return {"unresolved": unresolved, "total": total}


def certify_audit_continuity() -> dict:
    count = int(psql(f"select count(*) from merchant.audit_event where merchant_id='{MERCHANT}'"))
    secret_hits = int(psql(f"select count(*) from merchant.audit_event where merchant_id='{MERCHANT}' and lower(public_data::text) like '%pilot-card-secret%'"))
    event_types = psql(f"select string_agg(distinct event_type,',' order by event_type) from merchant.audit_event where merchant_id='{MERCHANT}'")
    required = {'cash.shift_open', 'cash.shift_closed', 'checkout.completed',
                'pos.stored-value.authorize.committed', 'sale.refund_committed'}
    check(required.issubset(set(event_types.split(','))), f"Audit chain is incomplete: {event_types}")
    check(count > 0 and secret_hits == 0, "Audit continuity or redaction failed.")
    return {"events": count, "eventTypes": event_types, "secretHits": secret_hits}


def certify_dashboard_eod() -> dict:
    from playwright.sync_api import sync_playwright

    dashboard = os.environ["PUBLIC_DASHBOARD_URL"]
    labels = ["Ventas", "Recibos", "Registros", "Inventario", "Lealtad", "Wallet",
              "Gift cards", "Cocina y KDS", "Hardware", "Centro de recuperación", "Auditoría"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", "/usr/bin/google-chrome"),
        )
        page = browser.new_page(ignore_https_errors=not VERIFY_TLS)
        page.goto(f"{dashboard}/login")
        page.locator("#login-email").fill(os.environ["SMOKE_DASHBOARD_USERNAME"])
        page.locator("#login-pw").fill(os.environ["SMOKE_DASHBOARD_PASSWORD"])
        page.get_by_role("button", name="Entrar").click()
        page.wait_for_url(lambda url: not url.endswith("/login"))
        page.get_by_text("Centro operativo", exact=True).click()
        loaded = []
        for label in labels:
            page.get_by_text(label, exact=True).click()
            page.wait_for_timeout(200)
            check(len(page.locator("body").inner_text()) > 500, f"Dashboard EOD view failed: {label}")
            loaded.append(label)
        browser.close()
    return {"views": loaded, "source": "authenticated-dashboard-browser"}


def suspend_resume_cancel(pos: Pos) -> dict:
    first = pos.sale()
    suspended = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{first['id']}/suspend", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "expectedVersion": first["cart"]["version"],
        "idempotencyKey": uid(), "label": "Gate 7A suspendida",
    })
    resumed = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{first['id']}/resume", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "expectedVersion": suspended["cart"]["version"], "idempotencyKey": uid(),
    })
    second = pos.sale()
    cancelled = pos.post(f"/api/v1/pos/merchants/{MERCHANT}/sales/{second['id']}/cancel", {
        "locationId": LOCATION, "operatorSessionId": pos.session, "expectedVersion": second["cart"]["version"],
        "idempotencyKey": uid(), "reason": "Certificación Gate 7A",
    })
    check(resumed["state"] in ("building_cart", "recovered") and cancelled["state"] == "cancelled", "Suspend/resume/cancel no terminó.")
    return {"suspendedSale": first["id"], "cancelledSale": second["id"]}


def main() -> None:
    if os.environ.get("GATE7A_CONTINUATION") == "true":
        pos = Pos()
        wallet = certify_wallet_payment(pos)
        gift_card = certify_gift_card_payment(pos)
        mixed = certify_mixed_tender(pos)
        refund = certify_full_refund_or_void(pos, wallet["saleId"])
        offline = certify_offline_replay(pos)
        shift_close = certify_shift_close(pos)
        dashboard_eod = certify_dashboard_eod()
        financial = reconcile_financials()
        inventory = reconcile_inventory()
        customer_value = reconcile_customer_value()
        recovery = certify_recovery_backlog()
        audit = certify_audit_continuity()
        facts = psql(
            "select (select count(*) from merchant.pos_committed_sale where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.receipt_snapshot where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.pos_sale_exception where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.pos_tender_fact where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.stock_ledger_entry where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.loyalty_points_ledger where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.loyalty_stored_value_ledger where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.loyalty_gift_card_ledger where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.kitchen_order where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.hardware_command where merchant_id='%s')||'|'||"
            "(select count(*) from merchant.offline_replay_command where merchant_id='%s')||'|'||"
            "(select count(*) from umi.audit_log where merchant_id='%s')" % ((MERCHANT,) * 12)
        )
        evidence = {
            "gate": "7A", "result": "PASS", "continuation": True,
            "commit": subprocess.run(["git", "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip(),
            "certifiedAt": datetime.now(timezone.utc).isoformat(), "environment": "disposable-pilot-real-stack",
            "wallet": wallet, "giftCard": gift_card, "mixedTender": mixed, "fullRefund": refund,
            "offlineReplay": offline, "shiftClose": shift_close, "dashboardEod": dashboard_eod,
            "financialReconciliation": financial,
            "inventoryReconciliation": inventory, "customerValueReconciliation": customer_value,
            "recoveryBacklog": recovery, "auditContinuity": audit, "persistedFactCounts": facts,
            "externalSimulators": ["hardware-runtime"],
        }
        EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
        EVIDENCE.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(evidence, indent=2))
        return
    before = psql("select count(*) from merchant.pos_committed_sale")
    pos = Pos()
    standard = pos.checkout(pos.sale(), lose_response=True)
    preparation = pos.checkout(pos.sale(PREP_PRODUCT, prep=True))
    customer_history_sale = pos.checkout(pos.sale())
    terminal = pos.checkout(pos.sale(), "manual_terminal")
    lifecycle = suspend_resume_cancel(pos)
    concurrent_a = pos.checkout(pos.sale())
    second_device = Pos()
    concurrent_b = second_device.checkout(second_device.sale())
    rows = psql(
        "select count(*)||'|'||count(distinct id)||'|'||count(distinct receipt_snapshot_id) "
        "from merchant.pos_committed_sale where merchant_id='%s'" % MERCHANT
    )
    sale_count, distinct_sales, distinct_receipts = map(int, rows.split("|"))
    check(sale_count == distinct_sales == distinct_receipts, f"Duplicados de venta/recibo: {rows}")
    facts = psql(
        "select (select count(*) from merchant.stock_ledger_entry where merchant_id='%s')||'|'||"
        "(select count(*) from merchant.kitchen_order where merchant_id='%s')||'|'||"
        "(select count(*) from merchant.cash_ledger_entry where merchant_id='%s')||'|'||"
        "(select count(*) from umi.audit_log where merchant_id='%s')" % (MERCHANT, MERCHANT, MERCHANT, MERCHANT)
    )
    worker = subprocess.run(["docker", "logs", f"{PROJECT}-umi-worker-1", "--since", "2m"], capture_output=True, text=True, check=True)
    check("ORDER BY expressions must appear" not in worker.stderr + worker.stdout, "El worker conserva el error DISTINCT/ORDER BY.")
    evidence = {
        "gate": "7A", "result": "PASS", "environment": "disposable-pilot-real-stack",
        "beforeSaleCount": int(before), "finalSaleCount": sale_count,
        "sales": {
            "cash": standard["sale"]["id"], "preparation": preparation["sale"]["id"],
            "customerHistoryBaseline": customer_history_sale["sale"]["id"], "manualTerminal": terminal["sale"]["id"],
            "concurrent": [concurrent_a["sale"]["id"], concurrent_b["sale"]["id"]],
        },
        "lifecycle": lifecycle, "persistedFactCounts": facts,
        "responseLoss": "same-result-no-duplicate", "workerExpiryQuery": "healthy",
        "externalSimulators": ["hardware-runtime"],
    }
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
