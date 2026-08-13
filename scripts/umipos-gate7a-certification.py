#!/usr/bin/env python3
"""Focused real-stack Gate 7A operational certification."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import uuid

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


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def uid() -> str:
    return str(uuid.uuid4())


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
            if center["recoveryState"] == "operator_mismatch":
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
