import { useId, useState } from 'react';
import { msg } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { I } from '@/icons.jsx';
import { formatDate } from '@/lib/format.js';
import { PageHead } from '@/components/page-head.jsx';
import { Menu } from '@/components/menu.jsx';
import { Segmented } from '@/components/segmented.jsx';
import { Select } from '@/components/select.jsx';
import {
  archiveMerchantRole,
  createMerchantRole,
  createStaffMember,
  deleteStaffMember,
  updateMerchantRole,
  updateStaffMember,
  useRolesData,
  useStaffData,
} from '@/data.jsx';
import { useMerchant } from '@/lib/merchant-context.jsx';

const ROLE_LABELS = { ADMIN: msg`Admin`, STAFF: msg`Barista` };

/**
 * A permission group is an API key, not a word. The console shows the word.
 *
 * The old list printed the key itself — `cart`, `cash.drawer.no_sale` — in a mono
 * font, to the owner. An unknown key falls back to one plain heading, so a key
 * that this map does not hold can never print itself.
 */
const GROUP_LABELS = {
  cart: msg`Carrito`,
  cash: msg`Caja y turnos`,
  catalog: msg`Catálogo`,
  checkout: msg`Pago`,
  customer: msg`Clientes`,
  device: msg`Dispositivos`,
  hardware: msg`Hardware`,
  inventory: msg`Inventario`,
  offline: msg`Sin conexión`,
  orders: msg`Pedidos`,
  register: msg`Caja registradora`,
  sale: msg`Venta`,
  audit: msg`Auditoría`,
  insights: msg`Reportes`,
  location: msg`Sucursal`,
  merchant: msg`Negocio`,
  'table order': msg`Mesas`,
  tenant: msg`Cuenta`,
  kitchen: msg`Cocina`,
  'gift card': msg`Tarjetas de regalo`,
  loyalty: msg`Lealtad`,
  'stored value': msg`Saldo`,
  wallet: msg`Wallet`,
};
const GROUP_LABELS_OTHER = msg`Otros permisos`;

/**
 * Only a risk above the default earns a mark. A chip on every row says nothing,
 * and most permissions are low risk.
 */
const RISK_LABELS = { medium: msg`Medio`, high: msg`Alto` };

function nameToHue(name) {
  let hue = 0;
  for (let index = 0; index < (name || '').length; index += 1) {
    hue = (hue * 31 + name.charCodeAt(index)) % 360;
  }
  return hue;
}

function fmtRelative(t, iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return t`ahora`;
  if (ms < 3600000) return t`${Math.floor(ms / 60000)} min`;
  if (ms < 86400000) return t`${Math.floor(ms / 3600000)} h`;
  if (ms < 7 * 86400000) return t`${Math.floor(ms / 86400000)} d`;
  return formatDate(iso);
}

/** The two initials the avatar prints, or a question mark when the name is absent. */
function initialsOf(name) {
  return (name || '?')
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const StaffScreen = () => {
  const { t, i18n } = useLingui();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [refresh, setRefresh] = useState(0);
  const [rosterError, setRosterError] = useState(null);
  const [section, setSection] = useState('people');
  const [roleRefresh, setRoleRefresh] = useState(0);
  const { capabilities, platformRole } = useMerchant();
  const membership = capabilities?.membership;
  const canAssignAdmin =
    platformRole === 'super_admin' ||
    membership?.role === 'owner' ||
    membership?.permissions?.includes?.('*');
  const { data: staffData, loading } = useStaffData(refresh);
  const { data: roleData, loading: rolesLoading } = useRolesData(roleRefresh);
  const roles = (roleData?.roles || []).filter((role) => role.status === 'active');
  const permissions = roleData?.permissions || [];
  const staff = staffData?.staff || [];
  const activeStaff = staff.filter((person) => person.status !== 'disabled');
  const filtered =
    filter === 'ALL' ? activeStaff : activeStaff.filter((person) => person.roleId === filter);
  const reload = () => setRefresh((value) => value + 1);
  const reloadRoles = () => {
    setRoleRefresh((value) => value + 1);
    setRefresh((value) => value + 1);
  };

  async function disable(person) {
    try {
      setRosterError(null);
      await deleteStaffMember(person.id);
      reload();
    } catch (error) {
      setRosterError(error.message || t`No se pudo desactivar el acceso.`);
    }
  }

  const people = section === 'people';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* ONE band. The masthead already says the page name, so this line carries the
          set size and the one action of the open section. */}
      <PageHead
        count={
          people ? (
            <Plural value={activeStaff.length} one="# persona" other="# personas" />
          ) : (
            <Plural value={roles.length} one="# rol" other="# roles" />
          )
        }
        actions={
          people ? (
            <button className="btn btn-primary focusable" onClick={() => setInviteOpen(true)}>
              <I.Plus size={16} /> <Trans>Añadir persona</Trans>
            </button>
          ) : null
        }
      />

      <Segmented
        label={t`Secciones de equipo y acceso`}
        value={section}
        onChange={setSection}
        options={[
          { id: 'people', label: <Trans>Personas</Trans> },
          { id: 'roles', label: <Trans>Roles</Trans> },
        ]}
      />

      {people ? (
        <>
          <div className="surface" style={{ overflow: 'hidden' }}>
            {/* The view row. A role is one choice among nine, so it is a select and
                not nine chips: fewer things to read, the same filter. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                flexWrap: 'wrap',
                padding: '12px 16px',
                borderBottom: '1px solid var(--line-soft)',
              }}
            >
              <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                <Trans>Rol</Trans>
              </span>
              <Select
                className="select"
                aria-label={t`Filtrar el equipo por rol`}
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                style={{ minWidth: 200 }}
              >
                <option value="ALL">{t`Todos`}</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </Select>
            </div>

            {rosterError ? (
              <div
                role="alert"
                style={{
                  padding: '12px 16px',
                  fontSize: 13.5,
                  color: 'var(--danger)',
                  borderBottom: '1px solid var(--line-soft)',
                }}
              >
                {rosterError}
              </div>
            ) : null}

            {filtered.length === 0 && !loading ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 12,
                  padding: '48px 24px',
                  textAlign: 'center',
                }}
              >
                <span style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
                  {filter === 'ALL'
                    ? t`No hay personas activas en el equipo.`
                    : t`No hay personas con ese rol.`}
                </span>
                <button
                  className="btn btn-secondary btn-sm focusable"
                  onClick={() => (filter === 'ALL' ? setInviteOpen(true) : setFilter('ALL'))}
                >
                  {filter === 'ALL' ? t`Añadir persona` : t`Limpiar`}
                </button>
              </div>
            ) : (
              filtered.map((person) => {
                const hue = nameToHue(person.name || 'X');
                const isAdmin = person.role === 'ADMIN';
                const locked = isAdmin && !canAssignAdmin;
                const roleLabel =
                  person.roleName ||
                  (ROLE_LABELS[person.role] && i18n._(ROLE_LABELS[person.role])) ||
                  person.role;
                return (
                  <div
                    key={person.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 16,
                      flexWrap: 'wrap',
                      padding: '12px 16px',
                      borderTop: '1px solid var(--line-soft)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        flex: 1,
                        minWidth: 220,
                      }}
                    >
                      <div
                        className="avatar-lg"
                        style={{
                          background: `oklch(0.78 0.08 ${hue})`,
                          color: `oklch(0.28 0.08 ${hue})`,
                        }}
                      >
                        {initialsOf(person.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{person.name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                          {person.email || t`Sin correo`}
                          {person.phone ? ` · ${person.phone}` : ''}
                        </div>
                      </div>
                    </div>
                    {/* A role is a fact, not a status, so it reads in ink. The lock
                        marks the two roles that only an owner may hand out. */}
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        minWidth: 132,
                        fontSize: 13.5,
                        color: 'var(--ink-2)',
                      }}
                    >
                      {isAdmin ? <I.Lock size={12} /> : null}
                      {roleLabel}
                    </span>
                    <span style={{ minWidth: 116, fontSize: 13.5, color: 'var(--ink-2)' }}>
                      {person.hasOperatorPin ? t`PIN configurado` : t`Sin PIN`}
                    </span>
                    <Menu
                      align="end"
                      label={t`Acciones de ${person.name}`}
                      items={[
                        {
                          key: 'access',
                          label: t`Administrar acceso al POS`,
                          icon: I.Edit,
                          disabled: locked,
                          onSelect: () => setSelectedStaff(person),
                        },
                        {
                          key: 'disable',
                          label: t`Desactivar acceso`,
                          icon: I.Trash,
                          danger: true,
                          disabled: locked,
                          onSelect: () => disable(person),
                        },
                      ]}
                      renderTrigger={({ ref, props }) => (
                        <button
                          type="button"
                          ref={ref}
                          className="btn btn-ghost btn-sm"
                          aria-label={t`Acciones de ${person.name}`}
                          disabled={locked}
                          title={
                            locked
                              ? t`Solo el propietario puede administrar un acceso Admin.`
                              : t`Administrar rol y PIN`
                          }
                          {...props}
                        >
                          <I.MoreH size={16} />
                        </button>
                      )}
                    />
                  </div>
                );
              })
            )}
          </div>

          {inviteOpen ? (
            <InvitePanel
              roles={roles}
              canAssignAdmin={canAssignAdmin}
              onClose={() => setInviteOpen(false)}
              onCreate={async (person) => {
                await createStaffMember(person);
                setInviteOpen(false);
                reload();
              }}
            />
          ) : null}
          {selectedStaff ? (
            <AccessPanel
              person={selectedStaff}
              roles={roles}
              canAssignAdmin={canAssignAdmin}
              onClose={() => setSelectedStaff(null)}
              onUpdate={async (patch) => {
                await updateStaffMember(selectedStaff.id, patch);
                setSelectedStaff(null);
                reload();
              }}
            />
          ) : null}
        </>
      ) : (
        <RolesWorkspace
          roles={roles}
          permissions={permissions}
          canManage={canAssignAdmin}
          loading={rolesLoading}
          onReload={reloadRoles}
        />
      )}
    </div>
  );
};

function RolesWorkspace({ roles, permissions, canManage, loading, onReload }) {
  const { t } = useLingui();
  const [selectedId, setSelectedId] = useState(
    roles.find((role) => role.key === 'admin')?.id || roles[0]?.id || '',
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState(null);
  const selected = roles.find((role) => role.id === selectedId) || roles[0];

  const createRole = async () => {
    if (!canManage || creating) return;
    setCreating(true);
    setError(null);
    try {
      const result = await createMerchantRole({
        name: t`Nuevo rol`,
        description: t`Configura los permisos de este rol.`,
        permissionKeys: [],
      });
      setSelectedId(result.role.id);
      onReload();
    } catch (createError) {
      setError(createError.message || t`No se pudo crear el rol.`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="roles-workspace">
      <div className="surface" style={{ padding: 12 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '4px 8px 12px',
          }}
        >
          <strong style={{ fontSize: 13.5 }}>
            <Trans>Roles del comercio</Trans>
          </strong>
          <button
            className="btn-icon focusable"
            aria-label={t`Crear un rol`}
            title={canManage ? t`Crear un rol` : t`Solo el propietario puede crear roles.`}
            disabled={!canManage || creating}
            onClick={createRole}
          >
            <I.Plus size={15} />
          </button>
        </div>
        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', fontSize: 13.5, padding: 8 }}>
            {error}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {roles.map((role) => (
            <button
              key={role.id}
              className={`role-list-item ${selected?.id === role.id ? 'on' : ''}`}
              onClick={() => setSelectedId(role.id)}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 13.5,
                  fontWeight: 600,
                }}
              >
                {role.key === 'owner' || role.key === 'admin' ? <I.Lock size={12} /> : null}
                {role.name}
              </span>
              <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
                <Plural value={role.assignedCount} one="# persona" other="# personas" /> ·{' '}
                <Plural value={role.permissionKeys.length} one="# permiso" other="# permisos" />
              </span>
            </button>
          ))}
          {roles.length === 0 && !loading ? (
            <span style={{ padding: 12, fontSize: 13.5, color: 'var(--ink-2)' }}>
              <Trans>No hay roles disponibles.</Trans>
            </span>
          ) : null}
        </div>
      </div>
      {selected ? (
        <RoleEditor
          key={`${selected.id}:${selected.revision}`}
          role={selected}
          permissions={permissions}
          canManage={canManage}
          onReload={onReload}
        />
      ) : (
        <div className="surface" style={{ padding: 32, fontSize: 13.5, color: 'var(--ink-2)' }}>
          <Trans>No hay roles disponibles.</Trans>
        </div>
      )}
    </div>
  );
}

function RoleEditor({ role, permissions, canManage, onReload }) {
  const { t, i18n } = useLingui();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || '');
  const [selectedKeys, setSelectedKeys] = useState(new Set(role.permissionKeys));
  const [product, setProduct] = useState('pos');
  const [openGroups, setOpenGroups] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const locked = role.isSystem || !canManage;
  const visible = permissions.filter(
    (permission) => product === 'all' || permission.productKey === product,
  );
  const groups = [...new Set(visible.map((permission) => permission.groupKey))];
  const changed =
    name.trim() !== role.name ||
    description.trim() !== (role.description || '') ||
    role.permissionKeys.length !== selectedKeys.size ||
    role.permissionKeys.some((key) => !selectedKeys.has(key));

  const toggle = (key) => {
    if (locked) return;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (group) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });

  const save = async () => {
    if (!changed || locked || saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await updateMerchantRole(role.id, {
        name: name.trim(),
        description: description.trim() || null,
        permissionKeys: [...selectedKeys],
        expectedRevision: role.revision,
      });
      onReload();
    } catch (saveError) {
      setError(saveError.message || t`No se pudo guardar el rol.`);
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (locked || role.assignedCount || saving) return;
    setSaving(true);
    setError(null);
    try {
      await archiveMerchantRole(role.id, role.revision);
      onReload();
    } catch (archiveError) {
      setError(archiveError.message || t`No se pudo archivar el rol.`);
      setSaving(false);
    }
  };

  return (
    <section className="surface" style={{ overflow: 'hidden' }}>
      <div style={{ padding: 24, borderBottom: '1px solid var(--line-soft)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              className="sheet-title-input"
              aria-label={t`Nombre del rol`}
              maxLength={80}
              value={name}
              disabled={locked}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className="input"
              aria-label={t`Descripción del rol`}
              maxLength={300}
              value={description}
              disabled={locked}
              onChange={(event) => setDescription(event.target.value)}
              style={{ marginTop: 12 }}
            />
          </div>
          <div style={{ textAlign: 'right', color: 'var(--ink-3)', fontSize: 11.5 }}>
            <div>
              <Plural
                value={role.assignedCount}
                one="# persona afectada"
                other="# personas afectadas"
              />
            </div>
            <div>
              <Trans>Revisión {role.revision}</Trans>
            </div>
          </div>
        </div>
        {role.isSystem ? (
          <div style={{ marginTop: 12, color: 'var(--ink-2)', fontSize: 13.5 }}>
            <Trans>El rol Owner está protegido.</Trans>
          </div>
        ) : null}
      </div>

      <div style={{ padding: '12px 24px' }}>
        <Segmented
          label={t`Filtrar permisos por producto`}
          value={product}
          onChange={setProduct}
          options={['all', 'pos', 'dashboard', 'kds', 'cash'].map((value) => ({
            id: value,
            label: value === 'all' ? t`Todos` : value.toUpperCase(),
          }))}
        />
      </div>

      {/* PROGRESSIVE DISCLOSURE. The old body held one checkbox per permission —
          94 controls on the POS filter alone — and the owner read the whole wall to
          answer one question: what can this role do? A group answers that question
          in one line. The checkboxes appear on request. */}
      <div style={{ maxHeight: 520, overflow: 'auto', borderTop: '1px solid var(--line-soft)' }}>
        {groups.map((group) => {
          const rows = visible.filter((permission) => permission.groupKey === group);
          const granted = rows.filter((permission) => selectedKeys.has(permission.key)).length;
          const open = openGroups.has(group);
          return (
            <div key={group}>
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggleGroup(group)}
                className="focusable"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  width: '100%',
                  minHeight: 48,
                  padding: '12px 24px',
                  border: 'none',
                  borderTop: '1px solid var(--line-soft)',
                  background: 'transparent',
                  color: 'inherit',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <I.ChevronDown
                  size={14}
                  style={{
                    transform: open ? 'rotate(180deg)' : 'none',
                    transition: 'transform 160ms var(--ease)',
                  }}
                />
                <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>
                  {i18n._(GROUP_LABELS[group] || GROUP_LABELS_OTHER)}
                </span>
                <span className="status-plain">
                  {granted} / {rows.length}
                </span>
              </button>
              {open
                ? rows.map((permission) => (
                    <label key={permission.key} className="permission-row">
                      <input
                        type="checkbox"
                        checked={selectedKeys.has(permission.key)}
                        disabled={locked || !permission.delegable}
                        onChange={() => toggle(permission.key)}
                      />
                      <span style={{ flex: 1, fontSize: 13.5 }}>{permission.description}</span>
                      {RISK_LABELS[permission.riskLevel] ? (
                        <span className={`risk-chip risk-${permission.riskLevel}`}>
                          {i18n._(RISK_LABELS[permission.riskLevel])}
                        </span>
                      ) : null}
                    </label>
                  ))
                : null}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          padding: '16px 24px',
          borderTop: '1px solid var(--line-soft)',
        }}
      >
        <div>
          {error ? (
            <span role="alert" style={{ color: 'var(--danger)', fontSize: 13.5 }}>
              {error}
            </span>
          ) : null}
          {!error && role.assignedCount ? (
            <span style={{ color: 'var(--ink-2)', fontSize: 13.5 }}>
              <Trans>Reasigna al equipo antes de archivar.</Trans>
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost"
            disabled={locked || Boolean(role.assignedCount) || saving}
            onClick={archive}
          >
            <Trans>Archivar</Trans>
          </button>
          <button
            className="btn btn-primary focusable"
            disabled={!changed || locked || saving || !name.trim()}
            onClick={save}
          >
            {saving ? <Trans>Guardando…</Trans> : <Trans>Guardar rol</Trans>}
          </button>
        </div>
      </div>
    </section>
  );
}

function RolePicker({ roles, roleId, setRoleId, canAssignAdmin, currentRoleId }) {
  const { t } = useLingui();
  const selected = roles.find((role) => role.id === roleId);
  return (
    <div className="field">
      <span className="field-label">
        <Trans>Rol</Trans>
      </span>
      <div className="role-tabs" role="tablist" aria-label={t`Seleccionar el rol`}>
        {roles.map((role) => {
          const protectedRole = role.key === 'owner' || role.key === 'admin';
          const disabled = protectedRole && !canAssignAdmin && currentRoleId !== role.id;
          return (
            <button
              key={role.id}
              type="button"
              role="tab"
              aria-selected={roleId === role.id}
              className={`badge ${protectedRole ? 'badge-admin' : 'badge-staff'} role-tab ${roleId === role.id ? 'on' : ''}`}
              disabled={disabled}
              title={disabled ? t`Solo el propietario puede asignar este rol.` : undefined}
              onClick={() => setRoleId(role.id)}
            >
              {protectedRole ? <I.Lock size={10} /> : null} {role.name}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>
        {selected?.description || t`Los permisos del rol se administran en Roles.`}
      </div>
    </div>
  );
}

function PinFields({ uid, pin, confirmation, setPin, setConfirmation, hasExistingPin }) {
  const { t } = useLingui();
  return (
    <>
      <div className="field">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <label htmlFor={`${uid}-pin`}>
            <Trans>PIN del POS (opcional)</Trans>
          </label>
          {hasExistingPin !== undefined ? (
            <span
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11.5,
                fontWeight: 600,
                color: hasExistingPin ? 'var(--success)' : 'var(--ink-3)',
              }}
            >
              {hasExistingPin ? <I.Check size={12} /> : <I.X size={11} />}
              {hasExistingPin ? <Trans>PIN activo</Trans> : <Trans>Sin PIN</Trans>}
            </span>
          ) : null}
        </div>
        <input
          id={`${uid}-pin`}
          className="input tall"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          placeholder={t`4 a 8 dígitos`}
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-pin-confirmation`}>
          <Trans>Confirmar el PIN</Trans>
        </label>
        <input
          id={`${uid}-pin-confirmation`}
          className="input tall"
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          maxLength={8}
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value.replace(/\D/g, ''))}
        />
        <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
          <Trans>El Dashboard nunca muestra un PIN guardado.</Trans>
        </div>
      </div>
    </>
  );
}

const InvitePanel = ({ roles, canAssignAdmin, onClose, onCreate }) => {
  const { t } = useLingui();
  const uid = useId();
  const defaultRoleId = roles.find((role) => role.key === 'staff')?.id || roles[0]?.id || '';
  const [form, setForm] = useState({
    name: '',
    phone: '',
    roleId: defaultRoleId,
    pin: '',
    confirmation: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const validPin = !form.pin || (/^\d{4,8}$/.test(form.pin) && form.pin === form.confirmation);
  const valid = form.name.trim() && form.phone.trim() && form.roleId && validPin;
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({
        name: form.name.trim(),
        phone: form.phone.trim(),
        roleId: form.roleId,
        ...(form.pin ? { operatorPin: form.pin } : {}),
      });
    } catch (submitError) {
      setError(submitError.message || t`No se pudo añadir a la persona.`);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet title={t`Añadir una persona`} eyebrow={t`Equipo y accesos`} onClose={onClose}>
      <div className="sheet-body">
        <div className="field">
          <label htmlFor={`${uid}-name`}>
            <Trans>Nombre completo</Trans>
          </label>
          <input
            id={`${uid}-name`}
            className="input tall"
            placeholder={t`María García`}
            value={form.name}
            onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-phone`}>
            <Trans>Teléfono</Trans>
          </label>
          <input
            id={`${uid}-phone`}
            className="input tall"
            type="tel"
            placeholder="+52 ..."
            value={form.phone}
            onChange={(event) => setForm((value) => ({ ...value, phone: event.target.value }))}
          />
        </div>
        <RolePicker
          roles={roles}
          roleId={form.roleId}
          setRoleId={(roleId) => setForm((value) => ({ ...value, roleId }))}
          canAssignAdmin={canAssignAdmin}
        />
        <PinFields
          uid={uid}
          pin={form.pin}
          confirmation={form.confirmation}
          setPin={(pin) => setForm((value) => ({ ...value, pin }))}
          setConfirmation={(confirmation) => setForm((value) => ({ ...value, confirmation }))}
        />
      </div>
      <SheetFooter
        error={
          error || (!validPin ? t`El PIN debe tener de 4 a 8 dígitos y debe coincidir.` : null)
        }
        saving={saving}
        valid={Boolean(valid)}
        onClose={onClose}
        onSave={submit}
        saveLabel={t`Añadir persona`}
      />
    </Sheet>
  );
};

const AccessPanel = ({ person, roles, canAssignAdmin, onClose, onUpdate }) => {
  const { t } = useLingui();
  const uid = useId();
  const [name, setName] = useState(person.name);
  const [roleId, setRoleId] = useState(person.roleId || '');
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const validPin = !pin || (/^\d{4,8}$/.test(pin) && pin === confirmation);
  const validName = Boolean(name.trim());
  const changed = name.trim() !== person.name || roleId !== person.roleId || Boolean(pin);
  const save = async () => {
    if (!changed || !validPin || !validName || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate({
        ...(name.trim() !== person.name ? { name: name.trim() } : {}),
        ...(roleId !== person.roleId ? { roleId } : {}),
        ...(pin ? { operatorPin: pin } : {}),
      });
    } catch (submitError) {
      setError(submitError.message || t`No se pudo guardar el acceso.`);
      setSaving(false);
    }
  };
  const clearPin = async () => {
    if (!person.hasOperatorPin || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate({ operatorPin: null });
    } catch (submitError) {
      setError(submitError.message || t`No se pudo quitar el PIN.`);
      setSaving(false);
    }
  };
  return (
    <Sheet
      title={
        <input
          className="sheet-title-input"
          aria-label={t`Nombre de la persona`}
          maxLength={160}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      }
      eyebrow={t`Administrar acceso al POS`}
      onClose={onClose}
      topContent={
        <RolePicker
          roles={roles}
          roleId={roleId}
          setRoleId={setRoleId}
          canAssignAdmin={canAssignAdmin}
          currentRoleId={person.roleId}
        />
      }
    >
      <div className="sheet-body">
        <PinFields
          uid={uid}
          pin={pin}
          confirmation={confirmation}
          setPin={setPin}
          setConfirmation={setConfirmation}
          hasExistingPin={person.hasOperatorPin}
        />
        {person.hasOperatorPin ? (
          <button className="btn btn-ghost" disabled={saving} onClick={clearPin}>
            <Trans>Quitar el PIN actual</Trans>
          </button>
        ) : null}
        {/* The roster no longer spends a column on tenure. The fact belongs to the
            record of the person, and this sheet is that record. */}
        <div className="quiet-row">
          <span className="quiet-label">
            <Trans>Desde</Trans>
          </span>
          <span className="quiet-value">
            {person.createdAt ? fmtRelative(t, person.createdAt) : '—'}
          </span>
        </div>
      </div>
      <SheetFooter
        error={
          error ||
          (!validName
            ? t`Escribe el nombre de la persona.`
            : !validPin
              ? t`El PIN debe tener de 4 a 8 dígitos y debe coincidir.`
              : null)
        }
        saving={saving}
        valid={changed && validPin && validName}
        onClose={onClose}
        onSave={save}
        saveLabel={t`Guardar acceso`}
      />
    </Sheet>
  );
};

function Sheet({ title, eyebrow, onClose, topContent, children }) {
  const { t } = useLingui();
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet" aria-label={typeof title === 'string' ? title : eyebrow}>
        <div className="sheet-head">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              {title}
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label={t`Cerrar`}>
            <I.X size={16} />
          </button>
        </div>
        {topContent ? (
          <div
            style={{
              padding: '0 24px 16px',
              borderBottom: '1px solid var(--line-soft)',
            }}
          >
            {topContent}
          </div>
        ) : null}
        {children}
      </aside>
    </>
  );
}

function SheetFooter({ error, saving, valid, onClose, onSave, saveLabel }) {
  return (
    <div className="sheet-foot">
      {error ? (
        <span role="alert" style={{ flex: 1, fontSize: 13.5, color: 'var(--danger)' }}>
          {error}
        </span>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
        <Trans>Cancelar</Trans>
      </button>
      <button
        className="btn btn-primary focusable"
        disabled={!valid || saving}
        style={{ opacity: valid && !saving ? 1 : 0.5 }}
        onClick={onSave}
      >
        {saving ? <Trans>Guardando…</Trans> : saveLabel}
      </button>
    </div>
  );
}

export default StaffScreen;
