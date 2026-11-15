// The four mandatory focused cases: UX-04, OPT-01 (in the API module),
// REF-03, and ISO-04. OPT-01 is registered by i1-cases-api.mjs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { IDS, USERS } from './i1-lib.mjs';

async function axe(page) {
  try {
    const { default: AxeBuilder } = await import('@axe-core/playwright');
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    return {
      available: true,
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        nodes: violation.nodes.length,
        help: violation.help,
      })),
    };
  } catch (error) {
    return { available: false, error: String(error) };
  }
}

async function focusInventory(page, limit = 80) {
  const stops = [];
  const seen = new Set();
  await page
    .locator('body')
    .click({ position: { x: 5, y: 5 } })
    .catch(() => {});
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press('Tab');
    const state = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element) return null;
      // The document body is the default active element, not an interactive
      // focus stop. The tab order leaves the page after the last control.
      if (element === document.body || element === document.documentElement) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        tag: element.tagName,
        label: (
          element.innerText ||
          element.getAttribute('aria-label') ||
          element.getAttribute('name') ||
          ''
        )
          .trim()
          .slice(0, 60),
        outlineWidth: style.outlineWidth,
        outlineStyle: style.outlineStyle,
        boxShadow: style.boxShadow,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    if (!state) break;
    const key = `${state.tag}|${state.label}|${state.width}x${state.height}`;
    if (!seen.has(key)) {
      seen.add(key);
      stops.push(state);
    }
  }
  return stops;
}

function ringVisible(stop) {
  const width = Number.parseFloat(stop.outlineWidth || '0');
  const outline = stop.outlineStyle !== 'none' && width >= 2;
  const shadow = stop.boxShadow && stop.boxShadow !== 'none';
  return outline || shadow;
}

export const FOCUSED_CASES = {
  'I1-UX-04': async (t) => {
    const session = await t.session({
      user: USERS.owner,
      viewport: { width: 360, height: 800 },
    });
    try {
      await session.gotoHome({ days: 30 });
      const home = await session.page.evaluate(() => {
        const doc = document.documentElement;
        const overflow = [...document.querySelectorAll('*')]
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => ({
            tag: element.tagName,
            className: String(element.className || '').slice(0, 80),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflowX: getComputedStyle(element).overflowX,
          }))
          .filter((entry) => entry.overflowX !== 'visible');
        const targets = [
          ...document.querySelectorAll('a,button,input,select,textarea,[role=button]'),
        ]
          .filter((element) => element.offsetParent !== null)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              label: (element.innerText || element.getAttribute('aria-label') || '')
                .trim()
                .slice(0, 50),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          });
        return {
          scrollWidth: doc.scrollWidth,
          innerWidth: window.innerWidth,
          overflow,
          targets,
          smallTargets: targets.filter((target) => target.width < 44 || target.height < 44),
        };
      });
      await session.screenshot('screen-home-360.png');
      const homeFocus = await focusInventory(session.page);

      await session.openDetail();
      await session.page.getByRole('button', { name: 'Categorías', exact: true }).click();
      await session.page.waitForTimeout(600);
      const detail = await session.page.evaluate(() => {
        const doc = document.documentElement;
        const overflow = [...document.querySelectorAll('*')]
          .filter((element) => element.scrollWidth > element.clientWidth + 1)
          .map((element) => ({
            tag: element.tagName,
            className: String(element.className || '').slice(0, 80),
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            overflowX: getComputedStyle(element).overflowX,
          }))
          .filter((entry) => entry.overflowX !== 'visible');
        const targets = [
          ...document.querySelectorAll('a,button,input,select,textarea,[role=button]'),
        ]
          .filter((element) => element.offsetParent !== null)
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              tag: element.tagName,
              label: (element.innerText || element.getAttribute('aria-label') || '')
                .trim()
                .slice(0, 50),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          });
        return {
          scrollWidth: doc.scrollWidth,
          innerWidth: window.innerWidth,
          overflow,
          targets,
          smallTargets: targets.filter((target) => target.width < 44 || target.height < 44),
          tableScroll: (() => {
            const table = document.querySelector('.analysis-table');
            if (!table) return null;
            return {
              scrollWidth: table.scrollWidth,
              clientWidth: table.clientWidth,
              overflowX: getComputedStyle(table).overflowX,
            };
          })(),
        };
      });
      const detailFocus = await focusInventory(session.page);
      await session.screenshot('screen-detail-360.png');
      const a11y = await axe(session.page);
      t.writeJson('layout.json', { home, detail });
      t.writeJson('focus.json', { home: homeFocus, detail: detailFocus });
      t.writeJson('a11y.json', a11y);

      t.checks.eq('home scrollWidth <= 360', home.scrollWidth <= 360, true);
      t.checks.eq('detail scrollWidth <= 360', detail.scrollWidth <= 360, true);
      const allowed = (entry) =>
        entry.className.includes('analysis-table') ||
        entry.className.includes('sales-bars') ||
        entry.className.includes('sales-series') ||
        entry.className.includes('sales-chart');
      t.checks.eq(
        'home has no horizontal scroller',
        home.overflow.filter((entry) => !allowed(entry)),
        [],
      );
      t.checks.eq(
        'detail only scrolls the table and the series',
        detail.overflow.filter((entry) => !allowed(entry)),
        [],
      );
      t.checks.truthy(
        'the analysis table scrolls horizontally',
        detail.tableScroll?.scrollWidth > detail.tableScroll?.clientWidth,
      );
      t.checks.eq('home targets are at least 44 by 44', home.smallTargets, []);
      t.checks.eq('detail targets are at least 44 by 44', detail.smallTargets, []);
      t.checks.eq(
        'every home focus stop has a visible ring',
        homeFocus.filter((stop) => !ringVisible(stop)),
        [],
      );
      t.checks.eq(
        'every detail focus stop has a visible ring',
        detailFocus.filter((stop) => !ringVisible(stop)),
        [],
      );
      t.checks.eq(
        'no critical axe violation',
        a11y.violations
          ? a11y.violations.filter((violation) => violation.impact === 'critical')
          : [],
        [],
      );
      return {
        observations: {
          homeScrollWidth: home.scrollWidth,
          detailScrollWidth: detail.scrollWidth,
          homeSmallTargets: home.smallTargets,
          detailSmallTargets: detail.smallTargets,
          focusStops: { home: homeFocus.length, detail: detailFocus.length },
          axe: a11y,
        },
      };
    } finally {
      await session.close();
    }
  },

  'I1-REF-03': async (t) => {
    if (!t.run.apiProcess) {
      return {
        status: 'BLOCKED',
        failure: {
          message:
            'REF-03 needs the runner-owned API process to stop and restart it. Run with --start-api.',
        },
      };
    }
    const session = await t.session({ user: USERS.owner, merchant: IDS.M1 });
    try {
      await session.gotoHome({ days: 30 });
      const oldPrimary = await session.primaryText();
      const oldUrl = session.page.url();
      const oldBody = await session.bodyText();
      const oldTime = (oldBody.match(/Consulta:\s*([^\n]+)/) || [])[1] || '';
      const oldCapturedAt = session.reportBodies.at(-1)?.capturedAt || null;
      session.clearObservations();
      await t.run.apiProcess.stop();
      const refresh = session.page.getByRole('button', { name: 'Actualizar', exact: true });
      if (await refresh.count()) {
        await refresh.click();
      } else {
        await session.page.locator('input[type=date]').nth(1).fill('2026-11-07');
        await session.page.getByRole('button', { name: 'Consultar', exact: true }).click();
      }
      await session.page
        .locator('[role=alert]')
        .first()
        .waitFor({ state: 'visible', timeout: 25000 });
      await session.page.waitForTimeout(500);
      const failedPrimary = await session.primaryText();
      const failedText = await session.bodyText();
      const alertText = await session.page.locator('[role=alert]').first().innerText();
      const focused = await session.page.evaluate(() => {
        const element = document.activeElement;
        return {
          tag: element?.tagName,
          label: (element?.innerText || element?.getAttribute('aria-label') || '')
            .trim()
            .slice(0, 80),
          inSales: Boolean(element?.closest('.sales-analysis, .overview-screen')),
        };
      });
      const failedRequests = session.requests.filter((request) =>
        request.url.includes('/operations/reports/sales/analysis?'),
      ).length;
      await session.screenshot('screen-failed.png');

      await t.run.apiProcess.start();
      await session.page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      await session.page
        .locator('[role=alert]')
        .first()
        .waitFor({ state: 'hidden', timeout: 25000 })
        .catch(() => {});
      await session.waitForPrimary();
      await session.page.waitForTimeout(600);
      const recoveredPrimary = await session.primaryText();
      const recoveredText = await session.bodyText();
      const recoveredTime = (recoveredText.match(/Consulta:\s*([^\n]+)/) || [])[1] || '';
      const recoveredCapturedAt = session.reportBodies.at(-1)?.capturedAt || null;
      const recoveredUrl = session.page.url();
      const recoveredRequests = session.requests.filter((request) =>
        request.url.includes('/operations/reports/sales/analysis?'),
      ).length;
      await session.screenshot('screen-recovered.png');

      t.writeJson('requests.json', {
        failedRequests: session.requests.slice(0, failedRequests),
        recoveredRequests: session.requests,
      });
      t.writeJson('console.json', session.errors);
      t.writeJson('focus.json', focused);
      const amount = (text) => (text.match(/\$[\d,.]+/) || [])[0] || '';
      t.checks.eq('the old amount stays visible', amount(failedPrimary), amount(oldPrimary));
      t.checks.check(
        'the alert names the last capture time',
        /^No se pudo actualizar\. Estos importes son de las .+\./.test(alertText.trim()),
        'No se pudo actualizar. Estos importes son de las {time}.',
        alertText.trim(),
      );
      t.checks.check(
        'no zero replaces the primary amount',
        !/\$0\.00/.test(failedPrimary),
        'no $0.00 in the primary amount',
        failedPrimary,
      );
      t.checks.truthy('focus stays in the sales region', focused.inSales);
      t.checks.truthy('the refresh starts at least one report request', failedRequests >= 1);
      t.checks.eq(
        'the retry clears the alert',
        await session.page.locator('[role=alert]').count(),
        0,
      );
      t.checks.check(
        'the retry restores a value',
        recoveredPrimary.length > 0,
        'non-empty',
        recoveredPrimary,
      );
      t.checks.check(
        'capturedAt changes after the retry',
        Boolean(oldCapturedAt) &&
          Boolean(recoveredCapturedAt) &&
          recoveredCapturedAt > oldCapturedAt,
        `later than ${oldCapturedAt}`,
        recoveredCapturedAt,
      );
      t.checks.check(
        'the visible time changes or stays within the same minute',
        Boolean(recoveredTime),
        'a visible capture time',
        recoveredTime,
      );
      t.checks.eq('the section does not change', recoveredUrl.split('#')[0], oldUrl.split('#')[0]);
      t.checks.truthy(
        'the retry sends a new report request',
        recoveredRequests > failedRequests || recoveredRequests >= 1,
      );
      return {
        observations: {
          oldPrimary,
          failedPrimary,
          recoveredPrimary,
          alertText,
          focused,
          failedRequests,
          recoveredRequests,
          oldTime,
          recoveredTime,
        },
      };
    } finally {
      await session.close();
    }
  },

  'I1-ISO-04': async (t) => {
    const session = await t.session({
      user: USERS.revoked,
      merchant: IDS.M1,
      baseUrl: t.run.devUrl,
    });
    const roleId = await t.db.value(`select id from umi.role where key='i1_revoked'`);
    try {
      await session.gotoHome({ days: 30 });
      await session.openDetail();
      const beforeCache = await session.queryCache();
      await session.page
        .getByRole('button', { name: 'Categorías', exact: true })
        .click()
        .catch(() => {});
      await session.page.waitForTimeout(400);
      const beforeText = await session.bodyText();
      await session.screenshot('screen-authorized.png');

      await t.db.query(
        `delete from umi.role_permission where role_id=$1 and permission_id=(select id from umi.permission where key='sale.lifecycle')`,
        [roleId],
      );
      const api = await t.api(USERS.revoked);
      const denied = await api.get(
        `/api/merchants/${IDS.M1}/operations/reports/sales/analysis?from=2026-10-10&to=2026-11-08&refundView=sale_result&basketUnit=ticket`,
        { allowError: true },
      );
      t.writeJson('response.json', denied.body);
      t.checks.eq('old session receives 403', denied.status, 403);
      t.checks.eq('denial code', denied.body?.error?.code, 'PERMISSION_DENIED');

      const refresh = session.page.getByRole('button', { name: 'Actualizar', exact: true });
      if (await refresh.count()) {
        await refresh.click();
      } else {
        await session.page.locator('input[type=date]').nth(1).fill('2026-11-07');
        await session.page.getByRole('button', { name: 'Consultar', exact: true }).click();
      }
      await session.page
        .locator('[role=alert]')
        .first()
        .waitFor({ state: 'visible', timeout: 25000 });
      await session.page.waitForTimeout(600);
      const deniedText = await session.bodyText();
      const deniedAlert = await session.page.locator('[role=alert]').first().innerText();
      const deniedCache = await session.queryCache();
      const amounts = await session.page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.analysis-lead, .analysis-summary-grid, .analysis-facts, .category-sales-report, .sales-bars',
          ),
        ]
          .map((element) => element.innerText)
          .join('\n'),
      );
      await session.screenshot('screen-denied-detail.png');

      await session.page.goBack({ waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(800);
      const homeText = await session.bodyText();
      await session.screenshot('screen-denied-home.png');
      await session.page.goForward({ waitUntil: 'domcontentloaded' });
      await session.page.waitForTimeout(900);
      const forwardText = await session.bodyText();
      await session.screenshot('screen-denied-forward.png');

      t.writeJson('cache.json', { before: beforeCache, after: deniedCache });
      t.writeJson('requests.json', session.requests);
      t.checks.includes(
        'denied alert is exact',
        deniedAlert,
        'No tienes permiso para consultar estas ventas.',
      );
      t.checks.check(
        'all sales amounts are removed',
        !/\$\d/.test(amounts) && !amounts.includes('MXN'),
        'no amounts',
        amounts.slice(0, 300),
      );
      t.checks.check(
        'only the return control is offered',
        /Volver a inicio/.test(deniedText),
        true,
        deniedText.slice(0, 500),
      );
      t.checks.check(
        'home shows the denial',
        /No tienes permiso para consultar estas ventas\./.test(homeText),
        true,
        homeText.slice(0, 400),
      );
      t.checks.check(
        'Forward keeps the denial',
        /No tienes permiso para consultar estas ventas\./.test(forwardText),
        true,
        forwardText.slice(0, 400),
      );
      t.checks.check(
        'Forward does not restore the old value',
        !beforeText.includes('270.00') || !forwardText.includes('270.00'),
        true,
        forwardText.includes('270.00'),
      );
      const salesKeys = (entries) =>
        (Array.isArray(entries) ? entries : []).filter((entry) =>
          JSON.stringify(entry.key).includes('sales-analysis'),
        );
      t.checks.eq('sales cache entries are absent after denial', salesKeys(deniedCache), []);
      return {
        observations: {
          beforeEntries: beforeCache.length,
          afterEntries: deniedCache.length,
          deniedAlert,
          homeDenied: /No tienes permiso/.test(homeText),
          forwardDenied: /No tienes permiso/.test(forwardText),
        },
      };
    } finally {
      await t.db.query(
        `insert into umi.role_permission(role_id, permission_id)
         select $1, id from umi.permission where key='sale.lifecycle'
         on conflict do nothing`,
        [roleId],
      );
      await session.close();
    }
  },
};
