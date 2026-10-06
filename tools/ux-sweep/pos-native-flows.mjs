#!/usr/bin/env node
/**
 * Real operator workflows on the native Linux POS, driven with real clicks.
 *
 * Every step here is a genuine pointer event at a screen coordinate derived
 * from the app's own accessibility tree, and every step has to prove it landed:
 * a click whose expectation does not hold fails the flow instead of being
 * counted. That is the point of the exercise — `config/ux-budgets.json` carried
 * the money path as `not-yet-instrumented` for the whole project, and a budget
 * that is never measured is a claim, not a measurement.
 *
 * See `pos-native-driver.mjs` for the coordinate mechanics and
 * `pos-native-launch.sh` for the runtime. The POS is a native application; the
 * Flutter web build is not the product and nothing here may be replaced by it
 * (`docs/architecture/2026-09-16-pos-is-a-native-app.md`).
 *
 * A cold start is the normal case, and it is the hard one. The X window is
 * mapped at (0, 0) and the window manager re-places it a few seconds later, so
 * a driver that reads the geometry once and clicks for the next two minutes is
 * aiming 35 px off: harmless for a 144 px keypad key, a miss for a 70 px table.
 * Every flow therefore waits for the surface it just opened to stop changing
 * (by content fingerprint, not by sleeping) and the driver re-derives the
 * geometry before every pointer event.
 *
 * Usage:
 *   node tools/ux-sweep/pos-native-flows.mjs
 *   node tools/ux-sweep/pos-native-flows.mjs --only money-path-pos-charge
 *   node tools/ux-sweep/pos-native-flows.mjs --no-restart --shots /tmp/ux/shots
 *
 * Options:
 *   --pin <digits>   Operator PIN (default 1234, or $UX_POS_PIN).
 *   --out <path>     JSON report (default /tmp/ux/pos-native-flows.json).
 *   --shots <dir>    Screenshot directory (default /tmp/ux/pos-native-shots/<run>).
 *   --no-restart     Attach to the running app instead of launching a clean one.
 *   --only <id>      Run a single flow.
 *
 * The money path's tap budget is three taps *after the cart* (plan §4), so the
 * sale flow is measured in two phases: building the cart, which is prelude, and
 * the charge itself, which is what the budget counts.
 */

import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDriver, sleep } from './pos-native-driver.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = join(HERE, '..', '..');

function arg(flag, fallback = null) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
}

const has = (flag) => process.argv.includes(flag);
const only = arg('--only');
const pin = String(arg('--pin', process.env.UX_POS_PIN ?? '1234'));
const outFile = arg('--out', '/tmp/ux/pos-native-flows.json');
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const shots = arg('--shots', join('/tmp/ux/pos-native-shots', runId));

const say = (line) => process.stdout.write(`${line}\n`);

/**
 * Make sure the PIN pad starts empty, and prove it.
 *
 * A restarted till restores its operator session from secure storage while the
 * operator is already typing, and an earlier failed attempt can leave digits
 * behind. Four more typed on top of those and the counter reads "8 dígitos",
 * the till answers "El PIN no es válido para esta sucursal" - which reads like
 * a permission problem and is really a half-typed PIN. Clearing is what an
 * operator does; checking the counter afterwards is what makes it certain.
 *
 * This is *getting ready*, not signing in, so the sign-in flow calls it outside
 * its measured window: an attempt that inherits a dirty pad is being charged
 * for the previous attempt's mistake.
 */
async function clearPad(driver) {
  const padValue = () =>
    driver.valueOf('PIN').then(
      (seen) => seen.value,
      () => null,
    );
  const held = await padValue();
  if (held === null || held === '0 dígitos') return false;
  const pick = async (name) =>
    (await driver.findAll(name, { actionable: true }))[0] ??
    (await driver.findAll(name))[0] ??
    null;
  const clearAll = await pick('Borrar todo');
  if (clearAll) {
    await driver
      .clickNode(clearAll, { expect: { valueChange: { name: 'PIN', from: held } }, attempts: 1 })
      .catch(() => {});
  } else {
    // No clear-all control answered: backspace once per digit, the slow way.
    const back = await pick('Borrar');
    const digits = Number.parseInt(held, 10) || 0;
    if (back) {
      for (let index = 0; index < digits; index += 1) {
        await driver
          .clickNode(back, { expect: { valueChange: { name: 'PIN' } }, attempts: 1 })
          .catch(() => {});
      }
    }
  }
  const after = await padValue();
  if (after !== null && after !== '0 dígitos') {
    throw new Error(
      `The PIN pad still holds "${after}" and could not be cleared, so typing the PIN now ` +
        'would send a PIN nobody entered.',
    );
  }
  say(`   the pad still held "${held}" from an earlier attempt; cleared it before typing`);
  return true;
}

/**
 * Type the operator PIN and get to the catalog.
 *
 * The keypad submits as soon as the PIN is long enough, so the last digit's
 * "the counter went up" check can race the screen it triggers. Each digit is
 * clicked once and never retried - a repeated digit would be a different PIN -
 * and the loop accepts "we are already on the catalog" as success at any point.
 */
async function enterPin(driver) {
  for (let pass = 1; pass <= 2; pass += 1) {
    await clearPad(driver);
    let missed = null;
    for (const digit of pin) {
      // Each digit is clicked once and never retried on its own: a repeated
      // digit would be a different PIN. The only early exit is on a *failure*,
      // and only when the catalog is already up, which means the keypad
      // submitted by itself. (Checking "are we there yet" before every digit
      // looked safe and was not: a stale frame with no nodes published made the
      // catalog look present and ended the loop after three digits.)
      try {
        await driver.clickText(digit, { expect: { valueChange: { name: 'PIN' } }, attempts: 1 });
      } catch (error) {
        // Why this can fail at all: the till restores its operator session
        // from secure storage a beat after the first frame, and that takes the
        // keypad away mid-entry. Give the catalog a longer look than the
        // default before concluding the digit really was missed - the pad can
        // be gone while the tree is momentarily empty, and a premature "no
        // catalog" verdict here sends the flow down the clear-and-retype path
        // against a screen that no longer has a pad.
        if (await waitForCatalog(driver, { timeout: 8000 })) return;
        missed = error;
        break;
      }
    }
    if (!missed) break;
    if (pass === 2) throw missed;
    // A digit that the till did not register leaves the field half-filled. Clear
    // it and type the whole PIN again, which is what an operator does, rather
    // than appending another digit to a wrong prefix. Every step here is
    // allowed to fail: the screen may have moved on, and the caller decides
    // what that means.
    say(`   a digit did not register; clearing and retyping the PIN`);
    const clear = await driver.findAll('Borrar todo', { actionable: true }).then(
      (nodes) => nodes[0],
      () => null,
    );
    if (clear) {
      // Clearing is the app's own "Borrar todo" control, and it takes the pad
      // back to zero rather than popping one digit.
      const before = await driver.valueOf('PIN').then(
        (seen) => seen.value,
        () => null,
      );
      if (before !== null) {
        await driver
          .clickNode(clear, { expect: { valueChange: { name: 'PIN', from: before } } })
          .catch(() => {});
      }
    }
    if (await waitForCatalog(driver)) return;
  }
  // The keypad has a Continuar button; if the app has already moved on, that is
  // fine too, and the catalog is the proof either way.
  try {
    await driver.clickText('Continuar', { expect: { appears: 'Comer aquí', timeout: 25000 } });
  } catch (error) {
    if (await waitForCatalog(driver)) return;
    throw error;
  }
}

/** Is a named node actually on screen right now? No waiting, no guessing. */
async function screenShows(driver, name) {
  return (await driver.findAll(name)).some((node) => driver.isVisible(node));
}

/**
 * Close the sale-complete dialog with its own "Nuevo pedido" button.
 *
 * The floating "Listo para el siguiente cliente." bar the catalog used to raise
 * over this button is gone from the product — the till shows no bottom
 * notifications at all now, and the `waitForNoSnackbar` step this file used to
 * need has gone with it. A swallowed first press is still possible for other
 * reasons, and a press that only dismissed something moves no money, so one
 * explicit second press is safe — and is what an operator does anyway.
 */
async function tapNewOrder(driver) {
  try {
    await driver.clickText('Nuevo pedido', {
      expect: { appears: 'Comer aquí', timeout: 12000 },
    });
  } catch (error) {
    say(
      `   the first "Nuevo pedido" press was swallowed (${error.message.slice(0, 60)}…); pressing again`,
    );
    await driver.clickText('Nuevo pedido', {
      expect: { appears: 'Comer aquí', timeout: 20000 },
    });
  }
}

/**
 * Empty the cart if a previous run left a line in it.
 *
 * The charge amount is not asserted, so a leftover line would not fail a budget,
 * but a sale of the wrong total is a bad thing to leave in the rehearsal data —
 * and the money path's own "add one Americano" would silently add to it.
 */
async function resetCart(driver) {
  if (await screenShows(driver, 'Abre un producto para iniciar este carrito')) return false;
  const opener = (await driver.findAll('Vaciar carrito', { actionable: true })).find((node) =>
    driver.isVisible(node),
  );
  if (!opener) return false;
  await driver.clickText('Vaciar carrito', {
    expect: { appears: '¿Vaciar este carrito?', timeout: 8000 },
  });
  const confirm = (await driver.findAll('Vaciar carrito', { actionable: true })).filter((node) =>
    driver.isVisible(node),
  );
  await driver.clickNode(confirm[confirm.length - 1], {
    expect: { appears: 'Abre un producto para iniciar este carrito', timeout: 12000 },
  });
  say('   the till was carrying a previous cart; emptied it before the sale');
  return true;
}

/**
 * Is the catalog the screen the operator is looking at?
 *
 * The lock screen is a modal drawn *over* the catalog, and the catalog's nodes
 * stay in the semantics tree underneath it. Asking only "is a cart present?"
 * therefore answered yes while the keypad was on screen, and the sign-in flow
 * returned without pressing a single digit - a pass about nothing. The keypad's
 * absence is part of the question.
 */
async function catalogIsUp(driver) {
  if (await screenShows(driver, 'Ingresa tu PIN')) return false;
  if (!(await screenShows(driver, 'Carrito actual'))) return false;
  // Confirm across two reads. A transitively empty tree makes every screen look
  // absent, and "the keypad is gone" alone was read from exactly that frame -
  // which ended the sign-in loop after three digits and reported a pass about a
  // sign-in that had not happened.
  await sleep(250);
  return (
    (await screenShows(driver, 'Carrito actual')) && !(await screenShows(driver, 'Ingresa tu PIN'))
  );
}

/** Poll for the catalog, instead of sampling it once right after an event. */
async function waitForCatalog(driver, { timeout = 8000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await catalogIsUp(driver)) return true;
    if (Date.now() > deadline) return false;
    await sleep(250);
  }
}

/**
 * Wait until one of the named screens is really on screen.
 *
 * A freshly launched app can sit on a spinner that is perfectly "stable" and
 * shows neither the keypad nor the catalog. Acting on that in-between state is
 * how a run ended up looking for an operator chip on a loading screen.
 */
async function waitForAny(driver, names, { timeout = 30000 } = {}) {
  const deadline = Date.now() + timeout;
  let recovering = false;
  for (;;) {
    for (const name of names) if (await screenShows(driver, name)) return name;
    // The till fails closed when it cannot validate itself against the API at
    // boot, and that screen offers a retry because the failure is expected to
    // be transient - a cold start killed mid-restart lands here and recovers by
    // itself. So it is waited out rather than declared fatal, and it is named
    // if the wait runs out: "none of these screens appeared" buries the reason.
    if (await screenShows(driver, 'No pudimos terminar la preparación')) {
      if (!recovering) {
        recovering = true;
        say('   the till is on its recovery screen; it re-checks by itself, waiting it out');
      }
    }
    if (Date.now() > deadline) {
      if (recovering) {
        throw new Error(
          'UmiPOS stayed on its recovery screen ("No pudimos terminar la preparación") for the ' +
            `whole ${timeout}ms: it could not validate its configuration against the API at boot. ` +
            'Check /health before blaming the workflow.',
        );
      }
      throw new Error(`None of ${names.join(', ')} appeared within ${timeout}ms.`);
    }
    await sleep(250);
  }
}

/**
 * Get to the catalog, signing in if the till is on its PIN screen.
 *
 * The destinations (Mesas, Caja) take over the whole screen and hide the bottom
 * navigation, so a flow cannot assume it starts on the catalog just because the
 * previous flow finished. Each flow states its own precondition instead.
 */
async function ensureCatalog(driver) {
  await waitForAny(
    driver,
    ['Carrito actual', 'Ingresa tu PIN', 'Atrás', 'Cerrar', 'Comanda | Pestaña', 'Nuevo pedido'],
    {
      timeout: 40000,
    },
  );
  const onCatalog = () => catalogIsUp(driver);
  if (await onCatalog()) return;
  // The sale-complete dialog stands over the catalog and hides the bottom
  // navigation, so a flow that starts right after a sale has to close it first.
  if (await screenShows(driver, 'Nuevo pedido')) {
    await driver.clickText('Nuevo pedido', {
      expect: { appears: 'Comer aquí', timeout: 20000 },
    });
    return;
  }
  if (await screenShows(driver, 'Ingresa tu PIN')) {
    await enterPin(driver);
    return;
  }
  // Any screen that still shows the bottom navigation can go straight back.
  const tab = await driver.findAll('Comanda | Pestaña', { actionable: true }).catch(() => []);
  if (tab.length) {
    await driver.clickNode(tab[0], { expect: { appears: 'Comer aquí', timeout: 15000 } });
    return;
  }
  // A full-screen destination leaves an Atrás (or a Cerrar) in its app bar, and
  // some screens publish more than one - the kitchen board has two - so each
  // candidate is tried until the catalog comes back.
  for (const label of ['Atrás', 'Cerrar']) {
    for (const candidate of await driver.findAll(label, { actionable: true })) {
      if (!driver.isVisible(candidate)) continue;
      const returned = await driver
        .clickNode(candidate, { expect: { appears: 'Comer aquí', timeout: 8000 } })
        .then(
          () => true,
          () => false,
        );
      if (returned) return;
    }
  }
  // A refused charge parks the till on its own error surface, which offers only
  // a retry; taking it returns to the tender and the normal way back reappears.
  const retry = (await driver.findAll('Reintentar', { actionable: true })).find((node) =>
    driver.isVisible(node),
  );
  if (retry) {
    await driver
      .clickNode(retry, { expect: { appears: 'Cambio', timeout: 15000 } })
      .catch(() => {});
    return ensureCatalog(driver);
  }
  throw new Error('The till is not on the catalog and offers no way back to it.');
}

/** Open the operator menu in the app bar (the control hard against the right edge). */
/**
 * Make sure this session holds an open cash shift.
 *
 * A shift belongs to the operator session that opened it, so a fresh sign-in
 * starts without one and the charge is refused with CASH_SHIFT_REQUIRED. Opening
 * the till is therefore part of the sale workflow, not a workaround: the flow
 * goes to Caja, counts the float, and opens the shift if the screen offers it.
 */
async function ensureCashShift(driver) {
  await driver.clickText('Caja | Pestaña 2 de 7', {
    expect: { appears: 'Centro de caja', timeout: 20000 },
  });
  // Wait for an ANSWER, not for the pixels to stop moving.
  //
  // This used to be `waitReady` and then one look, and the loading screen is a
  // perfectly stable tree - the spinner is the same spinner every frame - so
  // the wait could settle on it and the look would report "no shift, no float
  // form" about a screen that had not answered yet. That is exactly the trap
  // the driver's own `waitReady` comment warns about, and it failed a money
  // path this way once. The snapshot arrives after the route does, so this
  // polls for one of the two states the screen can actually be in.
  const deadline = Date.now() + 30000;
  let plus = null;
  for (;;) {
    if (await screenShows(driver, 'Turno abierto')) break;
    plus = (await driver.findAll('Aumentar cantidad'))[1];
    if (plus) break;
    if (Date.now() > deadline) {
      throw new Error('The cash center showed neither an open shift nor an opening-float form.');
    }
    await sleep(300);
  }
  const open = await screenShows(driver, 'Turno abierto');
  if (!open) {
    await driver.clickNode(plus, { expect: { appears: 'Total contado' } });
    await driver.clickText('Abrir turno de caja', {
      expect: { appears: 'Turno abierto', timeout: 25000 },
      shotName: 'cash-shift-open',
    });
  }
  await driver.clickText('Cerrar', { expect: { appears: 'Comer aquí', timeout: 15000 } });
}

/** Open the operator menu in the app bar (the control hard against the right edge). */
async function openAccountMenu(driver) {
  const candidates = (await driver.nodes()).filter(
    (node) =>
      node.actions.includes('tap') &&
      node.absolute.top < 60 &&
      node.absolute.right >= driver.viewSize.width - 1 &&
      // The operator chip is the wide one; a plain 48px icon button parked in
      // the same corner (there is one on several screens) is not the account
      // control, and clicking it opened nothing for 13 seconds.
      node.absolute.width >= 100,
  );
  const account = candidates[candidates.length - 1];
  if (!account) throw new Error('The till shows no operator control in its app bar.');
  await driver.clickNode(account, { expect: { appears: 'Cerrar sesión', timeout: 12000 } });
  return account;
}

/**
 * Lock the till so the PIN screen comes back.
 *
 * A restarted POS resumes the operator's session from secure storage, so a
 * "clean start" is not automatically a locked one. "Bloquear operador" is the
 * product's own way back to the keypad, and it is what a shift change actually
 * looks like - so the sign-in flow performs it instead of pretending the till
 * was never opened.
 */
async function lockTill(driver) {
  await openAccountMenu(driver);
  await driver.clickText('Bloquear operador', {
    expect: { appears: 'Ingresa tu PIN', timeout: 15000 },
  });
  // The lock is a route change: let the pad finish arriving before a digit is
  // typed into it, or the first key press lands on the screen being replaced.
  await driver.waitSettled({ stable: 2, timeout: 5000 });
}

/** Restart the app so every run starts from the PIN screen. */
/**
 * Relaunch the till for a clean run — unless one is already running.
 *
 * The launcher refuses to replace a running instance, because replacing one is
 * how this suite once killed another session's till mid-test (that session was
 * driving the terminal path against its own API port). The refusal travels out
 * of here as a clear sentence rather than a stack trace: the operator either
 * attaches to the running till with `--no-restart`, or takes it over with
 * `--force`, and `--force` is the only thing that kills anything.
 */
function restart({ force = false } = {}) {
  try {
    execFileSync(join(HERE, 'pos-native-launch.sh'), force ? ['--force'] : [], {
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, DISPLAY: process.env.UX_DISPLAY ?? ':0' },
    });
  } catch (error) {
    if (error.status === 2) {
      throw new Error(
        'A till is already running and this run did not take it over. Re-run with ' +
          '`--force` to replace it, or with `--no-restart` to drive the one that is up.',
      );
    }
    throw error;
  }
}

/**
 * The workflows, in the order an operator meets them.
 *
 * `budget` is the number the plan fixes where one exists and a stated
 * assumption otherwise; it is carried next to the measurement so a reviewer can
 * see both without opening a second file.
 */
const flows = [
  {
    id: 'pos-sign-in',
    label: 'Entrar al POS con el PIN del operador',
    budget: { taps: 5, ms: 15000 },
    budgetSource:
      'assumption — four PIN digits plus Continuar is the minimum a keypad sign-in can cost',
    async run(driver) {
      await driver.waitReady({ timeout: 20000 });
      await waitForAny(driver, ['Ingresa tu PIN', 'Comer aquí'], { timeout: 40000 });
      // Let the boot finish before deciding which screen this is. A restarted
      // till restores its operator session from secure storage *after* the
      // first frame, so the keypad can hand over to the catalog (or the
      // reverse) a beat later; locking on the earlier reading types the PIN
      // into a screen that is already gone.
      await driver.waitSettled({ stable: 2, timeout: 5000 });
      const onPin = await driver
        .findAll('Ingresa tu PIN')
        .then((nodes) => nodes.some((node) => driver.isVisible(node)));
      // Locking first is how an operator change actually happens, and it is
      // outside the measured budget: the flow measures the keypad sign-in.
      if (!onPin) await lockTill(driver);
      let taps = 0;
      let ms = 0;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        if (!(await screenShows(driver, 'Ingresa tu PIN'))) await lockTill(driver);
        // Getting the pad ready is not part of the sign-in being measured: a
        // dirty pad is the previous attempt's tab, not this operator's work.
        await clearPad(driver);
        const base = driver.steps.length;
        const started = Date.now();
        await enterPin(driver);
        await driver.waitFor('Comer aquí', { timeout: 25000 });
        taps = driver.steps.slice(base).filter((step) => step.action === 'click').length;
        ms += Date.now() - started;
        if (taps >= pin.length) break;
        // Fewer keypad taps than PIN digits means the till came back already
        // signed in - its stored session finished restoring mid-entry - so the
        // keypad was never actually completed. Lock it and run the operator
        // change properly rather than counting that as a sign-in.
        if (attempt === 2) {
          throw new Error(
            `The sign-in recorded only ${taps} keypad taps, fewer than the ${pin.length} PIN digits; ` +
              'the till appears to have restored a session instead of accepting the PIN.',
          );
        }
        say('   the till restored a session mid-entry; locking and starting the sign-in again');
        await lockTill(driver);
      }
      await driver.shot('signed-in-catalog');
      return {
        measured: { taps, ms },
        evidence: ['Ingresa tu PIN', 'Continuar', 'Comer aquí'],
      };
    },
  },
  {
    id: 'pos-tables-open',
    label: 'Abrir Mesas y consultar una mesa',
    budget: { taps: 4, ms: 15000 },
    budgetSource:
      'assumption — destination, table, close the detail, and back: four taps is the floor for a full-screen destination',
    async run(driver) {
      await ensureCatalog(driver);
      const base = driver.steps.length;
      const started = Date.now();
      await driver.clickText('Mesas | Pestaña 4 de 7', {
        expect: { appears: 'Plano actualizado', timeout: 20000 },
        shotName: 'floor-plan',
      });
      // Wait for the surface's own content to stop changing instead of sleeping
      // and hoping. The plan is a canvas: the document arrives, the canvas lays
      // out, the element rects move - and a press delivered into that window
      // lands on the layout that is about to be replaced. Two equal content
      // fingerprints say the rects the driver is about to aim at are the ones
      // the app is publishing now; a fixed sleep cannot say that, and it is
      // wrong in both directions (too short on a cold fetch, wasted time on a
      // warm one).
      const settled = await driver.waitSettled({ stable: 3, timeout: 10000 });
      if (!settled.stable) {
        say(`   the plan was still changing after ${settled.waitedMs}ms; probing it anyway`);
      }
      // Mesas is unreachable while the till is locked, and a lock that happens
      // on its own is a finding about the product, not a flake: report it as
      // one instead of timing out looking for a table that cannot be there.
      if (await screenShows(driver, 'Ingresa tu PIN')) {
        throw new Error(
          'The till returned to the PIN screen while Mesas was opening: the operator session ended ' +
            'mid-flow, so the destination could not render.',
        );
      }
      const tables = (await driver.nodes()).filter((node) => /^T\d+, \d+/.test(node.label || ''));
      if (!tables.length) throw new Error('The floor plan rendered no tables.');
      // The table detail is a dialog; its close button is the reliable marker,
      // since the body names the seat count only for some plans. A single tap
      // can miss on a canvas that is still laying out, so a couple of other
      // tables are tried - but only when the driver *proves* the failed tap did
      // nothing at all (`clickVerdict: 'inert'`). A tap that changed the screen
      // is never repeated, and if the plan moved under the pointer the flow
      // says so rather than blaming the product for the driver's aim.
      let opened = null;
      const attempted = [];
      for (const table of tables.slice(0, 3)) {
        try {
          await driver.clickNode(table, {
            expect: { appears: 'Cerrar', timeout: 8000 },
            shotName: 'table-detail',
          });
          opened = table;
          break;
        } catch (error) {
          const name = table.label.split(' | ')[0];
          attempted.push(`${name}: ${error.message.slice(0, 90)}`);
          say(`   ${name} did not open its detail: ${error.message.slice(0, 90)}`);
          if (error.clickVerdict === 'screen-changed') {
            throw new Error(
              `Tapping ${name} changed the screen without opening its detail, which is a finding ` +
                `about the POS rather than about the aim: ${error.message}`,
            );
          }
        }
      }
      if (!opened) {
        throw new Error(
          `None of the first ${Math.min(3, tables.length)} tables opened a detail. ` +
            `Tried: ${attempted.join(' | ')}`,
        );
      }
      await driver.clickText('Cerrar', {
        expect: { appears: 'Plano actualizado', timeout: 12000 },
      });
      await driver.clickText('Atrás', {
        expect: { appears: 'Comer aquí', timeout: 15000 },
      });
      return {
        measured: {
          taps: driver.steps.slice(base).filter((step) => step.action === 'click').length,
          ms: Date.now() - started,
        },
        evidence: [`plan drew ${tables.length} tables`, `opened ${opened.label.split(' | ')[0]}`],
      };
    },
  },
  {
    id: 'pos-tables-merge-split',
    label: 'Combinar dos mesas en una fiesta y volver a dividirla',
    // §8D step 4: merge and split are ONE gesture each. The tap floor for the
    // pair is the navigation, two table picks, the merge action and its confirm,
    // then the split action and its confirm. The taps that restore the floor
    // afterwards are housekeeping, not part of the gesture, so they are counted
    // apart below.
    budget: { taps: 9, ms: 45000 },
    budgetSource:
      'assumption — §8D step 4 asks for merge and split as one gesture each: nav, two picks, Combinar, Confirmar, then Dividir and its Confirmar. Needs owner confirmation against the reference hardware.',
    async run(driver) {
      await ensureCatalog(driver);
      const started = Date.now();
      await driver.clickText('Mesas | Pestaña 4 de 7', {
        expect: { appears: 'Plano actualizado', timeout: 20000 },
        shotName: 'floor-plan-before-merge',
      });
      const settled = await driver.waitSettled({ stable: 3, timeout: 10000 });
      if (!settled.stable) {
        say(`   the plan was still changing after ${settled.waitedMs}ms; probing it anyway`);
      }
      if (await screenShows(driver, 'Ingresa tu PIN')) {
        throw new Error(
          'The till returned to the PIN screen while Mesas was opening: the operator session ended mid-flow.',
        );
      }

      const canAct = async (name) =>
        (await driver.findAll(name, { actionable: true }).catch(() => [])).length > 0;
      const tablesNow = async () =>
        (await driver.nodes()).filter((n) => /^T\d+, /.test(n.label || ''));
      const nameOf = (node) => (node.label || '').split(',')[0];

      // Housekeeping, run whether the gesture works or not. A flow that leaves a
      // party behind makes the NEXT run fail on its precondition, which is how a
      // single flake turns into a suite that only passes on a fresh database.
      // This is also why it is a `finally`: the state the flow depends on is the
      // state it must put back.
      const restore = async () => {
        for (const table of await tablesNow()) {
          const label = table.label || '';
          if (/,\s*open/.test(label)) continue;
          try {
            await driver.clickText(nameOf(table), {
              expect: { appears: 'Cerrar', timeout: 12000 },
            });
            if (await canAct('Liberar mesa')) {
              // Releasing asks first: the action opens a confirm dialog.
              await driver.clickText('Liberar mesa', {
                expect: { appears: 'Confirmar', timeout: 12000 },
              });
              // Answering the dialog releases the party; the sheet closes with it,
              // so the map is what to wait for. `Por limpiar` is the table's word
              // on the map, not a label inside the sheet.
              await driver.clickText('Confirmar', {
                expect: { appears: 'Plano actualizado', timeout: 12000 },
              });
              if (await canAct(nameOf(table))) {
                await driver.clickText(nameOf(table), {
                  expect: { appears: 'Cerrar', timeout: 12000 },
                });
              }
            }
            if (await canAct('Mesa lista')) {
              await driver.clickText('Mesa lista', {
                expect: { appears: 'Plano actualizado', timeout: 12000 },
              });
            }
            await driver.clickText('Cerrar', {
              expect: { appears: 'Plano actualizado', timeout: 12000 },
            });
          } catch (error) {
            say(`   restoring ${nameOf(table)} stopped early: ${error.message.slice(0, 80)}`);
          }
        }
      };

      let measured = { taps: 0, ms: 0 };
      const evidence = [];
      try {
        // A table left `dirty` by an earlier run is one tap from usable, and it is
        // the flow's own mess, so it clears it rather than refusing.
        for (const table of await tablesNow()) {
          if (!/,\s*needs cleaning/.test(table.label || '')) continue;
          await driver.clickText(nameOf(table), { expect: { appears: 'Cerrar', timeout: 12000 } });
          await driver.clickText('Mesa lista', {
            expect: { appears: 'Plano actualizado', timeout: 12000 },
          });
          await driver.clickText('Cerrar', {
            expect: { appears: 'Plano actualizado', timeout: 12000 },
          });
        }

        // From here on it is the GESTURE the budget describes. Everything above
        // is setup — clearing a table an earlier run left dirty — and charging it
        // to the budget would make the number depend on the room's history
        // instead of on the operator's path. The same reason the money path
        // measures from the cart and records its prelude separately.
        const gestureFrom = driver.steps.length;
        const gestureAt = Date.now();

        // Two tables nobody is sitting at. The surface publishes the state in the
        // node's own name (`T2, 4, open`), so this reads the product rather than
        // guessing from geometry.
        const free = (await tablesNow()).filter((node) => /,\s*open/.test(node.label || ''));
        if (free.length < 2) {
          throw new Error(
            `The plan offers ${free.length} free table(s); a merge needs two, and this flow will not ` +
              'merge over a party. Release a table first.',
          );
        }
        const first = free[0];
        const second = free[1];

        await driver.clickNode(first, {
          expect: { appears: 'Cerrar', timeout: 10000 },
          shotName: 'merge-first-table',
        });
        await driver.clickText('Seleccionar', {
          expect: { appears: 'seleccionadas', timeout: 10000 },
        });
        await driver.clickNode(second, {
          expect: { appears: 'Combinar', timeout: 10000 },
          shotName: 'two-selected',
        });
        await driver.clickText('Combinar', {
          expect: { appears: 'Combinar mesas', timeout: 10000 },
        });
        await driver.clickText('Confirmar', {
          expect: { appears: 'Plano actualizado', timeout: 15000 },
          shotName: 'merged',
        });

        // Prove the merge from the product's own words, re-resolving by NAME: the
        // node captured before the merge now reads `seated`, so a stale reference
        // cannot be found and the verification would fail on a merge that worked.
        await driver.clickText(nameOf(first), {
          expect: { appears: 'Grupo de 2 mesas', timeout: 12000 },
          shotName: 'merged-group',
        });
        evidence.push(`merged ${nameOf(first)} + ${nameOf(second)} into one party`);

        await driver.clickText('Dividir', {
          expect: { gone: 'Grupo de 2 mesas', timeout: 15000 },
          shotName: 'split',
        });
        evidence.push("the sheet read 'Grupo de 2 mesas' before the split, and not after it");

        // Count OPERATOR taps, not presses. The driver presses again when it can
        // prove a press was swallowed (`retries` on the step), and that second
        // press is one tap from the operator's side; charging the budget for the
        // instrument's own recovery would make a flaky driver look like a
        // product that got harder to use. The driver also exposes the whole
        // press count on the report, so nothing is hidden by this.
        const presses = driver.steps.slice(gestureFrom).filter((step) => step.action === 'click');
        const taps = presses.reduce((total, step) => total + 1 - (step.retries?.length ?? 0), 0);
        measured = { taps, ms: Date.now() - gestureAt };
      } finally {
        await restore();
        await driver
          .clickText('Atrás', { expect: { appears: 'Comer aquí', timeout: 15000 } })
          .catch(() => {});
      }

      evidence.push(`${measured.taps} taps for the whole merge-then-split cycle`);
      return { measured, evidence };
    },
  },
  {
    id: 'money-path-pos-charge',
    label: 'Cobrar una venta en el POS, después del carrito',
    // The plan's own number: three taps or fewer *after the cart*.
    budget: { taps: 3, ms: 12000 },
    budgetSource:
      "plan §4 — 'the money path holds at three taps or fewer after the cart' (taps agreed; milliseconds an assumption)",
    // Only the charge phase counts towards the budget; the prelude is recorded
    // so the cart's real cost is visible without being charged to the metric.
    measuredAfterPrelude: true,
    async run(driver) {
      await ensureCatalog(driver);
      await ensureCashShift(driver);
      await resetCart(driver);
      // ---- prelude: build a cart -------------------------------------------
      await driver.clickText('Americano  ·  MXN 55.00', {
        expect: { appears: 'Modificadores', timeout: 15000 },
        shotName: 'product-modifiers',
      });
      await driver.clickText('CH', { expect: { appears: 'CH' } });
      await driver.clickText('Caliente', { expect: { appears: 'Caliente' } });
      await driver.clickText('Normal', { expect: { appears: 'Normal' } });
      await driver.clickText('Agregar al carrito', {
        expect: { gone: 'Abre un producto para iniciar este carrito', timeout: 20000 },
        shotName: 'cart-with-line',
      });
      const preludeSteps = driver.steps.length;
      const preludeClicks = driver.steps.filter((step) => step.action === 'click').length;
      const preludeMs = driver.steps.reduce((total, step) => total + (step.ms ?? 0), 0);
      const chargeStarted = Date.now();

      // ---- the measured phase ----------------------------------------------
      await driver.clickText('Cobrar', {
        expect: { appears: 'Selección de pago', timeout: 15000 },
        shotName: 'tender',
      });
      await driver.clickText('Importe exacto', {
        expect: { appears: 'Cambio', timeout: 12000 },
      });
      const confirm = await driver.scrollToFind('Cobrar · MXN');
      if (!confirm) throw new Error('The tender screen never offered a charge button.');
      await driver.clickNode(confirm, {
        // NOT "Cambio a dar": this sale is paid with Importe exacto, so there is
        // no change to give back, and the completion screen deliberately shows
        // the change block only when change is owed. "Pagado" is the fact that
        // is true of every completed sale, which is what this step is asserting.
        expect: { appears: 'Pagado', timeout: 25000 },
        shotName: 'sale-complete',
      });
      // Measure the charge itself, before the housekeeping tap below: plan §4
      // counts the taps from the cart to a paid sale, and clearing the till for
      // the next run is not one of them.
      const charged = driver.steps
        .slice(preludeSteps)
        .filter((step) => step.action === 'click').length;
      const chargeMs = Date.now() - chargeStarted;
      const paid = (await driver.nodes())
        .map((node) => node.label || '')
        .find((name) => /^Pagado/.test(name));
      // Leave the till on a fresh cart so the next run starts clean.
      await tapNewOrder(driver);
      return {
        measured: { taps: charged, ms: chargeMs },
        evidence: [paid ?? 'charge confirmed', `${preludeClicks} prelude taps (not budgeted)`],
        prelude: { taps: preludeClicks, ms: preludeMs },
        chargedSteps: charged,
      };
    },
  },
  {
    id: 'tender-keypad-follows-cash',
    label: 'El teclado numérico se va con el efectivo y vuelve con él',
    // Not a money path and not budgeted: this measures a surface. The digits
    // are counted instead of the keypad being looked for by name, because a
    // name search here is ambiguous - "1".."9" are the labels of the keys and
    // the substrings of every amount on the bill.
    async run(driver) {
      await ensureCatalog(driver);
      await ensureCashShift(driver);
      await resetCart(driver);
      await driver.clickText('Americano  ·  MXN 55.00', {
        expect: { appears: 'Modificadores', timeout: 15000 },
      });
      await driver.clickText('CH', { expect: { appears: 'CH' } });
      await driver.clickText('Caliente', { expect: { appears: 'Caliente' } });
      await driver.clickText('Normal', { expect: { appears: 'Normal' } });
      await driver.clickText('Agregar al carrito', {
        expect: { gone: 'Abre un producto para iniciar este carrito', timeout: 20000 },
      });
      await driver.clickText('Cobrar', {
        expect: { appears: 'Selección de pago', timeout: 15000 },
        shotName: 'tender-cash-face',
      });
      // Precondition: the sheet opened on the cash face. If it did not, the state
      // this flow asserts about is not the state it is looking at.
      //
      // This check has already earned its place. A cart outlives a run and a
      // checkout draft is keyed by the cart, so a draft an earlier session left
      // behind is recovered into the NEXT checkout of that cart - terminal
      // tender, stale status and all. Observed for real: the sheet opened with
      // the card already selected and the keypad still up, so the flow's first
      // tap DESELECTED the terminal and the surface never swapped, which reads
      // like a broken swap and is really a stale draft. Reported here, by name.
      await driver.waitFor('Efectivo recibido', { timeout: 8000 });

      const digitKeys = async () =>
        (await driver.nodes()).filter((node) => /^[0-9]$/.test(String(node.label ?? '').trim()))
          .length;
      // "Importe aplicado" is the terminal block's own field, so its presence is
      // the terminal being on - the tile's selected state is drawn, not published.
      const terminalOn = () => screenShows(driver, 'Importe aplicado');

      const onCash = await digitKeys();
      if (onCash < 10 || (await terminalOn())) {
        throw new Error(
          `The sheet did not open on cash alone (${onCash} digit keys, terminal ` +
            `${(await terminalOn()) ? 'on' : 'off'}), so the swap cannot be judged from here.`,
        );
      }

      // The press is allowed one repeat, and only on proof that it did nothing.
      //
      // A press delivered just after the sheet's route animation has been seen to
      // do NOTHING at all, and the driver then refuses its own retry: activating
      // the window (which every click does first) moves the accessibility focus,
      // and the driver's screen fingerprint reads that as "the press had an
      // effect". The money-path flow carries the same lesson for "Nuevo pedido"
      // and presses again; here the repeat is licensed by the tender's own state
      // rather than by a guess - the terminal is still off, so no method has been
      // selected and pressing again cannot double anything.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await driver.clickText('Terminal manual', {
            expect: { appears: 'Cobro en terminal', timeout: 12000 },
            shotName: 'tender-terminal-face',
          });
          break;
        } catch (error) {
          // The press did land and only the expectation was judged late.
          if (await terminalOn()) break;
          if (attempt >= 2) throw error;
          say('   the tile press did nothing and the terminal is still off; pressing once more');
        }
      }

      const onTerminal = await digitKeys();
      if (onTerminal !== 0) {
        throw new Error(
          `The keypad stayed on the card face: ${onTerminal} digit keys are still published, ` +
            'so the surface did not swap with the tender.',
        );
      }
      await driver.clickText('Efectivo', {
        expect: { appears: 'Cambio', timeout: 12000 },
        shotName: 'tender-cash-again',
      });
      const backOnCash = await digitKeys();
      if (backOnCash < 10) {
        throw new Error(
          `Going back to cash published ${backOnCash} digit keys; the keypad did not come back.`,
        );
      }
      // Leave the till out of the sheet, on the catalog, which is where the next
      // flow expects to find it. "Nuevo pedido" is the receipt dialog's own
      // button and there is no sale here to dismiss, so this closes the sheet.
      await driver.clickText('Cerrar', {
        expect: { appears: 'Comer aquí', timeout: 15000 },
      });
      return {
        evidence: [
          `efectivo: ${onCash} teclas numéricas`,
          'terminal: 0 teclas, «Cobro en terminal» y la declaración del operador en pantalla',
          `efectivo otra vez: ${backOnCash} teclas numéricas`,
        ],
      };
    },
  },
  {
    id: 'tender-split-is-a-decision',
    label: 'Un segundo método reemplaza al primero; solo «Dividir el pago» lo suma',
    // A surface check, not a money path: this flow exists to prove that a
    // divided check cannot happen by accident. It needs a location whose policy
    // allows mixed tender (`mixed_tender_enabled` true, `maximum_tender_lines`
    // above 1); on a one-method location the control is deliberately absent and
    // this flow is not the one that runs.
    async run(driver) {
      await ensureCatalog(driver);
      await ensureCashShift(driver);
      await resetCart(driver);
      await driver.clickText('Americano  ·  MXN 55.00', {
        expect: { appears: 'Modificadores', timeout: 15000 },
      });
      await driver.clickText('CH', { expect: { appears: 'CH' } });
      await driver.clickText('Caliente', { expect: { appears: 'Caliente' } });
      await driver.clickText('Normal', { expect: { appears: 'Normal' } });
      await driver.clickText('Agregar al carrito', {
        expect: { gone: 'Abre un producto para iniciar este carrito', timeout: 20000 },
      });
      await driver.clickText('Cobrar', {
        expect: { appears: 'Selección de pago', timeout: 15000 },
        shotName: 'split-01-tender-opens-on-cash',
      });
      await driver.waitFor('Efectivo recibido', { timeout: 8000 });

      const digitKeys = async () =>
        (await driver.nodes()).filter((node) => /^[0-9]$/.test(String(node.label ?? '').trim()))
          .length;
      const splitReading = () => screenShows(driver, 'Cobro dividido');

      // 1. A second method REPLACES the first. This is the whole point: before
      //    this rule, tapping Terminal manual beside cash built a 50/50 split
      //    nobody asked for, and the charge that followed carried two legs the
      //    operator never chose. This much holds at EVERY location, whatever
      //    its policy says about mixed tender.
      await driver.clickText('Terminal manual', {
        expect: { appears: 'Cobro en terminal', timeout: 12000 },
        shotName: 'split-02-second-method-replaces',
      });
      const replacedKeys = await digitKeys();
      if (replacedKeys !== 0) {
        throw new Error(
          `The keypad stayed up with ${replacedKeys} digit keys after the terminal replaced ` +
            'cash, so the second method did not replace the first.',
        );
      }
      if (await splitReading()) {
        throw new Error(
          'Tapping a second method produced a split reading. A divided check must be asked ' +
            'for, never inferred from a tap.',
        );
      }

      // 2. Whether a split is even possible here is the LOCATION'S POLICY, read
      //    over the API when the sheet opens, so the control arrives a beat
      //    after the cash face does. Waiting is the honest way to read that: a
      //    snapshot on the first frame cannot tell "this location forbids a
      //    split" from "the answer is still in flight", and those are opposite
      //    conclusions. Both answers are correct behaviour, so the flow checks
      //    whichever one this location gives instead of demanding one of them.
      let splitOffered = true;
      try {
        await driver.waitFor('Dividir el pago', { timeout: 10000 });
      } catch {
        splitOffered = false;
      }
      if (!splitOffered) {
        // One method per sale, and the screen has to SAY so — otherwise a
        // missing control reads as a missing feature rather than a rule.
        if (!(await screenShows(driver, 'Esta sucursal cobra con un solo método por venta.'))) {
          throw new Error(
            'This location offers no «Dividir el pago» control and says nothing about why; ' +
              'the operator is left to guess whether the rule is a rule.',
          );
        }
        await driver.clickText('Cerrar', {
          expect: { appears: 'Comer aquí', timeout: 15000 },
          shotName: 'split-05-one-method-location',
        });
        return {
          evidence: [
            'un segundo método reemplazó a efectivo: 0 teclas numéricas, sin «Cobro dividido»',
            'esta sucursal cobra un solo método: sin «Dividir el pago», y la pantalla lo dice',
          ],
          splitOffered: false,
        };
      }

      // 3. The operator asks for it. With one method on the sale the reading
      //    names the next step rather than leaving the control's effect to guess.
      await driver.clickText('Dividir el pago', {
        expect: { appears: 'Elige el segundo método de pago.', timeout: 12000 },
        shotName: 'split-03-armed',
      });

      // 4. NOW the cash joins, and the keypad comes back with it: the cashier
      //    still has to take the cash and read the change. The expectation is
      //    the NUMBERED LEGS, not the notice's own title: "Cobro dividido" is
      //    already on screen from step 3, so waiting for it would pass before
      //    the second method ever landed.
      await driver.clickText('Efectivo', {
        expect: { appears: '1. Efectivo:', timeout: 12000 },
        shotName: 'split-04-both-legs',
      });
      if (!(await screenShows(driver, '2. Terminal manual:'))) {
        throw new Error(
          'The split reading named the cash leg but not the terminal leg, so the sale is not ' +
            'actually divided.',
        );
      }
      const splitKeys = await digitKeys();
      if (splitKeys < 10) {
        throw new Error(
          `A cash + terminal split published ${splitKeys} digit keys; the cashier cannot take ` +
            'the cash without the keypad.',
        );
      }

      // 5. Undoing it goes back to one method, and the reading goes with it.
      await driver.clickText('Un solo método', {
        expect: { gone: 'Cobro dividido', timeout: 12000 },
        shotName: 'split-05-back-to-one',
      });

      await driver.clickText('Cerrar', {
        expect: { appears: 'Comer aquí', timeout: 15000 },
      });
      return {
        evidence: [
          'un segundo método reemplazó a efectivo: 0 teclas numéricas, sin «Cobro dividido»',
          '«Dividir el pago» nombra el paso siguiente cuando solo hay un método',
          `dividido: ${splitKeys} teclas numéricas y las dos partes en «Cobro dividido»`,
          '«Un solo método» devolvió la venta a un método y retiró el resumen',
        ],
        splitOffered: true,
      };
    },
  },
  {
    id: 'pos-restart-recovery',
    label: 'Reiniciar el POS a mitad del turno y cobrar sin retipear nada',
    // The charge after a restart is the same money path, so it holds to the same
    // number; the restart and the sign-in are prelude and are measured apart.
    budget: { taps: 3, ms: 12000 },
    budgetSource:
      'plan §4 — the money path is three taps or fewer after the cart, and a restart must not add one. The restart and sign-in are prelude.',
    measuredAfterPrelude: true,
    async run(driver) {
      await ensureCatalog(driver);
      // Open a shift on this session first, so the restart has something real to
      // orphan. A shift belongs to the session that opened it: the restart mints
      // a new session, and the drawer is then held by this device under a session
      // that is gone — the exact shape that used to answer CASH_SHIFT_REQUIRED.
      await ensureCashShift(driver);

      // ---- prelude: kill the app and bring it back mid-shift ---------------
      say('   killing the native POS mid-shift and relaunching it');
      // This flow's whole subject is a restart, and it has just stopped the app
      // itself, so taking the window over here is the point rather than a risk.
      restart({ force: true });
      await driver.reconnect();
      await waitForAny(driver, ['Ingresa tu PIN', 'Comer aquí'], { timeout: 60000 });
      await driver.waitSettled({ stable: 2, timeout: 8000 });
      // Sign in for real. A restart that merely restores the stored durable
      // session reuses its operator session, so the shift still matches and the
      // defect cannot appear — the mismatch comes from a PIN sign-in, which mints
      // a new operator session (`startOperator` only reuses an identical durable
      // session). "Bloquear operador" is the product's own way to the keypad and
      // is what a shift handover actually looks like.
      if (!(await screenShows(driver, 'Ingresa tu PIN'))) await lockTill(driver);
      await enterPin(driver);
      await driver.waitFor('Comer aquí', { timeout: 30000 });
      // The recovery the till is supposed to have done by itself: no operator
      // tap said "resume". Prove the shift came back before spending taps on a
      // charge that would otherwise fail for the reason this flow exists.
      await driver.clickText('Caja | Pestaña 2 de 7', {
        expect: { appears: 'Centro de caja', timeout: 20000 },
      });
      // Wait for the screen to ANSWER, not for the pixels to stop moving. The
      // loading view is a stable spinner, so `waitReady` settles on it and the
      // reads below then report "the till did not recover its own shift" about a
      // screen that has not replied yet - which is what this flow did, with its
      // own failure screenshot showing the spinner. The snapshot lands after the
      // route does, so this waits for one of the states the screen can be in.
      const loaded = async () =>
        (await screenShows(driver, 'Turno abierto')) ||
        (await screenShows(driver, 'Reanudar turno')) ||
        (await screenShows(driver, 'Abrir turno de caja')) ||
        (await screenShows(driver, 'Aumentar cantidad'));
      const answeredBy = Date.now() + 30000;
      while (!(await loaded()) && Date.now() < answeredBy) await sleep(300);
      const recovered = await screenShows(driver, 'Turno abierto');
      // The Caja screen offers "Reanudar turno" exactly while the server reports
      // the operator-session mismatch (`recoveryState == 'operator_mismatch'`).
      // Its absence is the proof that the till already did the resume by itself
      // rather than merely rendering a shift that is open. ("Reintentar" is not
      // that evidence: it is the Cash Center's own refresh button and is always
      // on the screen.)
      const stillOffersResume = await screenShows(driver, 'Reanudar turno');
      await driver.shot('post-restart-cash-center');
      if (!recovered || stillOffersResume) {
        throw new Error(
          'After the restart the Caja screen did not show the shift as open by itself' +
            (stillOffersResume ? ' and was still offering "Reanudar turno"' : '') +
            ': the till did not recover its own shift.',
        );
      }
      await driver.clickText('Cerrar', { expect: { appears: 'Comer aquí', timeout: 15000 } });

      await resetCart(driver);
      // ---- prelude: build a cart -------------------------------------------
      await driver.clickText('Americano  ·  MXN 55.00', {
        expect: { appears: 'Modificadores', timeout: 15000 },
      });
      await driver.clickText('CH', { expect: { appears: 'CH' } });
      await driver.clickText('Caliente', { expect: { appears: 'Caliente' } });
      await driver.clickText('Normal', { expect: { appears: 'Normal' } });
      await driver.clickText('Agregar al carrito', {
        expect: { gone: 'Abre un producto para iniciar este carrito', timeout: 20000 },
      });
      const preludeSteps = driver.steps.length;
      const preludeClicks = driver.steps.filter((step) => step.action === 'click').length;
      const preludeMs = driver.steps.reduce((total, step) => total + (step.ms ?? 0), 0);
      const chargeStarted = Date.now();

      // ---- the measured phase: the charge must go through ------------------
      await driver.clickText('Cobrar', {
        expect: { appears: 'Selección de pago', timeout: 15000 },
      });
      await driver.clickText('Importe exacto', {
        expect: { appears: 'Cambio', timeout: 12000 },
      });
      const confirm = await driver.scrollToFind('Cobrar · MXN');
      if (!confirm) throw new Error('The tender screen never offered a charge button.');
      await driver.clickNode(confirm, {
        // Same as the money path: an exact-cash sale owes no change, so the
        // completion screen's change block is absent by design and "Pagado" is
        // the sentence that is always true of a completed sale.
        expect: { appears: 'Pagado', timeout: 30000 },
        shotName: 'post-restart-sale-complete',
      });
      const charged = driver.steps
        .slice(preludeSteps)
        .filter((step) => step.action === 'click').length;
      const chargeMs = Date.now() - chargeStarted;
      const paid = (await driver.nodes())
        .map((node) => node.label || '')
        .find((name) => /^Pagado/.test(name));
      await tapNewOrder(driver);
      return {
        measured: { taps: charged, ms: chargeMs },
        evidence: [
          paid ?? 'charge confirmed',
          'shift recovered by the till itself after the restart',
          `${preludeClicks} prelude taps (restart, sign-in, cart — not budgeted)`,
        ],
        prelude: { taps: preludeClicks, ms: preludeMs },
        chargedSteps: charged,
      };
    },
  },
];

async function main() {
  const chosen = only ? flows.filter((flow) => flow.id === only) : flows;
  const selected = await withBudgets(chosen);
  if (!selected.length) throw new Error(`No flow matches --only ${only}.`);
  await mkdir(shots, { recursive: true });

  if (!has('--no-restart')) {
    say(`restarting the native POS for a clean run (log: /tmp/umi-pos-linux.log)`);
    restart({ force: has('--force') });
  }

  const driver = await createDriver({ shots, say });
  say(
    `vm      ${driver.connection.base}\n` +
      `view    ${driver.origin.width}x${driver.origin.height} at (${driver.origin.x}, ${driver.origin.y}) ` +
      `inside frame ${driver.facts.frame.width}x${driver.facts.frame.height}\n` +
      `shots   ${shots}\n`,
  );

  const results = [];
  for (const flow of selected) {
    say(`\n== ${flow.id} — ${flow.label}`);
    const firstStep = driver.steps.length;
    const started = Date.now();
    let status = 'instrumented';
    let failure = null;
    let evidence = [];
    let extra = {};
    try {
      const outcome = await flow.run(driver);
      evidence = outcome.evidence ?? [];
      extra = outcome;
    } catch (error) {
      status = 'failed';
      failure = error.message;
    }
    const ms = Date.now() - started;
    const taps = driver.steps.slice(firstStep).filter((step) => step.action === 'click').length;
    // A flow that states its own measurement wins: the tables flow excludes the
    // taps it spent getting back to the catalog, and the money path counts only
    // the three taps after the cart, which is what plan §4 fixes.
    const measured = extra.measured ?? { taps, ms };
    // A flow with no budget asserts a SURFACE, not a cost. Reporting it as "over
    // budget" against a number nobody agreed would be inventing a claim, and
    // dropping it from the report would hide a flow that ran; so it is reported
    // with no budget and the pass/fail gate skips the comparison it cannot make.
    const overBudget = flow.budget
      ? { taps: measured.taps > flow.budget.taps, ms: measured.ms > flow.budget.ms }
      : null;
    results.push({
      id: flow.id,
      label: flow.label,
      surface: 'umi-pos',
      status,
      failure,
      budget: flow.budget,
      budgetSource: flow.budgetSource,
      measured,
      steps: taps,
      allClicks: driver.steps.length - firstStep,
      overBudget,
      prelude: extra.prelude ?? null,
      evidence,
    });
    say(
      `   ${status === 'instrumented' ? 'ok' : 'FAILED'} — ${measured.taps} taps, ${measured.ms}ms ` +
        (flow.budget
          ? `(budget ${flow.budget.taps} taps / ${flow.budget.ms}ms)`
          : '(no budget: this flow is a surface check)') +
        `${failure ? `\n   ${failure}` : ''}`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    surface: 'umi-pos-native-linux',
    runtime: 'flutter run -d linux --debug',
    vmService: driver.connection.base,
    window: {
      frame: driver.facts.frame,
      extents: driver.facts.extents,
      viewOrigin: { x: driver.origin.x, y: driver.origin.y },
      // More than one is a warning, not a pass: see the driver's guard.
      count: driver.facts.windowCount ?? 1,
    },
    // Every time the X frame moved after the driver attached, with the origin
    // it moved to. A non-empty list is not an error - the window manager
    // re-places the window seconds after it is mapped - but it is the evidence
    // that the driver re-measured rather than clicking where the window used to
    // be, and it is what a reader needs to reconstruct an unexpected click.
    windowMoves: driver.originDrift,
    viewSize: driver.viewSize,
    shots,
    flows: results,
    passed: results.every(
      (flow) => flow.status === 'instrumented' && !flow.overBudget?.taps && !flow.overBudget?.ms,
    ),
  };
  await mkdir(dirname(outFile), { recursive: true });
  await writeFile(outFile, `${JSON.stringify(report, null, 2)}\n`);
  say(`\nwrote ${outFile}`);
  say(`passed: ${report.passed}`);
  process.exitCode = report.passed ? 0 : 1;
}

/**
 * Take the budgets from `config/ux-budgets.json`.
 *
 * One source of truth: the numbers the plan argues about live in the config
 * file, and the defaults written next to each flow are only a fallback for
 * running this script with the file missing.
 */
async function withBudgets(flowsToRun) {
  let configured = {};
  try {
    const config = JSON.parse(await readFile(join(WORKSPACE, 'config/ux-budgets.json'), 'utf8'));
    configured = Object.fromEntries((config.nativeFlows ?? []).map((flow) => [flow.id, flow]));
  } catch {
    say('config/ux-budgets.json is unreadable; using the budgets written into this file');
  }
  return flowsToRun.map((flow) => ({
    ...flow,
    budget: configured[flow.id]?.budget ?? flow.budget,
    budgetSource: configured[flow.id]?.budgetSource ?? flow.budgetSource,
  }));
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});
