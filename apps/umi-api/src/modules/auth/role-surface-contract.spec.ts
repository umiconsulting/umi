/**
 * Workstream C step 4 — "the client hides; the API decides" — as an offline check.
 *
 * WHAT THIS IS FOR. `scripts/umipos-role-surface-gate.mjs` (`pnpm check:role-surfaces`)
 * is the live half: it signs in as each role and MEASURES the status of every route in
 * `config/umipos-surface-permissions.json`. It needs a running API and a seeded reuse
 * database, so it cannot run inside `check:pr`. Nothing offline would have caught the
 * mistake this workstream actually made: a `merchant.manage` guard on the reward-config
 * READ. That guard was stricter than every client — it emptied `rewardConfig` in the
 * Dashboard's shared merchant model and silently removed umi-cash's till-home
 * "Recompensa activa" panel for a `STAFF` login. A person reading a client caught it.
 * This spec is the test that should have.
 *
 * It reads the same contract and the same grant matrix as the live gate, but it reads
 * the HANDLERS instead of the wire: for every surface it resolves `method + path` to the
 * one controller method that answers it and asserts the permission that method enforces.
 * No API, no database, no login.
 *
 * ── the three rules ────────────────────────────────────────────────────────────────
 *
 * 1. RESOLUTION IS TOTAL. A surface that resolves to zero handlers, or to more than one,
 *    or to a file whose guards cannot be parsed, fails by id with the file and the
 *    reason. A surface nobody can bind is an uncovered route, not a skipped test.
 *
 * 2. THE API MAY NOT BE STRICTER THAN THE CLIENT. A module's `permissions` list is the
 *    client's `some()` gate: the screen is shown when the membership holds ANY of them.
 *    So a handler must require one of them, and for a single-permission gate it must be
 *    exactly that one. Requiring something outside the gate is the till-home bug: the
 *    screen is shown and the route refuses it.
 *
 * 3. THE API MAY NOT BE STRICTER THAN THE ROLE. For every role the contract measures as
 *    `allowed`, the permission the handler enforces has to be one that role actually
 *    holds — read from `config/umipos-pilot-role-grants.json`, the same matrix the
 *    rehearsed logins are seeded from, never a list written here. And the other
 *    direction: a role measured `refused` must be refused BY THE PERMISSION. If it holds
 *    what the handler asks for, the refusal is coming from another axis (product,
 *    location scope) and this spec fails until the contract says so.
 *
 * ── where the exemptions live, and why ─────────────────────────────────────────────
 *
 * Three surfaces are deliberately open (the handler carries no permission). No registry
 * module is exempt any more: every permission-gated module now has a contract row. Both
 * lists are below, and neither is a plain allow-list: every entry is asserted, and every
 * entry FAILS once it stops being true, so an exemption cannot rot into a silent hole.
 * The uncovered-module list is empty today and its loop still runs, so the first module
 * that arrives without a row fails here rather than shipping unnoticed.
 *
 *   · DELIBERATELY_OPEN — the handler must really carry no permission, every measured
 *     role must be `allowed`, and the contract row must carry its own note.
 *   · UNCOVERED_MODULE_EXEMPTIONS — the module must really be uncovered, and the reason
 *     is checked against the controller it names (an ungated endpoint must stay ungated).
 *
 * They live in this file rather than in `config/umipos-surface-permissions.json` because
 * that file belongs to the workstream that owns the Dashboard module registry. Moving
 * them into the contract as an `exemptions` block is a clean follow-up; until then the
 * freshness assertions here are what keep them honest.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { route } from '@umi/contract';
import { DASHBOARD_DOMAIN_POLICY } from '../dashboard-operations/dashboard-operations.policy';

// ── sources of truth ────────────────────────────────────────────────────────────────

const root = resolve(__dirname, '../../../../..');

const SURFACE_CONTRACT = 'config/umipos-surface-permissions.json';
const MODULE_REGISTRY = 'apps/umi-dashboard/src/lib/module-registry.js';
const ROLE_GRANTS = 'config/umipos-pilot-role-grants.json';
const PERMISSION_INVENTORY = 'config/umipos-permission-inventory.json';

/**
 * Test-only path overrides. The defaults are the files the product reads. An override
 * exists so a mutation can point one reader at a scratch copy — the module-coverage test
 * below is exercised that way — without editing another team's file.
 */
const contractPath = process.env.UMIPOS_SURFACE_CONTRACT ?? SURFACE_CONTRACT;
const registryPath = process.env.UMIPOS_MODULE_REGISTRY ?? MODULE_REGISTRY;

const readText = (path: string): string => readFileSync(resolve(root, path), 'utf8');
const readJson = <T>(path: string): T => JSON.parse(readText(path)) as T;

interface ContractSurface {
  readonly id: string;
  readonly module: string;
  readonly client: {
    readonly gate: readonly string[];
    readonly gateMode?: string;
    readonly source: string;
    readonly knownDivergence?: string;
  };
  readonly request: { readonly method: string; readonly path: string };
  readonly note?: string;
  readonly expect: Readonly<Record<string, 'allowed' | 'refused'>>;
}

interface SurfaceContract {
  readonly schemaVersion: number;
  readonly clientGateSource: string;
  readonly roles: ReadonlyArray<{ readonly role: string }>;
  readonly surfaces: readonly ContractSurface[];
}

const contract = readJson<SurfaceContract>(contractPath);
const grants = readJson<{
  readonly profiles: ReadonlyArray<{ role: string; permissions: string[] }>;
}>(ROLE_GRANTS);
const inventory = readJson<{ readonly permissions: ReadonlyArray<{ key: string }> }>(
  PERMISSION_INVENTORY,
);

const declaredRoles = contract.roles.map((entry) => entry.role);
const permissionVocabulary = new Set(inventory.permissions.map((entry) => entry.key));

/** The role's real grants, from the matrix the rehearsed logins are seeded from. */
function grantedPermissions(role: string): readonly string[] {
  const profile = grants.profiles.find((entry) => entry.role === role);
  if (!profile) {
    throw new Error(
      `role "${role}" is measured by the contract but has no profile in ${ROLE_GRANTS}`,
    );
  }
  return profile.permissions;
}

// ── reading the API source ──────────────────────────────────────────────────────────

const HTTP_VERBS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All']);

interface ParsedHandler {
  readonly file: string;
  readonly controller: string;
  readonly handler: string;
  /** The whole route, `api`-prefixed, with every `:param` / `{param}` collapsed to `*`. */
  readonly route: string;
  readonly verb: string;
  /** The permission this handler enforces — method-level beats class-level, as Nest reads it. */
  readonly permission: string | null;
}

interface DecoratorCall {
  readonly name: string;
  /** Every path/name the decorator declares. An array argument contributes one per entry. */
  readonly args: readonly string[];
}

/**
 * `@Get('x')` contributes `'x'`; `@Post(['a', 'b'])` (kds.controller) contributes both. An
 * argument that is neither a string literal nor an array of them is kept verbatim so it
 * shows up in a failure message instead of silently matching nothing.
 */
function decoratorArgumentValues(argument: ts.Expression, source: ts.SourceFile): string[] {
  if (ts.isStringLiteral(argument)) return [argument.text];
  if (ts.isArrayLiteralExpression(argument)) {
    const literals = argument.elements.filter((element): element is ts.StringLiteral =>
      ts.isStringLiteral(element),
    );
    if (literals.length !== argument.elements.length) return [argument.getText(source)];
    return literals.map((element) => element.text);
  }
  return [argument.getText(source)];
}

function decoratorCalls(node: ts.Node, source: ts.SourceFile): DecoratorCall[] {
  const calls: DecoratorCall[] = [];
  for (const decorator of ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : []) {
    const expression = decorator.expression;
    if (!ts.isCallExpression(expression) || !ts.isIdentifier(expression.expression)) continue;
    calls.push({
      name: expression.expression.text,
      args: expression.arguments.flatMap((argument) => decoratorArgumentValues(argument, source)),
    });
  }
  return calls;
}

/** Last wins: a second `@RequirePermission` overwrites the metadata key the first set. */
const permissionOf = (calls: readonly DecoratorCall[]): string | null =>
  calls.filter((call) => call.name === 'RequirePermission').at(-1)?.args[0] ?? null;

const normalizeRoute = (path: string): string =>
  path
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((segment) => (segment.startsWith(':') || /^\{.+\}$/.test(segment) ? '*' : segment))
    .join('/');

/**
 * Parse one controller file. Throws with the file and the reason rather than returning
 * an empty list: a controller this spec cannot read is a controller it cannot vouch for.
 */
function parseControllerFile(file: string): ParsedHandler[] {
  const relativeFile = relative(root, file);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const declarations = source.statements.filter(ts.isClassDeclaration);
  if (declarations.length === 0) {
    throw new Error(`cannot parse guards from ${relativeFile}: the file declares no class`);
  }

  const handlers: ParsedHandler[] = [];
  let controllerClasses = 0;
  for (const declaration of declarations) {
    const classCalls = decoratorCalls(declaration, source);
    const controller = classCalls.find((call) => call.name === 'Controller');
    if (!controller) continue;
    controllerClasses += 1;

    // `@Controller()` with no path is legal and used (kds.controller): the class is the origin.
    const basePath = controller.args[0] ?? '';
    const controllerName = declaration.name?.text;
    if (controllerName === undefined) {
      throw new Error(
        `cannot parse guards from ${relativeFile}: an anonymous @Controller() class has no name`,
      );
    }
    const classPermission = permissionOf(classCalls);

    for (const member of declaration.members) {
      if (!ts.isMethodDeclaration(member)) continue;
      const memberCalls = decoratorCalls(member, source);
      const verb = memberCalls.find((call) => HTTP_VERBS.has(call.name));
      if (!verb) continue;
      const handler = member.name.getText(source);
      for (const verbPath of verb.args.length > 0 ? verb.args : ['']) {
        handlers.push({
          file: relativeFile,
          controller: controllerName,
          handler,
          verb: verb.name.toUpperCase(),
          route: normalizeRoute(`${basePath}/${verbPath}`),
          permission: permissionOf(memberCalls) ?? classPermission,
        });
      }
    }
  }

  if (controllerClasses === 0) {
    throw new Error(`cannot parse guards from ${relativeFile}: no class carries @Controller()`);
  }
  return handlers;
}

function walkTypeScript(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkTypeScript(full, out);
    else if (entry.name.endsWith('.controller.ts')) out.push(full);
  }
  return out;
}

const API_SOURCE = join(root, 'apps/umi-api/src');
const API_HANDLERS = walkTypeScript(API_SOURCE).flatMap(parseControllerFile);

/** The one handler that answers a contract route, or a failure naming what went wrong. */
function resolveSurfaceHandler(surfaceId: string, method: string, path: string): ParsedHandler {
  const wanted = normalizeRoute(path.split('?')[0]);
  const matches = API_HANDLERS.filter(
    (handler) => handler.verb === method && handler.route === wanted,
  );
  if (matches.length !== 1) {
    const seen =
      matches.length === 0
        ? 'no controller method answers it'
        : matches.map((match) => `${match.file}#${match.handler}`).join(', ');
    throw new Error(
      `surface "${surfaceId}" (${method} ${path}) matches ${matches.length} handlers in ` +
        `apps/umi-api/src: ${seen}. A surface the source cannot bind is not a covered route — ` +
        `fix the route or the contract row.`,
    );
  }
  return matches[0];
}

// ── how each surface enforces its permission ────────────────────────────────────────

/**
 * Surfaces whose permission lives in a SERVICE, not in a guard decorator. The contract
 * says so on the row itself ("Enforced in the service against
 * dashboard-operations.policy.ts"); each entry names the domain the handler selects, and
 * the permissions are read from the real policy object rather than copied here.
 */
const SERVICE_ENFORCED: Readonly<Record<string, { domain: string; selector: string }>> = {
  'operations.diagnostics': {
    domain: 'diagnostics',
    selector: 'snapshot() selects DASHBOARD_DOMAIN_POLICY by `query.domain`',
  },
  'operations.audit': {
    domain: 'audit',
    selector: 'snapshot() selects DASHBOARD_DOMAIN_POLICY by `query.domain`',
  },
  'operations.cash_shifts': {
    domain: 'cash_shifts',
    selector: 'snapshot() selects DASHBOARD_DOMAIN_POLICY by `query.domain`',
  },
  'operations.catalog': {
    domain: 'catalog',
    selector: 'snapshot() selects DASHBOARD_DOMAIN_POLICY by `query.domain`',
  },
  'operations.sales': {
    domain: 'sales',
    selector: "salesSummary() selects domain 'sales' with no query input",
  },
};

/**
 * Surfaces whose handler deliberately carries no permission. Each one is a route the
 * API serves on purpose to a role the client's module gate does not name, and each is
 * asserted: still open, still allowed for every measured role, still carrying its own
 * note in the contract. Add a guard to one of these and this list fails until the entry
 * is removed and the contract row re-described.
 */
const DELIBERATELY_OPEN: Readonly<Record<string, string>> = {
  'cash.customers':
    "the till's own customer list (GET /api/merchants/:id/cash/customers) — the gate on " +
    "this row is the loyalty-value hub's DISPLAY condition, not a route guard, and the " +
    "contract's note plus its `expect` (all four roles allowed) record the API as " +
    'deliberately open: the same cashier whose screens call it must be served',
  'merchant.settings-shell':
    'the shared café model (name, locations, segments) that every visible screen reads — ' +
    "the module registry gates `overview` on the product alone, so the contract's gate is " +
    'empty and the handler must not add a permission the client never asked for',
};

/**
 * Registry modules no contract row can cover, because the endpoint their screen reads
 * carries no permission at all. The reason is not taken on trust: the controller named
 * here is re-read below and must still declare no `@RequirePermission` anywhere. Give it
 * one and this exemption fails, which is the moment a contract row becomes possible.
 */
const UNCOVERED_MODULE_EXEMPTIONS: Readonly<
  Record<string, { readonly reason: string; readonly ungatedController: string }>
> = {};

// ── reading the client's module registry (source text, never imported) ──────────────

interface RegistryModule {
  readonly id: string;
  readonly permissions: readonly string[];
}

/**
 * `module-registry.js` is JavaScript with Lingui `msg` tagged templates that only run
 * once a locale is active, so it is parsed as text rather than imported. Anything this
 * parser cannot read is a failure, not a default: a module whose `permissions` list is
 * computed at runtime cannot be audited, and that is worth knowing.
 */
function readRegistryModules(path: string): RegistryModule[] {
  const source = ts.createSourceFile(
    path,
    readText(path),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );

  let modules: ts.ObjectLiteralExpression | null = null;
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== 'MODULES') continue;
      if (declaration.initializer && ts.isObjectLiteralExpression(declaration.initializer)) {
        modules = declaration.initializer;
      }
    }
  }
  if (!modules) {
    throw new Error(
      `${path}: cannot read the module registry — no \`MODULES = { … }\` object literal. ` +
        'This spec reads that file as text; if it moved or changed shape, point the spec at ' +
        'the new shape rather than dropping the check.',
    );
  }

  const read = (value: ts.ObjectLiteralExpression, name: string) => {
    for (const property of value.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const propertyName = property.name;
      if (propertyName === undefined) continue;
      if (!ts.isIdentifier(propertyName) && !ts.isStringLiteral(propertyName)) continue;
      if (propertyName.text === name) return property;
    }
    return undefined;
  };

  const found: RegistryModule[] = [];
  for (const property of modules.properties) {
    // Every entry is read or the file is rejected: a spread or a computed key could inject a
    // gated module this spec never sees, which is the silent skip this check exists to prevent.
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(
        `${path}: MODULES contains a ${ts.SyntaxKind[property.kind]} entry, which this spec ` +
          'cannot read; keep the module table literal.',
      );
    }
    const propertyName = property.name;
    const key =
      propertyName !== undefined &&
      (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName))
        ? propertyName.text
        : null;
    if (key === null) {
      throw new Error(`${path}: a MODULES entry has no literal key; cannot read its gate`);
    }
    const value = property.initializer;
    if (!ts.isObjectLiteralExpression(value)) {
      throw new Error(`${path}: module "${key}" is not an object literal; cannot read its gate`);
    }

    const idProperty = read(value, 'id');
    if (!idProperty || !ts.isStringLiteral(idProperty.initializer)) {
      throw new Error(`${path}: module "${key}" has no literal \`id\`; cannot read its gate`);
    }

    const permissionsProperty = read(value, 'permissions');
    const permissions: string[] = [];
    if (permissionsProperty) {
      const literal = permissionsProperty.initializer;
      if (!ts.isArrayLiteralExpression(literal)) {
        throw new Error(
          `${path}: module "${key}" declares \`permissions\` that is not an array literal. ` +
            'A computed gate cannot be checked against the contract; keep it literal.',
        );
      }
      for (const element of literal.elements) {
        if (!ts.isStringLiteral(element)) {
          throw new Error(
            `${path}: module "${key}" has a non-literal entry in \`permissions\` ` +
              `(${element.getText(source)}); cannot check it against the contract.`,
          );
        }
        permissions.push(element.text);
      }
    }
    found.push({ id: idProperty.initializer.text, permissions });
  }
  return found;
}

const registryModules = readRegistryModules(registryPath);

// ── small helpers ───────────────────────────────────────────────────────────────────

function failIfAny(header: string, lines: readonly string[]): void {
  if (lines.length === 0) return;
  throw new Error(`${header}\n  - ${lines.join('\n  - ')}`);
}

describe('Workstream C role surface contract', () => {
  const surface = (id: string): ContractSurface => {
    const found = contract.surfaces.find((entry) => entry.id === id);
    if (!found) throw new Error(`the contract has no surface "${id}"`);
    return found;
  };

  it('keeps the contract wired to the files this spec reads', () => {
    expect(contract.schemaVersion).toBe(1);
    expect(contract.clientGateSource).toBe(MODULE_REGISTRY);
    expect(contract.surfaces.length).toBeGreaterThan(0);
    expect(declaredRoles.length).toBeGreaterThan(0);
  });

  it('resolves every surface to exactly one handler in the API source', () => {
    const problems: string[] = [];
    for (const entry of contract.surfaces) {
      try {
        resolveSurfaceHandler(entry.id, entry.request.method, entry.request.path);
      } catch (error) {
        problems.push((error as Error).message);
      }
    }
    failIfAny(
      `${problems.length} of ${contract.surfaces.length} contract surfaces do not bind to one ` +
        'API handler:',
      problems,
    );
    expect(API_HANDLERS.length).toBeGreaterThan(100);
  });

  it('binds every surface to the permission the contract declares', () => {
    const problems: string[] = [];
    for (const entry of contract.surfaces) {
      const handler = resolveSurfaceHandler(entry.id, entry.request.method, entry.request.path);
      const gate = entry.client.gate;
      const where = `${entry.id} → ${handler.file}#${handler.handler}`;

      if (declaredRoles.length === 0) problems.push('the contract declares no roles');
      for (const required of gate) {
        if (!permissionVocabulary.has(required))
          problems.push(
            `${where} gates on "${required}", which is not in the permission inventory`,
          );
      }

      const service = SERVICE_ENFORCED[entry.id];
      if (service) {
        if (handler.permission !== null) {
          problems.push(
            `${where} carries @RequirePermission('${handler.permission}') but is listed in ` +
              `SERVICE_ENFORCED; the guard is now readable from the source, so the table entry ` +
              `is stale and must go`,
          );
          continue;
        }
        const policy = DASHBOARD_DOMAIN_POLICY.find((domain) => domain.domain === service.domain);
        if (!policy) {
          problems.push(
            `${where} names domain "${service.domain}", which the policy does not define`,
          );
          continue;
        }
        const documented = new URLSearchParams(entry.request.path.split('?')[1] ?? '').get(
          'domain',
        );
        if (documented !== null && documented !== service.domain) {
          problems.push(
            `${where} sends domain="${documented}" but SERVICE_ENFORCED says the handler selects ` +
              `"${service.domain}" (${service.selector})`,
          );
        }
        for (const required of policy.permissions) {
          if (!gate.includes(required)) {
            problems.push(
              `${where} refuses unless the caller holds "${required}", which the client's gate ` +
                `[${gate.join(', ')}] does not name — the API is stricter than the screen that ` +
                `calls it`,
            );
          }
        }
        continue;
      }

      if (handler.permission === null) {
        if (!(entry.id in DELIBERATELY_OPEN)) {
          problems.push(
            `${where} enforces no permission while the client's gate is [${gate.join(', ')}]. ` +
              'Either guard the handler or declare the surface in DELIBERATELY_OPEN with a reason.',
          );
        }
        continue;
      }

      if (gate.length === 0) {
        problems.push(
          `${where} requires "${handler.permission}" but the contract's gate is empty: the ` +
            'client shows this screen to every role the module admits, so the route must not ' +
            'add a permission.',
        );
      } else if (gate.length === 1 && handler.permission !== gate[0]) {
        problems.push(
          `${where} requires "${handler.permission}" but the contract declares ` +
            `"${gate[0]}". For a single-permission gate the two must be equal — a stricter ` +
            'route is the till-home regression (the screen is shown and the route refuses it).',
        );
      } else if (!gate.includes(handler.permission)) {
        problems.push(
          `${where} requires "${handler.permission}", which the client's gate ` +
            `[${gate.join(', ')}] does not name — the API is stricter than the screen that calls it.`,
        );
      }
    }
    failIfAny(`${problems.length} contract surface(s) drift from the source:`, problems);
  });

  /**
   * The shapes this workstream fought over, named so the next reader sees why. The live
   * gate measures these too; these assertions are what makes them survive without a
   * running API.
   */
  const FOUGHT_OVER: ReadonlyArray<{
    readonly method: string;
    readonly path: string;
    readonly permission: string;
    readonly why: string;
  }> = [
    {
      method: 'GET',
      path: '/api/{ref}/admin/settings',
      permission: 'merchant.manage',
      why: 'the manager surface: the Dashboard hides Settings from a cashier, so every read of the branding and promo copy must refuse her too',
    },
    {
      method: 'PATCH',
      path: '/api/{ref}/admin/settings',
      permission: 'merchant.manage',
      why: 'the manager surface, write half',
    },
    {
      method: 'GET',
      path: '/api/{ref}/admin/reward-config',
      permission: 'loyalty.read',
      why: 'THE REGRESSION: this read was merchant.manage, which emptied the Dashboard merchant model and removed umi-cash\'s till-home "Recompensa activa" panel for every STAFF login. Do not re-tighten it to match the write.',
    },
    {
      method: 'GET',
      path: '/api/merchants/{merchantId}/cash/reward-config',
      permission: 'loyalty.read',
      why: 'the merchant-routed twin of the row above, read by the same dashboard loader',
    },
    {
      method: 'PUT',
      path: '/api/{ref}/admin/reward-config',
      permission: 'merchant.manage',
      why: 'the write half: it changes what every issued pass shows, and the only writer is the Settings screen',
    },
    {
      method: 'PATCH',
      path: '/api/{ref}/admin/reward-config',
      permission: 'merchant.manage',
      why: 'the write half, PATCH',
    },
    {
      method: 'PUT',
      path: '/api/merchants/{merchantId}/cash/reward-config',
      permission: 'merchant.manage',
      why: 'the write half of the merchant-routed twin',
    },
    {
      method: 'PATCH',
      path: '/api/merchants/{merchantId}/cash/reward-config',
      permission: 'merchant.manage',
      why: 'the write half of the merchant-routed twin, PATCH',
    },
    {
      method: 'GET',
      path: '/api/{ref}/admin/hours',
      permission: 'merchant.manage',
      why: 'the hours screen keeps merchant.manage: a cashier was refused before, but only because the location resolver stopped her first',
    },
    {
      method: 'PATCH',
      path: '/api/{ref}/admin/hours',
      permission: 'merchant.manage',
      why: 'the hours screen keeps merchant.manage, write half',
    },
    {
      method: 'GET',
      path: '/api/merchants/{merchantId}/conversaflow/hours',
      permission: 'merchant.manage',
      why: 'the route the Hours screen actually calls; it carried no permission at all until this work, so the refusal must come from the permission',
    },
    {
      method: 'PATCH',
      path: '/api/merchants/{merchantId}/conversaflow/hours',
      permission: 'merchant.manage',
      why: "the Hours screen's write, same route pair",
    },
    {
      method: 'GET',
      path: '/api/{ref}/admin/staff',
      permission: 'merchant.manage',
      why: 'the staff register route: class-level, so the guard is on every verb the controller declares',
    },
    {
      method: 'GET',
      path: '/api/merchants/{merchantId}/staff',
      permission: 'merchant.manage',
      why: 'the staff route the SPA calls, class-level too',
    },
  ];

  for (const shape of FOUGHT_OVER) {
    it(`${shape.method} ${shape.path} requires ${shape.permission} — ${shape.why}`, () => {
      const handler = resolveSurfaceHandler(
        `${shape.method} ${shape.path}`,
        shape.method,
        shape.path,
      );
      expect(handler.permission).toBe(shape.permission);
    });
  }

  /**
   * Routes whose guard is pinned HERE instead of in a live-probed contract row.
   *
   * `pnpm check:role-surfaces` measures by MUTATING: `settings.write` re-sends the
   * current settings, `reward-config.write` re-saves the current configuration. That is
   * fine for configuration a café can re-save. It is not fine for the floor plan — `PUT`
   * replaces the document every till draws its map from and `POST /publish` promotes it,
   * so a permission check must not be the thing that rewrites a running restaurant's
   * dining room.
   *
   * Leaving them out of the contract with nothing in their place would leave the guard
   * to nobody. So they are pinned here: the same source-parsing resolution the contract
   * rows use, asserting the permission each one enforces, plus an assertion that neither
   * has crept back into the contract as a row that mutates on every run.
   *
   * The read verb of the same controller IS a live row (`floor-plan.read`).
   */
  const GUARD_PINNED_OFFLINE: ReadonlyArray<{
    readonly method: string;
    readonly path: string;
    readonly permission: string;
    readonly why: string;
  }> = [
    {
      method: 'PUT',
      path: '/api/merchants/{merchantId}/floor-plan',
      permission: 'merchant.manage',
      why: 'the floor-plan save: it replaces the draft document the map is drawn from, and its only caller is the manager-gated dashboard editor',
    },
    {
      method: 'POST',
      path: '/api/merchants/{merchantId}/floor-plan/publish',
      permission: 'merchant.manage',
      why: 'the publish half: it promotes the draft to what every till renders, so it must stay manager-only',
    },
  ];

  for (const shape of GUARD_PINNED_OFFLINE) {
    it(`${shape.method} ${shape.path} requires ${shape.permission} — ${shape.why}`, () => {
      const handler = resolveSurfaceHandler(
        `${shape.method} ${shape.path}`,
        shape.method,
        shape.path,
      );
      expect(handler.permission).toBe(shape.permission);
    });
  }

  it('never turns a guard-pinned route into a live-probed one', () => {
    const problems: string[] = [];
    for (const shape of GUARD_PINNED_OFFLINE) {
      const wanted = normalizeRoute(shape.path);
      const row = contract.surfaces.find(
        (entry) =>
          entry.request.method === shape.method &&
          normalizeRoute(entry.request.path.split('?')[0]) === wanted,
      );
      if (row) {
        problems.push(
          `${row.id} (${row.request.method} ${row.request.path}) now probes a route ` +
            'GUARD_PINNED_OFFLINE pins offline: every `pnpm check:role-surfaces` run would ' +
            'send a real floor-plan write. Keep the pin and drop the row, or make the ' +
            'probe non-mutating.',
        );
      }
    }
    failIfAny('a guard-pinned route became a live-probed contract row:', problems);
  });

  /**
   * ── the POS table-map surface: the guard is the OPERATOR SESSION, read from SQL ──
   *
   * Workstream D steps 3 to 5 (plan §8D) added the live state of a table: a room read
   * and six operations. All seven are POS routes whose authority is checked in SQL
   * against `runtime.operator_session` inside the same transaction as the write it
   * guards — merchant, location, device, session, expiry, the permission, and the POS
   * entitlement. That is the shape pos-cart, pos-cash and the floor-plan read already
   * use, and the controller deliberately carries NO `@RequirePermission`: `RolesGuard`
   * is not in that controller's guard stack, so the decorator would enforce nothing
   * while reading like a guard. A pin that asserted a decorator here would be worse
   * than no pin at all.
   *
   * So they are pinned offline for two reasons, the second of which is new: the live
   * gate signs in as dashboard ROLES and has no operator session to offer, so
   * `check:role-surfaces` could not measure them even if probing them were safe — and
   * probing them is not safe, because five of the six operations move a party on the
   * café's real floor. What is asserted is everything readable from the source: the
   * handler binds, it declares no permission decorator (so the claim about where the
   * guard lives stays true), the route table declares the same permission, and the
   * module's repository still carries the operator-session check.
   */
  const POS_SESSION_GUARDED: ReadonlyArray<{
    readonly id: string;
    readonly method: string;
    readonly path: string;
    readonly permission: string;
    readonly why: string;
  }> = [
    {
      id: 'pos.tableState',
      method: 'GET',
      path: '/api/v1/pos/merchants/{merchantId}/table-state',
      permission: 'sale.lifecycle',
      why: 'the room read: who is where and for how long',
    },
    {
      id: 'pos.tableStateSeat',
      method: 'POST',
      path: '/api/v1/pos/merchants/{merchantId}/table-state/seat',
      permission: 'sale.lifecycle',
      why: 'seating a party starts the turn timer',
    },
    {
      id: 'pos.tableStateMove',
      method: 'POST',
      path: '/api/v1/pos/merchants/{merchantId}/table-state/move',
      permission: 'sale.lifecycle',
      why: 'a move relocates a seated party, and the turn timer travels with it',
    },
    {
      id: 'pos.tableStateMerge',
      method: 'POST',
      path: '/api/v1/pos/merchants/{merchantId}/table-state/merge',
      permission: 'sale.lifecycle',
      why: 'a merge puts one party across several tables',
    },
    {
      id: 'pos.tableStateSplit',
      method: 'POST',
      path: '/api/v1/pos/merchants/{merchantId}/table-state/split',
      permission: 'sale.lifecycle',
      why: 'a split ends a merge and dirties the tables it releases',
    },
    {
      id: 'pos.tableStateClear',
      method: 'POST',
      path: '/api/v1/pos/merchants/{merchantId}/table-state/clear',
      permission: 'sale.lifecycle',
      why: 'clearing a table ends the party on it',
    },
    {
      id: 'pos.tableStateOpen',
      method: 'POST',
      path: '/api/v1/pos/merchants/{merchantId}/table-state/open',
      permission: 'sale.lifecycle',
      why: 'the wipe-done transition, from dirty back to open',
    },
  ];

  /** The module that owns the table-map routes, and the check that guards them. */
  const TABLE_MAP_REPOSITORY = 'apps/umi-api/src/modules/table-map/table-map.repository.ts';
  const TABLE_MAP_PERMISSION = 'sale.lifecycle';

  it('keeps the table-map guard in the repository, and proves where it lives', () => {
    const problems: string[] = [];
    const source = readText(TABLE_MAP_REPOSITORY);

    for (const shape of POS_SESSION_GUARDED) {
      // Throws with the file and the reason when a route binds to zero or many
      // handlers — the same total resolution the contract rows get.
      const handler = resolveSurfaceHandler(shape.id, shape.method, shape.path);
      if (handler.permission !== null)
        problems.push(
          `${shape.id} → ${handler.file}#${handler.handler} carries ` +
            `@RequirePermission('${handler.permission}') on a POS controller whose guard stack ` +
            'has no RolesGuard: the decorator enforces nothing, so the pin would be asserting ' +
            'a guard that does not run. Keep the repository check and drop the decorator.',
        );
      const declared = route(shape.id).contract?.permission ?? null;
      if (declared !== shape.permission)
        problems.push(
          `${shape.id} is pinned as ${shape.permission} but the route table declares ` +
            `${declared === null ? 'no permission' : `"${declared}"`}. The pin and the published ` +
            'contract have to name the same guard.',
        );
    }

    // The guard itself, in the one file that holds it. Each fragment is load-bearing:
    // the permission, the operator session it is read from, the device join, the POS
    // entitlement, and the merchant/location/state/expiry predicates.
    for (const fragment of [
      `const POS_PERMISSION = '${TABLE_MAP_PERMISSION}'`,
      'runtime.operator_session',
      'ANY(os.permissions)',
      'jsonb_array_elements(os.entitlements)',
      "os.state='active'",
      'os.expires_at>now()',
      'os.location_id=$6::uuid',
    ]) {
      if (!source.includes(fragment))
        problems.push(
          `${TABLE_MAP_REPOSITORY} no longer contains \`${fragment}\`, so the operator-session ` +
            `check that guards ${POS_SESSION_GUARDED.length} POS table-map routes is not what ` +
            'this pin says it is.',
        );
    }

    failIfAny('the POS table-map guard is not where the pin says it is:', problems);
  });

  it('never turns a table-map route into a live-probed contract row', () => {
    const problems: string[] = [];
    for (const shape of POS_SESSION_GUARDED) {
      const wanted = normalizeRoute(shape.path);
      const row = contract.surfaces.find(
        (entry) =>
          entry.request.method === shape.method &&
          normalizeRoute(entry.request.path.split('?')[0]) === wanted,
      );
      if (row) {
        problems.push(
          `${row.id} (${row.request.method} ${row.request.path}) now probes ${shape.why}. The ` +
            'role-surface gate signs in as dashboard roles, so it can only ever measure the ' +
            'refusal of a route that needs an operator session — and for the five write verbs, ' +
            'measuring it would move a party on a real floor on every `pnpm check:role-surfaces` ' +
            'run. Keep the pin and drop the row.',
        );
      }
    }
    failIfAny('a table-map route became a live-probed contract row:', problems);
  });

  /**
   * ── the register reclaim: a POS write, guarded by the operator session ──────
   *
   * `POST /cash/registers/:registerId/reclaim` (build-v3-68) frees a register whose
   * holding terminal is gone. Like pos-cart and pos-cash it carries NO
   * `@RequirePermission` decorator — `RolesGuard` is not in that controller's
   * stack, so the decorator would enforce nothing while reading like a guard — and
   * the authority really lives in two places that this pin asserts:
   *
   *   · the service's `authorize(..., 'cash.shift.open')` against the operator
   *     session, which is the permission every role that may open a register
   *     already holds (cashier included: a till that cannot be freed is a till
   *     nobody can work);
   *   · the repository, where the staleness proof lives — the holding device's
   *     usability is read from `merchant.device`, never asserted by the caller.
   *
   * It cannot be a live row for both of the reasons the table-map pins give: the
   * role gate signs in as dashboard ROLES and has no operator session to offer,
   * and the operation is a WRITE against a real till.
   */
  const REGISTER_RECLAIM = {
    id: 'pos.cashRegisterReclaim',
    method: 'POST',
    path: '/api/v1/pos/merchants/{merchantId}/cash/registers/{registerId}/reclaim',
    permission: 'cash.shift.open',
    why: 'freeing a register whose holding terminal is gone',
  } as const;
  const POS_CASH_SERVICE = 'apps/umi-api/src/modules/pos-cash/pos-cash.service.ts';
  const POS_CASH_REPOSITORY = 'apps/umi-api/src/modules/pos-cash/pos-cash.repository.ts';

  it('pins the register reclaim: session-guarded in the service, staleness proven in SQL', () => {
    const problems: string[] = [];
    const handler = resolveSurfaceHandler(REGISTER_RECLAIM.id, 'POST', REGISTER_RECLAIM.path);
    if (handler.permission !== null)
      problems.push(
        `${REGISTER_RECLAIM.id} → ${handler.file}#${handler.handler} carries ` +
          `@RequirePermission('${handler.permission}') on a POS controller whose guard stack has ` +
          'no RolesGuard: the decorator enforces nothing, so this pin would be asserting a guard ' +
          'that does not run. Keep the service-side authorize and drop the decorator.',
      );
    const declared = route(REGISTER_RECLAIM.id).contract?.permission ?? null;
    if (declared !== REGISTER_RECLAIM.permission)
      problems.push(
        `${REGISTER_RECLAIM.id} is pinned as ${REGISTER_RECLAIM.permission} but the route table ` +
          `declares ${declared === null ? 'no permission' : `"${declared}"`}.`,
      );
    const service = readText(POS_CASH_SERVICE);
    if (!/async reclaimRegister[\s\S]{0,900}?'cash\.shift\.open'/.test(service))
      problems.push(
        `${POS_CASH_SERVICE} no longer authorizes reclaimRegister with 'cash.shift.open', so the ` +
          'reclaim would be reachable by any enrolled terminal.',
      );
    // The staleness proof, and the two words that keep it server-side.
    const repository = readText(POS_CASH_REPOSITORY);
    for (const fragment of [
      'merchant.device_is_usable',
      'held_by_orphaned_till',
      "'orphan_reclaim'",
    ]) {
      if (!repository.includes(fragment))
        problems.push(
          `${POS_CASH_REPOSITORY} no longer contains \`${fragment}\`, so the staleness proof the ` +
            'reclaim is allowed to act on is not what this pin says it is.',
        );
    }
    failIfAny('the register reclaim is not guarded where the pin says it is:', problems);
  });

  it('never turns the register reclaim into a live-probed contract row', () => {
    const wanted = normalizeRoute(REGISTER_RECLAIM.path);
    const row = contract.surfaces.find(
      (entry) =>
        entry.request.method === REGISTER_RECLAIM.method &&
        normalizeRoute(entry.request.path.split('?')[0]) === wanted,
    );
    failIfAny('the register reclaim became a live-probed contract row:', [
      ...(row
        ? [
            `${row.id} (${row.request.method} ${row.request.path}) now probes ${REGISTER_RECLAIM.why}. ` +
              'The role gate signs in as dashboard roles and has no operator session, and probing ' +
              'this one WRITES to a real till. Keep the pin and drop the row.',
          ]
        : []),
    ]);
  });

  it('never gives a surface a permission the measured role does not hold', () => {
    const problems: string[] = [];
    for (const role of declaredRoles) {
      const held = grantedPermissions(role);
      for (const entry of contract.surfaces) {
        if (entry.expect[role] !== 'allowed') continue;
        const handler = resolveSurfaceHandler(entry.id, entry.request.method, entry.request.path);
        const service = SERVICE_ENFORCED[entry.id];
        const required = service
          ? (DASHBOARD_DOMAIN_POLICY.find((domain) => domain.domain === service.domain)
              ?.permissions ?? [])
          : handler.permission === null
            ? []
            : [handler.permission];
        for (const permission of required) {
          if (!held.includes(permission)) {
            problems.push(
              `${entry.id} (${entry.request.method} ${entry.request.path}) is measured allowed ` +
                `for ${role}, but ${handler.file}#${handler.handler} requires "${permission}", ` +
                `which ${role} does not hold in ${ROLE_GRANTS}`,
            );
          }
        }
      }
    }
    failIfAny('the contract grants a role a surface its own permission refuses:', problems);
  });

  it('explains every refusal with the permission it enforces', () => {
    const problems: string[] = [];
    for (const role of declaredRoles) {
      const held = grantedPermissions(role);
      for (const entry of contract.surfaces) {
        if (entry.expect[role] !== 'refused') continue;
        const handler = resolveSurfaceHandler(entry.id, entry.request.method, entry.request.path);
        const service = SERVICE_ENFORCED[entry.id];
        const required = service
          ? (DASHBOARD_DOMAIN_POLICY.find((domain) => domain.domain === service.domain)
              ?.permissions ?? [])
          : handler.permission === null
            ? []
            : [handler.permission];
        if (required.length === 0) {
          problems.push(
            `${entry.id} is measured refused for ${role}, but ${handler.file}#${handler.handler} ` +
              'enforces no permission; the refusal would come from another axis',
          );
          continue;
        }
        if (required.some((permission) => held.includes(permission))) {
          problems.push(
            `${entry.id} is measured refused for ${role}, but ${role} holds ` +
              `[${required.join(', ')}] and ${handler.file}#${handler.handler} asks for nothing ` +
              'else — the refusal must be coming from the product or location axis',
          );
        }
      }
    }
    failIfAny('a measured refusal is not shaped by the permission it should be:', problems);
  });

  it('keeps every deliberately open surface open, allowed, and documented', () => {
    for (const [id, reason] of Object.entries(DELIBERATELY_OPEN)) {
      const entry = surface(id);
      const handler = resolveSurfaceHandler(id, entry.request.method, entry.request.path);
      expect(
        handler.permission,
        `${id} now carries a permission; remove it from DELIBERATELY_OPEN`,
      ).toBeNull();
      for (const role of declaredRoles) {
        expect(
          entry.expect[role],
          `${id} is declared deliberately open, so every measured role must be allowed`,
        ).toBe('allowed');
      }
      expect(
        entry.note ?? entry.client.knownDivergence ?? '',
        `${id} is declared deliberately open, so the contract row must say why`,
      ).not.toBe('');
      expect(reason.length).toBeGreaterThan(0);
    }
  });

  it('covers every permission-gated dashboard module, or exempts it with a checked reason', () => {
    const gated = registryModules.filter((module) => module.permissions.length > 0);
    expect(gated.length).toBeGreaterThan(10);

    const covered = new Set(contract.surfaces.flatMap((entry) => [...entry.client.gate]));
    const uncovered = gated.filter(
      (module) => !module.permissions.some((permission) => covered.has(permission)),
    );

    const problems: string[] = [];
    for (const module of uncovered) {
      if (!(module.id in UNCOVERED_MODULE_EXEMPTIONS)) {
        problems.push(
          `module "${module.id}" gates on [${module.permissions.join(', ')}] and no contract ` +
            'surface covers it: add a surface to config/umipos-surface-permissions.json, or ' +
            'record an exemption with a reason in UNCOVERED_MODULE_EXEMPTIONS.',
        );
        continue;
      }
      const exemption = UNCOVERED_MODULE_EXEMPTIONS[module.id];
      const controller = readText(exemption.ungatedController);
      if (controller.includes('@RequirePermission(')) {
        problems.push(
          `module "${module.id}" is exempted because ${exemption.ungatedController} is ungated, ` +
            'but that controller now declares @RequirePermission — the exemption is stale and ' +
            'the module can be covered by a real contract row.',
        );
      }
      expect(exemption.reason.length).toBeGreaterThan(0);
    }

    for (const id of Object.keys(UNCOVERED_MODULE_EXEMPTIONS)) {
      const module = registryModules.find((entry) => entry.id === id);
      if (!module) {
        problems.push(
          `UNCOVERED_MODULE_EXEMPTIONS names "${id}", which the registry no longer has`,
        );
      } else if (module.permissions.length === 0) {
        problems.push(
          `UNCOVERED_MODULE_EXEMPTIONS still exempts "${id}", but that module declares no ` +
            'permissions any more, so there is nothing left to cover — remove the stale exemption.',
        );
      } else if (module.permissions.some((permission) => covered.has(permission))) {
        problems.push(
          `UNCOVERED_MODULE_EXEMPTIONS still exempts "${id}", but the contract now covers ` +
            `[${module.permissions.filter((permission) => covered.has(permission)).join(', ')}] — ` +
            'remove the stale exemption.',
        );
      }
    }
    failIfAny(
      'a permission-gated dashboard module is not bound to a measured API decision:',
      problems,
    );
  });

  it('keeps the registry and the contract on one module vocabulary', () => {
    const ids = registryModules.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);
    const problems: string[] = [];
    for (const entry of contract.surfaces) {
      const module = registryModules.find((candidate) => candidate.id === entry.module);
      if (!module) {
        problems.push(
          `${entry.id} names client module "${entry.module}", which ${registryPath} does not define`,
        );
        continue;
      }
      for (const permission of entry.client.gate) {
        // The module's own list is NOT the assertion here: a row may deliberately cite
        // a WEAKER permission than its module gates on (reward-config.read reads the
        // shared merchant model for every screen, so it carries `loyalty.read` while
        // module `settings` is `merchant.manage`). What is asserted is that the module
        // is permission-gated at all.
        if (module.permissions.length === 0) {
          problems.push(
            `${entry.id} declares a gate on "${permission}" but module "${entry.module}" declares none`,
          );
        }
      }
    }
    failIfAny('the contract and the module registry disagree about modules:', problems);
  });
});
