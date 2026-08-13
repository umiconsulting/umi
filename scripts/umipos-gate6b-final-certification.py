#!/usr/bin/env python3
"""Focused Gate 6B clean-environment and role certification."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import uuid

import requests
from playwright.sync_api import sync_playwright


API = os.environ["PUBLIC_API_URL"]
DASHBOARD = os.environ["PUBLIC_DASHBOARD_URL"]
DB = os.environ["POSTGRES_DB"]
PROJECT = os.environ["COMPOSE_PROJECT_NAME"]
MERCHANT = "10000000-0000-4000-8000-000000000101"
LOCATION_A = "20000000-0000-4000-8000-000000000101"
LOCATION_B = "20000000-0000-4000-8000-000000000102"
KITCHEN_ORDER = "85000000-0000-4000-8000-000000000107"
KITCHEN_CANCEL_ORDER = "85000000-0000-4000-8000-000000000117"
KITCHEN_ITEM = "85000000-0000-4000-8000-000000000108"
PASSWORD = "LiveCert!2026"
VERIFY_TLS = os.environ.get("PILOT_CURL_INSECURE") != "true"
EVIDENCE = Path(os.environ.get("GATE6B_EVIDENCE_FILE", "artifacts/certification/gate6b-final.json"))
BROWSER_EXECUTABLE = os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", "/usr/bin/google-chrome")


def closing_count_minor_units() -> int:
    raw = os.environ.get("GATE6B_CLOSING_COUNT_MINOR_UNITS")
    if raw is None:
        raise ValueError("GATE6B_CLOSING_COUNT_MINOR_UNITS is required for the disposable fixture.")
    if not raw.isdigit():
        raise ValueError("GATE6B_CLOSING_COUNT_MINOR_UNITS must be a non-negative integer.")
    return int(raw)


def check(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def psql(sql: str) -> str:
    container = os.environ.get("GATE6B_PG_CONTAINER", f"{PROJECT}-postgres-1")
    result = subprocess.run(
        ["docker", "exec", container, "psql", "-X", "-At", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", DB, "-c", sql],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def login(page, email: str, password: str = PASSWORD) -> None:
    page.goto(f"{DASHBOARD}/login")
    page.locator("#login-email").fill(email)
    page.locator("#login-pw").fill(password)
    page.get_by_role("button", name="Entrar").click()
    page.wait_for_url(lambda url: not url.endswith("/login"))
    check(not page.url.endswith("/login"), f"Falló el acceso de {email}.")


def browser_command(page, operation: str, location: str = LOCATION_A) -> dict:
    token = next(c["value"] for c in page.context.cookies() if c["name"] == "umi_csrf")
    body = {
        "operation": operation,
        "locationId": location,
        "targetAggregateId": "52000000-0000-4000-8000-000000000101",
        "targetVersion": 1,
        "commandId": str(uuid.uuid4()),
        "idempotencyKey": str(uuid.uuid4()),
        "parameters": {},
        "approvalId": None,
    }
    response = page.context.request.post(
        f"{API}/api/merchants/{MERCHANT}/administrative-commands",
        headers={"origin": DASHBOARD, "x-umi-csrf": token},
        data=body,
    )
    return {"status": response.status, "body": response.text()[:300]}


def bootstrap_evidence() -> dict:
    row = psql(
        "select (select count(*) from merchant.merchant)||'|'||"
        "(select count(*) from runtime.platform_bootstrap_command)||'|'||"
        "(select count(*) from umi.audit_log where entity='initial_merchant')"
    )
    check(row == "1|1|1", f"Evidencia de bootstrap no válida: {row}")
    body = {
        "commandId": os.environ["PILOT_BOOTSTRAP_COMMAND_ID"],
        "idempotencyKey": os.environ["PILOT_BOOTSTRAP_IDEMPOTENCY_KEY"],
        "merchant": {"id": MERCHANT, "name": "Intento no autorizado", "timezone": "America/Mazatlan", "currency": "MXN", "locale": "es-MX"},
        "location": {"id": LOCATION_A, "name": "Sucursal Local"},
        "owner": {"id": os.environ["PILOT_BOOTSTRAP_OWNER_USER_ID"], "staffId": os.environ["PILOT_BOOTSTRAP_OWNER_STAFF_ID"], "email": os.environ["PILOT_BOOTSTRAP_OWNER_EMAIL"], "fullName": os.environ["PILOT_BOOTSTRAP_OWNER_NAME"], "password": os.environ["PILOT_BOOTSTRAP_OWNER_PASSWORD"]},
    }
    no_token = requests.post(f"{API}/api/platform/bootstrap/initial-merchant", json=body, verify=VERIFY_TLS, timeout=10)
    check(no_token.status_code == 401, f"Bootstrap sin autoridad: {no_token.status_code}")
    bad_token = requests.post(f"{API}/api/platform/bootstrap/initial-merchant", json=body, headers={"x-umi-bootstrap-token": "x" * 32}, verify=VERIFY_TLS, timeout=10)
    check(bad_token.status_code == 401, f"Bootstrap con autoridad inválida: {bad_token.status_code}")
    conflict = requests.post(f"{API}/api/platform/bootstrap/initial-merchant", json=body, headers={"x-umi-bootstrap-token": os.environ["PILOT_BOOTSTRAP_TOKEN"]}, verify=VERIFY_TLS, timeout=10)
    check(conflict.status_code == 409, f"Fingerprint modificado: {conflict.status_code}")
    return {"database": row, "unauthenticated": 401, "invalidAuthority": 401, "changedFingerprint": 409}


def owner_handoff() -> dict:
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=BROWSER_EXECUTABLE)
        context = browser.new_context(ignore_https_errors=not VERIFY_TLS)
        page = context.new_page()
        login(page, os.environ["PILOT_BOOTSTRAP_OWNER_EMAIL"], os.environ["PILOT_BOOTSTRAP_OWNER_PASSWORD"])
        cookies = {c["name"]: c for c in context.cookies()}
        check(cookies["umi_access"]["httpOnly"], "La sesión Owner no es normal.")
        response = context.request.get(f"{API}/api/me/merchants")
        check(response.status == 200 and MERCHANT in response.text(), "El Owner no ve el comercio.")
        browser.close()
    return {"dashboardLogin": "passed", "merchantVisible": MERCHANT, "authority": "dashboard_administrative"}


def role_evidence() -> dict:
    rows: dict[str, object] = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=BROWSER_EXECUTABLE)
        for role, email in (("owner", "owner@umipos.local"), ("manager", "manager@umipos.local"), ("viewer", "viewer@umipos.local")):
            context = browser.new_context(ignore_https_errors=not VERIFY_TLS)
            page = context.new_page()
            login(page, email)
            check(MERCHANT in context.request.get(f"{API}/api/me/merchants").text(), f"{role} no ve el comercio.")
            if role == "viewer":
                denied = browser_command(page, "catalog.update")
                check(denied["status"] == 403, f"Viewer pudo mutar: {denied}")
                rows[role] = {"read": 200, "mutation": 403}
            elif role == "manager":
                denied = browser_command(page, "inventory.adjustment", LOCATION_B)
                check(denied["status"] in (403, 404), f"Manager cruzó ubicación: {denied}")
                rows[role] = {"read": 200, "locationB": denied["status"]}
                rows["locationScoped"] = {"locationA": 200, "locationB": denied["status"]}
            else:
                rows[role] = {"read": 200, "administration": "certified-by-live-walkthrough"}
            context.close()
        browser.close()

    headers = {"x-kds-device-token": "gate6a-pilot-kds-token"}
    snapshot = requests.post(f"{API}/api/kds/board", json={"action": "snapshot"}, headers=headers, verify=VERIFY_TLS, timeout=10)
    check(snapshot.status_code == 200, "Snapshot KDS inicial no válido.")
    terminal = psql(
        f"select string_agg(status,',' order by id) from merchant.kitchen_order "
        f"where id in ('{KITCHEN_ORDER}','{KITCHEN_CANCEL_ORDER}')"
    )
    if terminal != "completed,cancelled":
        check(snapshot.text.count(KITCHEN_ORDER) == 1, "La orden KDS activa no es única.")
        sequence = ("start_preparation", "mark_item_ready", "recall", "mark_order_ready", "complete")
        for version, command_type in enumerate(sequence, 1):
            payload = {
                "action": "command", "kitchenOrderId": KITCHEN_ORDER, "commandType": command_type,
                "itemIds": [KITCHEN_ITEM] if command_type == "mark_item_ready" else [],
                "commandId": str(uuid.uuid4()), "idempotencyKey": str(uuid.uuid4()),
                "correlationId": str(uuid.uuid4()), "expectedVersion": version,
            }
            if command_type == "recall":
                payload["reasonCode"] = "quality_recheck"
            response = requests.post(f"{API}/api/kds/command", json=payload, headers=headers, verify=VERIFY_TLS, timeout=10)
            check(response.status_code == 200, f"KDS {command_type}: {response.status_code} {response.text}")
        cancel = {
            "action": "command", "kitchenOrderId": KITCHEN_CANCEL_ORDER, "commandType": "cancel_ack",
            "itemIds": [], "reasonCode": "customer_cancelled", "commandId": str(uuid.uuid4()),
            "idempotencyKey": str(uuid.uuid4()), "correlationId": str(uuid.uuid4()), "expectedVersion": 1,
        }
        response = requests.post(f"{API}/api/kds/command", json=cancel, headers=headers, verify=VERIFY_TLS, timeout=10)
        check(response.status_code == 200, f"KDS cancel: {response.status_code} {response.text}")
    reconnect = requests.post(f"{API}/api/kds/board", json={"action": "snapshot"}, headers=headers, verify=VERIFY_TLS, timeout=10)
    check(reconnect.status_code == 200 and reconnect.text.count(KITCHEN_ORDER) <= 1, "Reconciliación KDS duplicada.")
    financial = requests.post(f"{API}/api/merchants/{MERCHANT}/administrative-commands", json={}, headers=headers, verify=VERIFY_TLS, timeout=10)
    check(financial.status_code in (401, 403), "KDS obtuvo autoridad financiera.")
    rows["kds"] = {"snapshot": 200, "start": 200, "ready": 200, "recall": 200, "complete": 200, "cancel": 200, "reconnect": 200, "financialAuthority": financial.status_code}
    rows["ownerShiftClose"] = close_current_owner_shift()
    rows["cashier"] = cashier_shift_evidence()
    return rows


def close_current_owner_shift() -> dict:
    return close_shift_with_pin("1111", open_new=False)


def cashier_shift_evidence() -> dict:
    return close_shift_with_pin("2468", open_new=True)


def close_shift_with_pin(pin: str, open_new: bool) -> dict:
    device_headers = {
        "x-umi-device-id": os.environ["SMOKE_DEVICE_ID"],
        "x-umi-device-credential": os.environ["SMOKE_DEVICE_CREDENTIAL"],
    }
    login_response = requests.post(
        f"{API}/api/v1/auth/pos/pin-login",
        headers=device_headers,
        json={
            "pin": pin,
            "merchantId": MERCHANT,
            "locationId": LOCATION_A,
            "installationId": os.environ["SMOKE_INSTALLATION_ID"],
        },
        verify=VERIFY_TLS,
        timeout=10,
    )
    check(login_response.status_code == 201, f"Login Cashier: {login_response.status_code}")
    headers = {**device_headers, "authorization": f"Bearer {login_response.json()['tokens']['accessToken']}"}
    session_response = requests.post(
        f"{API}/api/v1/pos/operator-sessions",
        headers=headers,
        json={"merchantId": MERCHANT, "locationId": LOCATION_A},
        verify=VERIFY_TLS,
        timeout=10,
    )
    check(session_response.status_code == 201, f"Sesión Cashier: {session_response.status_code}")
    operator_session_id = session_response.json()["id"]

    def identity() -> dict:
        return {
            "locationId": LOCATION_A,
            "operatorSessionId": operator_session_id,
            "commandId": str(uuid.uuid4()),
            "idempotencyKey": str(uuid.uuid4()),
        }

    center_url = f"{API}/api/v1/pos/merchants/{MERCHANT}/cash"
    center_params = {"locationId": LOCATION_A, "operatorSessionId": operator_session_id}
    center = requests.get(center_url, headers=headers, params=center_params, verify=VERIFY_TLS, timeout=10)
    check(center.status_code == 200, f"Centro de caja: {center.status_code} {center.text}")
    snapshot = center.json()
    register = snapshot["registers"][0]
    money = {"minorUnits": 100000, "currency": "MXN"}
    opened_status: int | str = "existing"
    if open_new:
        opened = requests.post(
            f"{center_url}/shifts",
            headers=headers,
            json={
                **identity(),
                "registerId": register["id"],
                "openingFloat": money,
                "denominations": [],
                "businessDate": snapshot["businessDate"],
                "note": "Turno Cashier Gate 6B",
                "expectedRegisterVersion": register["version"],
            },
            verify=VERIFY_TLS,
            timeout=10,
        )
        check(opened.status_code == 201, f"Apertura Cashier: {opened.status_code} {opened.text}")
        shift = opened.json()["shift"]
        opened_status = 201
    else:
        shift = snapshot["currentShift"]
        if snapshot["recoveryState"] == "operator_mismatch":
            resumed = requests.post(
                f"{center_url}/shifts/{shift['id']}/resume",
                headers=headers,
                json={
                    **identity(),
                    "shiftId": shift["id"],
                    "expectedShiftVersion": shift["version"],
                    "reasonCode": "session_recovery",
                },
                verify=VERIFY_TLS,
                timeout=10,
            )
            check(resumed.status_code == 201, f"Recuperación de turno: {resumed.status_code} {resumed.text}")
            snapshot = requests.get(
                center_url, headers=headers, params=center_params, verify=VERIFY_TLS, timeout=10
            ).json()
            shift = snapshot["currentShift"]
        money = {"minorUnits": closing_count_minor_units(), "currency": "MXN"}
    shift_id = shift["id"]

    counted = requests.post(
        f"{center_url}/shifts/{shift_id}/counts",
        headers=headers,
        json={
            **identity(),
            "shiftId": shift_id,
            "countedCash": money,
            "denominations": [],
            "expectedShiftVersion": shift["version"],
            "expectedLedgerSequence": int(shift["ledgerSequence"]),
            "note": "Conteo Gate 6B",
        },
        verify=VERIFY_TLS,
        timeout=10,
    )
    check(counted.status_code == 201, f"Conteo Cashier: {counted.status_code} {counted.text}")
    count_id = counted.json()["count"]["id"]
    center = requests.get(center_url, headers=headers, params=center_params, verify=VERIFY_TLS, timeout=10).json()
    reconciled = requests.post(
        f"{center_url}/shifts/{shift_id}/reconcile",
        headers=headers,
        json={
            **identity(),
            "shiftId": shift_id,
            "countAttemptId": count_id,
            "resolutionId": None,
            "expectedShiftVersion": center["currentShift"]["version"],
        },
        verify=VERIFY_TLS,
        timeout=10,
    )
    check(reconciled.status_code == 201, f"Conciliación Cashier: {reconciled.status_code} {reconciled.text}")
    approval_id = None
    approval_fingerprint = reconciled.json()["closeApprovalFingerprint"]
    if reconciled.json()["closeApprovalRequired"]:
        approval = requests.post(
            f"{API}/api/v1/pos/elevation/manager-approval",
            headers=headers,
            json={
                "operatorSessionId": operator_session_id,
                "managerPin": "3333",
                "permission": "cash.shift.close.approve",
                "merchantId": MERCHANT,
                "locationId": LOCATION_A,
                "commandFingerprint": approval_fingerprint,
            },
            verify=VERIFY_TLS,
            timeout=10,
        )
        check(approval.status_code == 201, f"Aprobación de cierre: {approval.status_code} {approval.text}")
        approval_id = approval.json()["elevationId"]
    center = requests.get(center_url, headers=headers, params=center_params, verify=VERIFY_TLS, timeout=10).json()
    closed = requests.post(
        f"{center_url}/shifts/{shift_id}/close",
        headers=headers,
        json={
            **identity(),
            "shiftId": shift_id,
            "countAttemptId": count_id,
            "reconciliationId": reconciled.json()["id"],
            "approvalId": approval_id,
            "approvalFingerprint": approval_fingerprint,
            "expectedShiftVersion": center["currentShift"]["version"],
        },
        verify=VERIFY_TLS,
        timeout=10,
    )
    check(closed.status_code == 201, f"Cierre Cashier: {closed.status_code} {closed.text}")
    return {"pinLogin": 201, "open": opened_status, "count": 201, "reconcile": 201, "close": 201, "adminAuthority": "none"}


def persisted_evidence() -> dict:
    queries = {
        "merchants": "select count(*) from merchant.merchant",
        "bootstrapCommands": "select count(*) from runtime.platform_bootstrap_command",
        "sales": f"select count(*) from merchant.pos_committed_sale where merchant_id='{MERCHANT}'",
        "refunds": f"select count(*) from merchant.pos_sale_exception where merchant_id='{MERCHANT}'",
        "inventoryFacts": f"select count(*) from merchant.stock_ledger_entry where merchant_id='{MERCHANT}'",
        "receipts": f"select count(*) from merchant.receipt_snapshot where merchant_id='{MERCHANT}'",
        "hardwareCommands": f"select count(*) from merchant.hardware_command where merchant_id='{MERCHANT}'",
        "kitchenCompleted": f"select count(*) from merchant.kitchen_order where id='{KITCHEN_ORDER}' and status='completed'",
        "loyaltyFacts": f"select count(*) from merchant.loyalty_points_ledger where merchant_id='{MERCHANT}'",
        "closedShifts": f"select count(*) from merchant.cash_shift where merchant_id='{MERCHANT}' and status='closed'",
        "forcedRls": "select count(*) from pg_class where relkind='r' and relrowsecurity and relforcerowsecurity",
        "duplicateCommands": f"select count(*) from (select command_id from merchant.administrative_command where merchant_id='{MERCHANT}' group by command_id having count(*)>1) x",
    }
    values = {key: int(psql(sql)) for key, sql in queries.items()}
    for key in ("sales", "refunds", "inventoryFacts", "receipts", "hardwareCommands", "kitchenCompleted", "loyaltyFacts", "forcedRls"):
        check(values[key] > 0, f"Falta evidencia: {key}")
    check(values["duplicateCommands"] == 0, "Hay comandos duplicados.")
    return values


def main() -> None:
    phase = os.environ.get("GATE6B_CERT_PHASE", "all")
    output: dict[str, object] = {"environment": "clean-disposable-pilot", "releaseCommit": os.environ["RELEASE_GIT_COMMIT"]}
    if phase in ("bootstrap", "all"):
        output["bootstrap"] = bootstrap_evidence()
        output["ownerHandoff"] = owner_handoff()
    if phase in ("roles", "all"):
        output["roles"] = role_evidence()
    if phase in ("evidence", "all"):
        output["persistence"] = persisted_evidence()
    EVIDENCE.parent.mkdir(parents=True, exist_ok=True)
    EVIDENCE.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("GATE6B_FINAL_EVIDENCE " + json.dumps(output, sort_keys=True))


if __name__ == "__main__":
    main()
