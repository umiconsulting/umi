#!/usr/bin/env python3
"""Gate 5A live certification. This program requires disposable services."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import threading
import time
import uuid

import requests
from playwright.sync_api import Page, sync_playwright


DASHBOARD = os.environ.get("GATE5A_DASHBOARD_URL", "http://127.0.0.1:4000")
API = os.environ.get("GATE5A_API_URL", "http://127.0.0.1:4001")
PG_CONTAINER = os.environ.get("GATE5A_PG_CONTAINER", "umi-gate5a-live-postgres")
PG_DATABASE = os.environ.get("GATE5A_PG_DATABASE", "umi_gate5a_live")

MERCHANT = "10000000-0000-4000-8000-000000000101"
LOCATION_A = "20000000-0000-4000-8000-000000000101"
LOCATION_B = "20000000-0000-4000-8000-000000000102"
OWNER_USER = "30000000-0000-4000-8000-000000000200"
OWNER_STAFF = "40000000-0000-4000-8000-000000000200"
MANAGER_USER = "30000000-0000-4000-8000-000000000203"
MANAGER_STAFF = "40000000-0000-4000-8000-000000000203"
VIEWER_STAFF = "40000000-0000-4000-8000-000000000204"
PRODUCT = "52000000-0000-4000-8000-000000000101"
INVENTORY_LOCATION = "60000000-0000-4000-8000-000000000101"
INVENTORY_ITEM = "61000000-0000-4000-8000-000000000101"
SALE = "84000000-0000-4000-8000-000000000108"
RECEIPT = "84000000-0000-4000-8000-000000000107"
HARDWARE = "68000000-0000-4000-8000-000000000101"
REGISTER = "57000000-0000-4000-8000-000000000101"
POS_DEVICE = "67000000-0000-4000-8000-000000000101"
INSTALLATION = "67000000-0000-4000-8000-000000000102"
STATION = "85000000-0000-4000-8000-000000000101"
RECOVERY_COMMAND = "86000000-0000-4000-8000-000000000102"

PASSWORD = "LiveCert!2026"
MANAGER_PIN = "3333"
OWNER_PIN = "1111"


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def psql(sql: str, tuples: bool = True) -> str:
    check(
        PG_DATABASE.startswith("umi_gate5a_")
        or os.environ.get("GATE5A_DISPOSABLE_PILOT_CONFIRM") == "disposable",
        "The database is not disposable.",
    )
    command = ["docker", "exec", PG_CONTAINER, "psql", "-X", "-U", "postgres", "-d", PG_DATABASE]
    if tuples:
        command.extend(["-At"])
    command.extend(["-v", "ON_ERROR_STOP=1", "-c", sql])
    return subprocess.run(command, check=True, text=True, capture_output=True).stdout.strip()


def new_id() -> str:
    return str(uuid.uuid4())


def login(page: Page, email: str = "owner@umipos.local") -> None:
    page.goto(f"{DASHBOARD}/login")
    page.locator("#login-email").fill(email)
    page.locator("#login-pw").fill(PASSWORD)
    page.get_by_role("button", name="Entrar").click()
    page.wait_for_url(lambda url: not url.endswith("/login"))
    page.wait_for_timeout(700)
    check(page.url != f"{DASHBOARD}/login", f"Login failed for {email}.")


def browser_command(
    page: Page,
    operation: str,
    target: str,
    *,
    location: str | None = LOCATION_A,
    parameters: dict | None = None,
    target_version: int | None = None,
    command_id: str | None = None,
    idempotency_key: str | None = None,
    approval_id: str | None = None,
    csrf: str = "valid",
    merchant: str = MERCHANT,
    extra: dict | None = None,
) -> dict:
    body = {
        "operation": operation,
        "locationId": location,
        "targetAggregateId": target,
        "targetVersion": target_version,
        "commandId": command_id or new_id(),
        "idempotencyKey": idempotency_key or new_id(),
        "parameters": parameters or {},
        "approvalId": approval_id,
    }
    body.update(extra or {})
    return browser_command_body(page, body, csrf=csrf, merchant=merchant)


def browser_command_body(
    page: Page,
    body: dict,
    *,
    csrf: str = "valid",
    merchant: str = MERCHANT,
) -> dict:
    url = f"{API}/api/merchants/{merchant}/administrative-commands"
    result = page.evaluate(
        """async ({url, body, csrfMode}) => {
          const part = document.cookie.split('; ').find((value) => value.startsWith('umi_csrf='));
          const headers = {'Content-Type': 'application/json'};
          if (csrfMode === 'valid' && part) headers['X-UMI-CSRF'] = decodeURIComponent(part.split('=')[1]);
          if (csrfMode === 'invalid') headers['X-UMI-CSRF'] = 'invalid-live-certification-token';
          try {
            const response = await fetch(url, {
              method: 'POST', credentials: 'include', headers, body: JSON.stringify(body)
            });
            return {status: response.status, body: await response.json().catch(() => ({}))};
          } catch (error) {
            return {status: 0, body: {networkError: String(error)}};
          }
        }""",
        {
            "url": url,
            "body": body,
            "csrfMode": csrf,
        },
    )
    if result["status"] != 0:
        return result
    headers = {"Origin": DASHBOARD, "Content-Type": "application/json"}
    if csrf == "valid":
        token = next(
            (cookie["value"] for cookie in page.context.cookies() if cookie["name"] == "umi_csrf"),
            None,
        )
        if token:
            headers["X-UMI-CSRF"] = token
    elif csrf == "invalid":
        headers["X-UMI-CSRF"] = "invalid-live-certification-token"
    response = page.context.request.post(url, headers=headers, data=body)
    try:
        payload = response.json()
    except Exception:
        payload = {}
    return {"status": response.status, "body": payload}


def error_text(result: dict) -> str:
    return json.dumps(result.get("body", {}), sort_keys=True)


def expect_denied(result: dict, name: str) -> None:
    check(result["status"] in (400, 401, 403, 404, 409), f"{name} was accepted: {result}")


def select_domain(page: Page, label: str) -> None:
    page.get_by_text(label, exact=True).click()
    page.wait_for_timeout(400)


class HardwareSimulator:
    def __init__(self) -> None:
        self.stop_event = threading.Event()
        self.errors: list[str] = []
        self.claimed: list[str] = []
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.thread.join(timeout=5)
        check(not self.errors, "; ".join(self.errors))

    def _run(self) -> None:
        try:
            headers = {
                "x-umi-device-id": POS_DEVICE,
                "x-umi-device-credential": "gate5a-live-device-credential",
            }
            login_result = requests.post(
                f"{API}/api/v1/auth/pos/pin-login",
                headers=headers,
                json={
                    "merchantId": MERCHANT,
                    "locationId": LOCATION_A,
                    "installationId": INSTALLATION,
                    "pin": OWNER_PIN,
                },
                timeout=5,
                verify=os.environ.get("GATE5A_DISPOSABLE_PILOT_CONFIRM") != "disposable",
            )
            login_result.raise_for_status()
            headers["Authorization"] = f"Bearer {login_result.json()['tokens']['accessToken']}"
            operator_result = requests.post(
                f"{API}/api/v1/pos/operator-sessions",
                headers=headers,
                json={"merchantId": MERCHANT, "locationId": LOCATION_A},
                timeout=5,
                verify=os.environ.get("GATE5A_DISPOSABLE_PILOT_CONFIRM") != "disposable",
            )
            operator_result.raise_for_status()
            operator_session = operator_result.json()["id"]
            while not self.stop_event.is_set():
                claim = requests.get(
                    f"{API}/api/v1/pos/merchants/{MERCHANT}/hardware/commands/remote/claim",
                    headers=headers,
                    params={"locationId": LOCATION_A, "operatorSessionId": operator_session},
                    timeout=5,
                    verify=os.environ.get("GATE5A_DISPOSABLE_PILOT_CONFIRM") != "disposable",
                )
                if claim.status_code == 200 and claim.json().get("command"):
                    claimed = claim.json()["command"]
                    payload = claimed.get("command", claimed)
                    command_id = payload.get("commandId") or payload.get("id")
                    check(bool(command_id), f"The claimed command has no identity: {claimed}")
                    transition = requests.post(
                        f"{API}/api/v1/pos/merchants/{MERCHANT}/hardware/commands/{command_id}/transition",
                        headers=headers,
                        json={
                            "locationId": LOCATION_A,
                            "operatorSessionId": operator_session,
                            "status": "succeeded",
                            "safeResultMetadata": {
                                "statusMessage": "live_certification_simulator_success",
                                "acknowledged": True,
                            },
                        },
                        timeout=5,
                        verify=os.environ.get("GATE5A_DISPOSABLE_PILOT_CONFIRM") != "disposable",
                    )
                    transition.raise_for_status()
                    self.claimed.append(command_id)
                elif claim.status_code not in (200, 204, 404):
                    self.errors.append(f"hardware claim failed: {claim.status_code} {claim.text}")
                    return
                time.sleep(0.15)
        except Exception as error:  # The error becomes a certification failure.
            self.errors.append(str(error))


def wait_for_claims(simulator: HardwareSimulator, minimum: int, timeout: float = 15) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if simulator.errors:
            raise AssertionError("; ".join(simulator.errors))
        if len(simulator.claimed) >= minimum:
            return
        time.sleep(0.1)
    raise AssertionError(f"The simulator claimed {len(simulator.claimed)} of {minimum} commands.")


def run_positive_walkthrough(page: Page) -> None:
    page.get_by_text("Centro operativo", exact=True).click()
    page.wait_for_timeout(500)

    select_domain(page, "Catálogo")
    page.get_by_role("button", name="Editar").first.click()
    dialog = page.get_by_role("dialog", name="Producto")
    dialog.get_by_role("button", name="Cargar datos actuales").click()
    dialog.get_by_label("Nombre").fill("Americano Live Cert")
    dialog.get_by_label("Código de barras").fill("7501055300017")
    dialog.get_by_text("Requiere preparación", exact=False).locator("input").check()
    dialog.get_by_role("button", name="Guardar").click()
    dialog.wait_for(state="detached")

    select_domain(page, "Registros")
    page.get_by_role("button", name="Configurar").click()
    dialog = page.get_by_role("dialog", name="Registro")
    dialog.get_by_placeholder("UUID opcional").fill(POS_DEVICE)
    dialog.get_by_role("button", name="Guardar").click()
    dialog.wait_for(state="detached")

    simulator = HardwareSimulator()
    simulator.start()
    try:
        select_domain(page, "Hardware")
        page.get_by_role("button", name="Operar").first.click()
        dialog = page.get_by_role("dialog", name="Hardware")
        dialog.get_by_placeholder("ID del registro").fill(REGISTER)
        dialog.get_by_placeholder("ID del POS inscrito").fill(POS_DEVICE)
        dialog.get_by_text("Impresora principal", exact=False).locator("input").check()
        dialog.get_by_role("button", name="Guardar asignación").click()
        page.wait_for_timeout(500)
        if dialog.is_visible():
            dialog.get_by_role("button", name="Cerrar").click()
        page.get_by_role("button", name="Actualizar").click()
        page.wait_for_timeout(400)
        page.get_by_role("button", name="Operar").first.click()
        dialog = page.get_by_role("dialog", name="Hardware")
        dialog.get_by_role("button", name="Diagnóstico").click()
        wait_for_claims(simulator, 1)
        page.wait_for_timeout(700)
        if not dialog.is_visible():
            page.get_by_role("button", name="Operar").first.click()
            dialog = page.get_by_role("dialog", name="Hardware")
        dialog.get_by_role("button", name="Página de prueba").click()
        wait_for_claims(simulator, 1)
        page.wait_for_timeout(700)
        if dialog.is_visible():
            dialog.get_by_role("button", name="Cerrar").click()

        select_domain(page, "Recibos")
        page.get_by_role("button", name="Reimprimir").first.click()
        dialog = page.get_by_role("dialog", name="Reimpresión")
        dialog.get_by_text("Confirmo una copia controlada", exact=False).locator("input").check()
        dialog.get_by_role("button", name="Crear COPY").click()
        wait_for_claims(simulator, 1)
        page.wait_for_timeout(700)
        if dialog.is_visible():
            dialog.get_by_role("button", name="Cerrar").click()
    finally:
        simulator.stop()
    check(len(simulator.claimed) >= 1, "The simulator did not execute a hardware command.")

    select_domain(page, "Inventario")
    inventory_row = page.get_by_role("row").filter(has_text="Café en grano")
    inventory_row.get_by_role("button", name="Operar").click()
    dialog = page.get_by_role("dialog", name="Inventario")
    dialog.get_by_role("button", name="Cargar autoridad").click()
    dialog.get_by_role("button", name="Revisar operación").click()
    page.wait_for_timeout(500)
    pin = dialog.get_by_label("PIN del aprobador")
    if pin.count():
        pin.fill(MANAGER_PIN)
    dialog.get_by_role("button", name="Confirmar operación").click()
    dialog.wait_for(state="detached")

    page.get_by_role("button", name="Actualizar").click()
    page.wait_for_timeout(350)
    inventory_row = page.get_by_role("row").filter(has_text="Café en grano")
    inventory_row.get_by_role("button", name="Operar").click()
    dialog = page.get_by_role("dialog", name="Inventario")
    dialog.get_by_role("button", name="Cargar autoridad").click()
    dialog.get_by_label("Operación").select_option("inventory.waste")
    dialog.get_by_role("button", name="Revisar operación").click()
    page.wait_for_timeout(500)
    pin = dialog.get_by_label("PIN del aprobador")
    if pin.count():
        pin.fill(MANAGER_PIN)
    dialog.get_by_role("button", name="Confirmar operación").click()
    dialog.wait_for(state="detached")

    page.get_by_role("button", name="Actualizar").click()
    page.wait_for_timeout(350)
    inventory_row = page.get_by_role("row").filter(has_text="Café en grano")
    inventory_row.get_by_role("button", name="Operar").click()
    dialog = page.get_by_role("dialog", name="Inventario")
    dialog.get_by_role("button", name="Cargar autoridad").click()
    dialog.get_by_role("button", name="Crear conteo del artículo").click()
    dialog.get_by_label("Café en grano").fill("23")
    dialog.get_by_role("button", name="Enviar conteo").click()
    page.wait_for_timeout(500)
    pin = dialog.get_by_label("PIN del aprobador")
    if pin.count():
        pin.fill(MANAGER_PIN)
    dialog.get_by_role("button", name="Reconciliar conteo").click()
    dialog.wait_for(state="detached")

    select_domain(page, "Ventas")
    page.get_by_role("button", name="Refund").click()
    dialog = page.get_by_role("dialog", name="Refund")
    dialog.get_by_role("button", name="Consultar elegibilidad").click()
    dialog.get_by_label("Cantidad para Americano").fill("1")
    dialog.get_by_role("button", name="Crear preview").click()
    page.wait_for_timeout(500)
    pin = dialog.get_by_label("PIN del aprobador")
    if pin.count():
        pin.fill(MANAGER_PIN)
        dialog.get_by_role("button", name="Obtener aprobación").click()
    dialog.get_by_role("button", name="Confirmar refund").click()
    dialog.wait_for(state="detached")

    select_domain(page, "Lealtad")
    page.get_by_role("button", name="Ajustar").click()
    dialog = page.get_by_role("dialog", name="Ajuste de puntos")
    dialog.get_by_role("button", name="Revisar ajuste").click()
    page.wait_for_timeout(500)
    pin = dialog.get_by_label("PIN del aprobador")
    if pin.count():
        pin.fill(MANAGER_PIN)
    dialog.get_by_role("button", name="Confirmar ajuste").click()
    dialog.wait_for(state="detached")

    select_domain(page, "Wallet")
    check(page.get_by_role("button", name="Ajustar").count() == 0, "Wallet is not read-only.")

    select_domain(page, "Gift cards")
    page.get_by_role("button", name="Emitir tarjeta").click()
    dialog = page.get_by_role("dialog", name="Emitir tarjeta de regalo")
    dialog.get_by_role("button", name="Revisar emisión").click()
    page.wait_for_timeout(500)
    pin = dialog.get_by_label("PIN del aprobador")
    if pin.count():
        pin.fill(MANAGER_PIN)
    dialog.get_by_role("button", name="Emitir y revelar").click()
    dialog.get_by_text("Código de entrega única:").wait_for()
    secret = dialog.locator("code").inner_text()
    check(len(secret) >= 8, "The one-time gift-card secret is missing.")
    dialog.get_by_role("button", name="Terminar").click()
    dialog.wait_for(state="detached")

    select_domain(page, "Cocina y KDS")
    page.get_by_role("button", name="Configurar ruta").click()
    dialog = page.get_by_role("dialog", name="Ruta de cocina")
    dialog.get_by_placeholder("UUID de estación").fill(STATION)
    dialog.get_by_role("button", name="Guardar ruta").click()
    dialog.wait_for(state="detached")

    denied = browser_command(page, "kitchen.prepare", STATION)
    expect_denied(denied, "KDS-only preparation")

    select_domain(page, "Centro de recuperación")
    page.get_by_role("button", name="Recuperar").first.click()
    dialog = page.get_by_role("dialog", name="Recuperación")
    dialog.get_by_role("button", name="Consultar autoridad").click()
    dialog.get_by_text("pos.inventory.adjustment").wait_for()
    dialog.get_by_role("button", name="Ejecutar recuperación del dominio").click()
    page.wait_for_timeout(500)
    dialog.get_by_role("button", name="Cerrar").click()

    select_domain(page, "Auditoría")
    body = page.locator("body").inner_text()
    check("dashboard" in body.lower() or "administrative" in body.lower(), "Audit evidence is absent.")


def certify_response_loss_retries(page: Page, observed: dict[str, dict]) -> list[dict]:
    fact_queries = {
        "refund.commit": f"select count(*) from merchant.pos_sale_exception where merchant_id='{MERCHANT}'",
        "inventory.adjustment": f"select count(*) from merchant.stock_ledger_entry where merchant_id='{MERCHANT}'",
        "inventory.waste": f"select count(*) from merchant.stock_ledger_entry where merchant_id='{MERCHANT}' and entry_type='waste_recorded'",
        "loyalty.adjustment": f"select count(*) from merchant.loyalty_points_ledger where merchant_id='{MERCHANT}'",
    }
    evidence: list[dict] = []
    for operation, query in fact_queries.items():
        body = observed.get(operation)
        check(body is not None, f"The browser did not issue {operation}.")
        before = int(psql(query))
        result = browser_command_body(page, body)
        after = int(psql(query))
        check(result["status"] in (200, 201), f"The {operation} retry failed: {result}")
        check(before == after, f"The {operation} retry duplicated a persisted fact.")
        evidence.append({"operation": operation, "factCount": after, "retryStatus": result["status"]})
    return evidence


def inventory_plan(page: Page) -> dict:
    overview = browser_command(
        page,
        "inventory.overview",
        INVENTORY_ITEM,
        parameters={"inventoryLocationId": INVENTORY_LOCATION, "itemId": INVENTORY_ITEM, "limit": 100},
    )
    check(overview["status"] in (200, 201), f"Inventory overview failed: {overview}")
    data = overview["body"]
    item = next(value for value in data["items"] if value["id"] == INVENTORY_ITEM)
    balance = next(value for value in data["balances"] if value["inventoryItemId"] == INVENTORY_ITEM)
    mutation_id, mutation_key = new_id(), new_id()
    command = {
        "inventoryLocationId": INVENTORY_LOCATION,
        "expectedVersion": balance["version"],
        "policyFingerprint": data["policy"]["fingerprint"],
        "approvalFingerprint": None,
        "businessDate": time.strftime("%Y-%m-%d"),
        "direction": "increase",
        "quantity": {"value": 1, "scale": item["scale"], "unit": item["baseUnit"]},
        "reason": "count_correction",
        "note": None,
    }
    preview = browser_command(
        page,
        "inventory.preview",
        INVENTORY_ITEM,
        parameters={
            "mutationOperation": "inventory.adjustment",
            "mutationCommandId": mutation_id,
            "mutationIdempotencyKey": mutation_key,
            "command": command,
        },
    )
    check(preview["status"] in (200, 201), f"Inventory preview failed: {preview}")
    return {"commandId": mutation_id, "idempotencyKey": mutation_key, "command": command, "preview": preview["body"]}


def approve_inventory(page: Page, plan: dict, pin: str = MANAGER_PIN) -> dict:
    result = browser_command(
        page,
        "inventory.adjustment.approval",
        INVENTORY_ITEM,
        parameters={
            "commandFingerprint": plan["preview"]["commandFingerprint"],
            "approvalPermission": plan["preview"]["approvalPermission"],
            "managerPin": pin,
        },
    )
    return result


def run_authority_matrix(browser) -> list[dict]:
    rows: list[dict] = []

    def record(number: int, name: str, passed: bool, evidence: str) -> None:
        check(passed, f"Authority case {number} failed: {name}: {evidence}")
        rows.append({"case": number, "name": name, "evidence": evidence})

    anonymous = browser.new_context().new_page()
    anonymous.goto(DASHBOARD)
    result = browser_command(anonymous, "catalog.detail", PRODUCT, csrf="missing")
    record(1, "anonymous browser", result["status"] in (0, 401), str(result))
    anonymous.context.close()

    expired_context = browser.new_context()
    expired = expired_context.new_page()
    login(expired)
    session_id = psql(
        f"select id from runtime.dashboard_session where user_id='{OWNER_USER}' order by issued_at desc limit 1"
    )
    time.sleep(0.2)
    psql(
        f"update runtime.dashboard_session set expires_at=issued_at+interval '100 milliseconds' where id='{session_id}'",
        False,
    )
    result = browser_command(expired, "catalog.detail", PRODUCT)
    record(2, "expired session", result["status"] in (0, 401), error_text(result))
    expired_context.close()

    revoked_session_context = browser.new_context()
    revoked_session = revoked_session_context.new_page()
    login(revoked_session)
    revoked_session_id = psql(
        f"select id from runtime.dashboard_session where user_id='{OWNER_USER}' order by issued_at desc limit 1"
    )
    psql(
        f"update runtime.dashboard_session set is_active=false,revoked_at=clock_timestamp() "
        f"where id='{revoked_session_id}'",
        False,
    )
    result = browser_command(revoked_session, "catalog.detail", PRODUCT)
    check(result["status"] in (0, 401), f"A revoked session retained mutation authority: {result}")
    rows[-1]["evidence"] += "; revoked_session=" + error_text(result)
    revoked_session_context.close()

    revoked_context = browser.new_context()
    revoked = revoked_context.new_page()
    login(revoked)
    psql(f"update merchant.staff set status='disabled' where id='{OWNER_STAFF}'", False)
    result = browser_command(revoked, "catalog.detail", PRODUCT)
    record(3, "revoked membership", result["status"] in (0, 401, 403, 404), error_text(result))
    psql(f"update merchant.staff set status='active' where id='{OWNER_STAFF}'", False)
    revoked_context.close()

    context = browser.new_context()
    page = context.new_page()
    login(page)
    result = browser_command(page, "catalog.detail", PRODUCT, merchant=new_id())
    record(4, "wrong merchant", result["status"] in (403, 404), error_text(result))
    result = browser_command(page, "catalog.detail", PRODUCT, location=LOCATION_B)
    record(5, "wrong location", result["status"] == 403, error_text(result))

    permission_id = psql("select id from umi.permission where key='catalog.manage'")
    manager_context = browser.new_context()
    manager = manager_context.new_page()
    login(manager, "manager@umipos.local")
    psql(
        "insert into merchant.staff_permission_override(merchant_id,staff_id,permission_id,effect,granted_by) "
        f"values('{MERCHANT}','{MANAGER_STAFF}','{permission_id}','deny','{OWNER_USER}') "
        "on conflict(staff_id,permission_id) do update set effect='deny',expires_at=null",
        False,
    )
    result = browser_command(manager, "catalog.detail", PRODUCT)
    record(6, "missing permission", result["status"] == 403, error_text(result))
    psql(f"delete from merchant.staff_permission_override where staff_id='{MANAGER_STAFF}' and permission_id='{permission_id}'", False)
    manager_context.close()

    viewer_context = browser.new_context()
    viewer = viewer_context.new_page()
    login(viewer, "viewer@umipos.local")
    result = browser_command(viewer, "catalog.update", PRODUCT, parameters={"name": "spoof"}, target_version=1)
    record(7, "viewer mutation", result["status"] == 403, error_text(result))
    result = browser_command(
        viewer,
        "catalog.update",
        PRODUCT,
        parameters={"name": "spoof", "role": "owner"},
        target_version=1,
    )
    record(8, "role-name spoof", result["status"] == 403, error_text(result))
    viewer_context.close()

    result = browser_command(page, "catalog.detail", PRODUCT, extra={"userId": OWNER_USER})
    record(9, "client user-ID spoof", result["status"] == 400, error_text(result))
    result = browser_command(page, "catalog.detail", PRODUCT, extra={"merchantId": new_id()})
    record(10, "client merchant spoof", result["status"] == 400, error_text(result))
    result = browser_command(page, "sale.checkout", SALE)
    record(11, "POS-only command", result["status"] == 400, error_text(result))
    result = browser_command(page, "kitchen.prepare", STATION)
    record(12, "KDS-only command", result["status"] == 400, error_text(result))
    result = browser_command(page, "catalog.detail", PRODUCT, csrf="missing")
    record(13, "missing CSRF", result["status"] == 403, error_text(result))
    result = browser_command(page, "catalog.detail", PRODUCT, csrf="invalid")
    record(14, "invalid CSRF", result["status"] == 403, error_text(result))

    plan = inventory_plan(page)
    approval = approve_inventory(page, plan)
    check(approval["status"] in (200, 201), f"Approval setup failed: {approval}")
    approval_id = approval["body"].get("approvalId") or approval["body"].get("elevationId")
    command_parameters = dict(plan["command"])
    command_parameters["approvalFingerprint"] = plan["preview"]["commandFingerprint"]
    first = browser_command(
        page,
        "inventory.adjustment",
        INVENTORY_ITEM,
        parameters=command_parameters,
        command_id=plan["commandId"],
        idempotency_key=plan["idempotencyKey"],
        approval_id=approval_id,
    )
    check(first["status"] in (200, 201), f"Approval consumption failed: {first}")
    reuse = browser_command(
        page,
        "inventory.adjustment",
        INVENTORY_ITEM,
        parameters=command_parameters,
        approval_id=approval_id,
    )
    record(15, "approval reuse", reuse["status"] in (403, 409), error_text(reuse))

    expired_plan = inventory_plan(page)
    expired_approval = approve_inventory(page, expired_plan)
    expired_id = expired_approval["body"].get("approvalId") or expired_approval["body"].get("elevationId")
    psql(f"update runtime.elevation_grant set expires_at=clock_timestamp()-interval '1 second' where id='{expired_id}'", False)
    params = dict(expired_plan["command"])
    params["approvalFingerprint"] = expired_plan["preview"]["commandFingerprint"]
    result = browser_command(
        page,
        "inventory.adjustment",
        INVENTORY_ITEM,
        parameters=params,
        command_id=expired_plan["commandId"],
        idempotency_key=expired_plan["idempotencyKey"],
        approval_id=expired_id,
    )
    record(16, "expired approval", result["status"] in (403, 409), error_text(result))

    replay_id, replay_key = new_id(), new_id()
    first = browser_command(page, "catalog.detail", PRODUCT, command_id=replay_id, idempotency_key=replay_key)
    changed = browser_command(
        page,
        "catalog.detail",
        PRODUCT,
        parameters={"changed": True},
        command_id=replay_id,
        idempotency_key=replay_key,
    )
    record(17, "changed fingerprint", first["status"] in (200, 201) and changed["status"] == 409, error_text(changed))

    self_plan = inventory_plan(page)
    self_approval = approve_inventory(page, self_plan, OWNER_PIN)
    record(18, "forbidden self-approval", self_approval["status"] in (403, 409), error_text(self_approval))

    hardware_version = int(
        psql(f"select configuration_version from merchant.hardware_device where id='{HARDWARE}'")
    )
    psql(
        f"update merchant.hardware_assignment set assigned_pos_device_id=null where hardware_id='{HARDWARE}' and released_at is null",
        False,
    )
    result = browser_command(
        page,
        "hardware.diagnostic",
        HARDWARE,
        parameters={"hardwareId": HARDWARE, "expectedConfigurationVersion": hardware_version, "diagnostic": "connection_test"},
    )
    record(19, "unassigned hardware executor", result["status"] == 409, error_text(result))
    psql(
        f"update merchant.hardware_assignment set assigned_pos_device_id='{POS_DEVICE}' where hardware_id='{HARDWARE}' and released_at is null",
        False,
    )

    psql(f"update merchant.device set last_seen_at=clock_timestamp()-interval '1 hour' where id='{POS_DEVICE}'", False)
    result = browser_command(
        page,
        "hardware.diagnostic",
        HARDWARE,
        parameters={"hardwareId": HARDWARE, "expectedConfigurationVersion": hardware_version, "diagnostic": "connection_test"},
    )
    record(20, "offline hardware executor", "EXECUTION_DEVICE_UNAVAILABLE" in error_text(result), error_text(result))
    psql(f"update merchant.device set last_seen_at=clock_timestamp() where id='{POS_DEVICE}'", False)

    revoke_plan = inventory_plan(page)
    inventory_permission = psql("select id from umi.permission where key='inventory.adjust.increase'")
    psql(
        "insert into merchant.staff_permission_override(merchant_id,staff_id,permission_id,effect,granted_by) "
        f"values('{MERCHANT}','{OWNER_STAFF}','{inventory_permission}','deny','{OWNER_USER}') "
        "on conflict(staff_id,permission_id) do update set effect='deny',expires_at=null",
        False,
    )
    params = dict(revoke_plan["command"])
    result = browser_command(
        page,
        "inventory.adjustment",
        INVENTORY_ITEM,
        parameters=params,
        command_id=revoke_plan["commandId"],
        idempotency_key=revoke_plan["idempotencyKey"],
    )
    record(21, "permission revoked after preview", result["status"] == 403, error_text(result))
    psql(f"delete from merchant.staff_permission_override where staff_id='{OWNER_STAFF}' and permission_id='{inventory_permission}'", False)

    location_plan = inventory_plan(page)
    psql(f"update merchant.staff set location_id='{LOCATION_B}' where id='{OWNER_STAFF}'", False)
    result = browser_command(
        page,
        "inventory.adjustment",
        INVENTORY_ITEM,
        parameters=location_plan["command"],
        command_id=location_plan["commandId"],
        idempotency_key=location_plan["idempotencyKey"],
    )
    record(22, "location revoked after preview", result["status"] == 403, error_text(result))
    psql(f"update merchant.staff set location_id='{LOCATION_A}' where id='{OWNER_STAFF}'", False)

    same_id, same_key = new_id(), new_id()
    original = browser_command(page, "catalog.detail", PRODUCT, command_id=same_id, idempotency_key=same_key)
    same = browser_command(page, "catalog.detail", PRODUCT, command_id=same_id, idempotency_key=same_key)
    record(23, "same retry", original["status"] in (200, 201) and same["body"] == original["body"], str(same["status"]))
    conflict = browser_command(
        page,
        "catalog.detail",
        PRODUCT,
        parameters={"mutation": "changed"},
        command_id=same_id,
        idempotency_key=same_key,
    )
    record(24, "changed retry", conflict["status"] == 409, error_text(conflict))
    context.close()
    return rows


def database_evidence() -> dict:
    app_role = os.environ.get("GATE5A_APP_DATABASE_ROLE", "api_login")
    return {
        "app_role": psql(
            f"set session authorization {app_role}; select current_user||':'||"
            "(select rolbypassrls::text from pg_roles where rolname=current_user)||':'||"
            "(select rolsuper::text from pg_roles where rolname=current_user)"
        ).splitlines()[-1],
        "forced_rls_tables": int(
            psql("select count(*) from pg_class where relrowsecurity and relforcerowsecurity")
        ),
        "administrative_commands": int(
            psql(f"select count(*) from merchant.administrative_command where merchant_id='{MERCHANT}'")
        ),
        "duplicate_command_ids": int(
            psql(
                "select count(*) from (select command_id from merchant.administrative_command "
                f"where merchant_id='{MERCHANT}' group by command_id having count(*)>1) duplicate"
            )
        ),
        "consumed_approvals": int(
            psql(
                f"select count(*) from runtime.elevation_grant where merchant_id='{MERCHANT}' "
                "and consumed_at is not null"
            )
        ),
        "dashboard_context_audits": int(
            psql(
                "select count(*) from merchant.audit_event a join merchant.administrative_command c "
                "on c.merchant_id=a.merchant_id and c.command_id=a.command_id "
                f"where a.merchant_id='{MERCHANT}'"
            )
        ),
        "refunds": int(psql(f"select count(*) from merchant.pos_sale_exception where merchant_id='{MERCHANT}'")),
        "inventory_facts": int(psql(f"select count(*) from merchant.stock_ledger_entry where merchant_id='{MERCHANT}'")),
        "inventory_waste_facts": int(
            psql(
                f"select count(*) from merchant.stock_ledger_entry where merchant_id='{MERCHANT}' "
                "and entry_type='waste_recorded'"
            )
        ),
        "inventory_counts": int(psql(f"select count(*) from merchant.inventory_count where merchant_id='{MERCHANT}'")),
        "hardware_commands": int(psql(f"select count(*) from merchant.hardware_command where merchant_id='{MERCHANT}'")),
        "terminal_hardware_commands": int(
            psql(
                "select count(*) from merchant.hardware_command c where c.merchant_id='"
                f"{MERCHANT}' and exists (select 1 from merchant.hardware_command_event e "
                "where e.command_id=c.id and e.status='succeeded')"
            )
        ),
        "copy_jobs": int(psql(f"select count(*) from merchant.hardware_print_job where merchant_id='{MERCHANT}' and job_type='receipt_copy'")),
        "loyalty_facts": int(psql(f"select count(*) from merchant.loyalty_points_ledger where merchant_id='{MERCHANT}'")),
        "gift_cards": int(psql(f"select count(*) from merchant.loyalty_gift_card where merchant_id='{MERCHANT}'")),
        "raw_gift_secrets": int(
            psql(
                f"select count(*) from merchant.administrative_command where merchant_id='{MERCHANT}' "
                "and operation like 'gift_card.%' and (result ? 'deliveryToken' or result ? 'code')"
            )
        ),
        "catalog_version": int(
            psql(
                f"select max((result->>'version')::int) from merchant.administrative_command "
                f"where merchant_id='{MERCHANT}' and target_aggregate_id='{PRODUCT}' and operation='catalog.update'"
            )
        ),
        "kitchen_routes": int(psql(f"select count(*) from merchant.kitchen_route where merchant_id='{MERCHANT}'")),
    }


def main() -> None:
    phase = os.environ.get("GATE5A_CERT_PHASE", "all")
    check(phase in ("all", "walkthrough", "matrix", "evidence"), "GATE5A_CERT_PHASE is invalid.")
    source = Path(__file__).read_text(encoding="utf-8")
    check("page." + "route(" not in source, "The live suite contains a request route interceptor.")
    disposable_pilot = os.environ.get("GATE5A_DISPOSABLE_PILOT_CONFIRM") == "disposable"
    check(API != DASHBOARD or disposable_pilot, "The API and Dashboard endpoints are not distinct.")
    check(
        PG_DATABASE.startswith("umi_gate5a_") or disposable_pilot,
        "The database is not an approved disposable fixture.",
    )
    verify_tls = not disposable_pilot
    health = requests.get(f"{API}/health", timeout=5, verify=verify_tls).json()
    check(health.get("db") is True, "The API does not use PostgreSQL.")
    check(
        requests.get(DASHBOARD, timeout=5, verify=verify_tls).status_code == 200,
        "The Dashboard is unavailable.",
    )
    print(f"NO_MOCK api={API} dashboard={DASHBOARD} postgres={PG_CONTAINER}/{PG_DATABASE}")
    response_loss: list[dict] = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            headless=True,
            executable_path=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE", "/usr/bin/google-chrome"),
        )
        if phase in ("all", "walkthrough"):
            context = browser.new_context(ignore_https_errors=disposable_pilot)
            page = context.new_page()
            observed: dict[str, dict] = {}

            def observe_command(request) -> None:
                if request.method != "POST" or not request.url.endswith("/administrative-commands"):
                    return
                try:
                    body = request.post_data_json
                except Exception:
                    return
                operation = body.get("operation") if isinstance(body, dict) else None
                if isinstance(operation, str):
                    observed[operation] = body

            page.on("request", observe_command)
            login(page)
            cookies = {cookie["name"]: cookie for cookie in context.cookies()}
            check(cookies["umi_access"]["httpOnly"], "The access cookie is not httpOnly.")
            check(not cookies["umi_csrf"]["httpOnly"], "The CSRF cookie is not browser-readable.")
            check("umi_csrf=" in page.evaluate("document.cookie"), "The browser has no CSRF evidence.")
            run_positive_walkthrough(page)
            response_loss = certify_response_loss_retries(page, observed)
            context.close()
        matrix = run_authority_matrix(browser) if phase in ("all", "matrix") else []
        browser.close()
    print("AUTHORITY_MATRIX " + json.dumps(matrix, sort_keys=True))
    print("RESPONSE_LOSS_EVIDENCE " + json.dumps(response_loss, sort_keys=True))
    evidence = database_evidence()
    expected_app_role = os.environ.get("GATE5A_APP_DATABASE_ROLE", "api_login")
    check(evidence["app_role"] == f"{expected_app_role}:false:false", f"Unsafe API role: {evidence['app_role']}")
    check(evidence["forced_rls_tables"] > 0, "FORCE RLS evidence is absent.")
    check(evidence["administrative_commands"] > 20, "Persisted administrative commands are absent.")
    check(evidence["duplicate_command_ids"] == 0, "A command identity has duplicate rows.")
    check(evidence["consumed_approvals"] >= 2, "Consumed approval evidence is absent.")
    check(evidence["refunds"] == 1, f"Refund fact count is {evidence['refunds']}.")
    check(evidence["inventory_waste_facts"] >= 1, "Inventory waste evidence is absent.")
    check(evidence["inventory_counts"] >= 1, "Inventory count evidence is absent.")
    check(evidence["hardware_commands"] >= 4, "Hardware relay evidence is absent.")
    check(evidence["terminal_hardware_commands"] >= 4, "Terminal hardware evidence is absent.")
    check(evidence["copy_jobs"] >= 1, "Controlled COPY evidence is absent.")
    check(evidence["raw_gift_secrets"] == 0, "An administrative command stored a raw gift-card secret.")
    print("POSTGRESQL_EVIDENCE " + json.dumps(evidence, sort_keys=True))
    print("GATE5A_LIVE_CERTIFICATION PASS")


if __name__ == "__main__":
    main()
