import { useId, useState } from 'react';
import { I } from '@/icons.jsx';
import { RegionHead } from '@/shell.jsx';
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

const ROLE_LABELS = { ADMIN: 'Admin', STAFF: 'Barista' };

function nameToHue(name) {
  let hue = 0;
  for (let index = 0; index < (name || '').length; index += 1) {
    hue = (hue * 31 + name.charCodeAt(index)) % 360;
  }
  return hue;
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'ahora';
  if (ms < 3600000) return `${Math.floor(ms / 60000)} min`;
  if (ms < 86400000) return `${Math.floor(ms / 3600000)} h`;
  if (ms < 7 * 86400000) return `${Math.floor(ms / 86400000)} d`;
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

const StaffScreen = () => {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="seg" role="tablist" aria-label="Secciones de equipo y acceso">
        <button className={section === 'people' ? 'on' : ''} onClick={() => setSection('people')}>
          Personas
        </button>
        <button className={section === 'roles' ? 'on' : ''} onClick={() => setSection('roles')}>
          Roles y permisos
        </button>
      </div>
      <RegionHead
        title={section === 'people' ? 'Equipo y acceso al POS' : 'Roles y permisos'}
        note={
          section === 'people'
            ? loading
              ? 'Cargando…'
              : `${activeStaff.filter((person) => person.role === 'ADMIN').length} con rol Admin.`
            : rolesLoading
              ? 'Cargando…'
              : 'Define lo que cada rol puede hacer en el POS y el Dashboard.'
        }
        count={
          section === 'people'
            ? { value: activeStaff.length, label: 'personas' }
            : { value: roles.length, label: 'roles' }
        }
        actions={
          section === 'people' ? (
            <>
              <div className="seg" role="tablist" aria-label="Filtrar el equipo por rol">
                {[{ id: 'ALL', name: 'Todos' }, ...roles].map((role) => (
                  <button
                    key={role.id}
                    className={filter === role.id ? 'on' : ''}
                    onClick={() => setFilter(role.id)}
                  >
                    {role.name}
                  </button>
                ))}
              </div>
              <button className="btn btn-primary focusable" onClick={() => setInviteOpen(true)}>
                <I.Plus size={16} /> Añadir persona
              </button>
            </>
          ) : null
        }
      />

      {section === 'people' ? (
        <>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {rosterError ? (
              <div
                role="alert"
                style={{
                  padding: '12px 20px',
                  fontSize: 12.5,
                  color: 'var(--danger)',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                {rosterError}
              </div>
            ) : null}
            {filtered.length === 0 && !loading ? (
              <div style={{ padding: '48px 32px', textAlign: 'center', color: 'var(--ink-3)' }}>
                {filter === 'ALL'
                  ? 'No hay personas activas en el equipo.'
                  : `No hay personas con el rol ${roles.find((role) => role.id === filter)?.name || ''}.`}
              </div>
            ) : (
              <table className="matrix">
                <thead>
                  <tr>
                    <th style={{ width: '32%' }}>Persona</th>
                    <th>Rol</th>
                    <th>Acceso al POS</th>
                    <th>Teléfono</th>
                    <th>Desde</th>
                    <th style={{ width: 104 }}>
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((person) => {
                    const hue = nameToHue(person.name || 'X');
                    const initials = (person.name || '?')
                      .split(' ')
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join('')
                      .toUpperCase();
                    return (
                      <tr key={person.id}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div
                              className="avatar-lg"
                              style={{
                                background: `oklch(0.78 0.08 ${hue})`,
                                color: `oklch(0.28 0.08 ${hue})`,
                              }}
                            >
                              {initials}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: 14 }}>{person.name}</div>
                              <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                                {person.email || 'Sin correo'}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`badge ${person.role === 'ADMIN' ? 'badge-admin' : 'badge-staff'}`}
                          >
                            {person.role === 'ADMIN' ? <I.Lock size={10} /> : null}
                            {person.roleName || ROLE_LABELS[person.role] || person.role}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                            {person.hasOperatorPin ? 'PIN configurado' : 'Sin PIN'}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                          {person.phone || '—'}
                        </td>
                        <td style={{ color: 'var(--ink-2)', fontSize: 13 }}>
                          {fmtRelative(person.createdAt)}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button
                              className="btn-icon"
                              aria-label={`Administrar acceso de ${person.name}`}
                              title={
                                person.role === 'ADMIN' && !canAssignAdmin
                                  ? 'Solo el propietario puede administrar un acceso Admin.'
                                  : 'Administrar rol y PIN'
                              }
                              disabled={person.role === 'ADMIN' && !canAssignAdmin}
                              onClick={() => setSelectedStaff(person)}
                            >
                              <I.Edit size={15} />
                            </button>
                            <button
                              className="btn-icon"
                              aria-label={`Desactivar a ${person.name}`}
                              title={
                                person.role === 'ADMIN' && !canAssignAdmin
                                  ? 'Solo el propietario puede administrar un acceso Admin.'
                                  : 'Desactivar acceso'
                              }
                              disabled={person.role === 'ADMIN' && !canAssignAdmin}
                              onClick={async () => {
                                try {
                                  setRosterError(null);
                                  await deleteStaffMember(person.id);
                                  reload();
                                } catch (error) {
                                  setRosterError(
                                    error.message || 'No se pudo desactivar el acceso.',
                                  );
                                }
                              }}
                            >
                              <I.Trash size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
          onReload={reloadRoles}
        />
      )}
    </div>
  );
};

function RolesWorkspace({ roles, permissions, canManage, onReload }) {
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
        name: 'Nuevo rol',
        description: 'Configura los permisos de este rol.',
        permissionKeys: [],
      });
      setSelectedId(result.role.id);
      onReload();
    } catch (createError) {
      setError(createError.message || 'No se pudo crear el rol.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="roles-workspace">
      <div className="card" style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 6px 12px' }}>
          <strong>Roles del comercio</strong>
          <button
            className="btn-icon"
            aria-label="Crear un rol"
            title={canManage ? 'Crear un rol' : 'Solo el propietario puede crear roles.'}
            disabled={!canManage || creating}
            onClick={createRole}
          >
            <I.Plus size={15} />
          </button>
        </div>
        {error ? (
          <div role="alert" style={{ color: 'var(--danger)', padding: 8 }}>
            {error}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {roles.map((role) => (
            <button
              key={role.id}
              className={`role-list-item ${selected?.id === role.id ? 'on' : ''}`}
              onClick={() => setSelectedId(role.id)}
            >
              <span
                className={`badge ${role.key === 'owner' || role.key === 'admin' ? 'badge-admin' : 'badge-staff'}`}
              >
                {role.key === 'owner' || role.key === 'admin' ? <I.Lock size={10} /> : null}
                {role.name}
              </span>
              <span style={{ color: 'var(--ink-3)', fontSize: 11.5 }}>
                {role.assignedCount} personas · {role.permissionKeys.length} permisos
              </span>
            </button>
          ))}
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
        <div className="card" style={{ padding: 32, color: 'var(--ink-3)' }}>
          No hay roles disponibles.
        </div>
      )}
    </div>
  );
}

function RoleEditor({ role, permissions, canManage, onReload }) {
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description || '');
  const [selectedKeys, setSelectedKeys] = useState(new Set(role.permissionKeys));
  const [product, setProduct] = useState('pos');
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
      setError(saveError.message || 'No se pudo guardar el rol.');
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
      setError(archiveError.message || 'No se pudo archivar el rol.');
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: 24, borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <input
              className="sheet-title-input"
              aria-label="Nombre del rol"
              maxLength={80}
              value={name}
              disabled={locked}
              onChange={(event) => setName(event.target.value)}
            />
            <input
              className="input"
              aria-label="Descripción del rol"
              maxLength={300}
              value={description}
              disabled={locked}
              onChange={(event) => setDescription(event.target.value)}
              style={{ marginTop: 10 }}
            />
          </div>
          <div style={{ textAlign: 'right', color: 'var(--ink-3)', fontSize: 12 }}>
            <div>{role.assignedCount} personas afectadas</div>
            <div>Revisión {role.revision}</div>
            {role.sourceTemplateKey ? <div>Plantilla {role.sourceTemplateKey}</div> : null}
          </div>
        </div>
        {role.isSystem ? (
          <div style={{ marginTop: 12, color: 'var(--ink-3)', fontSize: 12 }}>
            El rol Owner está protegido.
          </div>
        ) : null}
      </div>
      <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--line)' }}>
        <div className="seg" role="tablist" aria-label="Filtrar permisos por producto">
          {['all', 'pos', 'dashboard', 'kds', 'cash'].map((value) => (
            <button
              key={value}
              className={product === value ? 'on' : ''}
              onClick={() => setProduct(value)}
            >
              {value === 'all' ? 'Todos' : value.toUpperCase()}
            </button>
          ))}
        </div>
      </div>
      <div style={{ maxHeight: 520, overflow: 'auto' }}>
        {groups.map((group) => (
          <div key={group}>
            <div className="permission-group-title">{group.replaceAll('_', ' ')}</div>
            {visible
              .filter((permission) => permission.groupKey === group)
              .map((permission) => (
                <label key={permission.key} className="permission-row">
                  <input
                    type="checkbox"
                    checked={selectedKeys.has(permission.key)}
                    disabled={locked || !permission.delegable}
                    onChange={() => toggle(permission.key)}
                  />
                  <span style={{ flex: 1 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                      {permission.key}
                    </span>
                    {permission.description ? (
                      <span style={{ display: 'block', color: 'var(--ink-3)', fontSize: 11.5 }}>
                        {permission.description}
                      </span>
                    ) : null}
                  </span>
                  <span className={`risk-chip risk-${permission.riskLevel}`}>
                    {permission.riskLevel}
                  </span>
                </label>
              ))}
          </div>
        ))}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          padding: 20,
          borderTop: '1px solid var(--line)',
        }}
      >
        <div>
          {error ? (
            <span role="alert" style={{ color: 'var(--danger)', fontSize: 12 }}>
              {error}
            </span>
          ) : null}
          {!error && role.assignedCount ? (
            <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>
              Reasigna al equipo antes de archivar.
            </span>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-ghost"
            disabled={locked || Boolean(role.assignedCount) || saving}
            onClick={archive}
          >
            Archivar
          </button>
          <button
            className="btn btn-primary"
            disabled={!changed || locked || saving || !name.trim()}
            onClick={save}
          >
            {saving ? 'Guardando…' : 'Guardar rol'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RolePicker({ roles, roleId, setRoleId, canAssignAdmin, currentRoleId }) {
  const selected = roles.find((role) => role.id === roleId);
  return (
    <div className="field">
      <span className="field-label">Rol</span>
      <div className="role-tabs" role="tablist" aria-label="Seleccionar el rol">
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
              title={disabled ? 'Solo el propietario puede asignar este rol.' : undefined}
              onClick={() => setRoleId(role.id)}
            >
              {protectedRole ? <I.Lock size={10} /> : null} {role.name}
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
        {selected?.description || 'Los permisos del rol se administran en Roles y permisos.'}
      </div>
    </div>
  );
}

function PinFields({ uid, pin, confirmation, setPin, setConfirmation, hasExistingPin }) {
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
          <label htmlFor={`${uid}-pin`}>PIN del POS (opcional)</label>
          {hasExistingPin !== undefined ? (
            <span
              role="status"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 8px',
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 600,
                color: hasExistingPin ? 'var(--success)' : 'var(--ink-3)',
                background: hasExistingPin ? 'var(--success-soft)' : 'var(--line-soft)',
              }}
            >
              {hasExistingPin ? <I.Check size={12} /> : <I.X size={11} />}
              {hasExistingPin ? 'PIN activo' : 'Sin PIN'}
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
          placeholder="4 a 8 dígitos"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        />
      </div>
      <div className="field">
        <label htmlFor={`${uid}-pin-confirmation`}>Confirmar el PIN</label>
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
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          El Dashboard nunca muestra un PIN guardado.
        </div>
      </div>
    </>
  );
}

const InvitePanel = ({ roles, canAssignAdmin, onClose, onCreate }) => {
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
      setError(submitError.message || 'No se pudo añadir a la persona.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet title="Añadir una persona" eyebrow="Equipo y accesos" onClose={onClose}>
      <div className="sheet-body">
        <div className="field">
          <label htmlFor={`${uid}-name`}>Nombre completo</label>
          <input
            id={`${uid}-name`}
            className="input tall"
            placeholder="María García"
            value={form.name}
            onChange={(event) => setForm((value) => ({ ...value, name: event.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-phone`}>Teléfono</label>
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
        error={error || (!validPin ? 'El PIN debe tener de 4 a 8 dígitos y debe coincidir.' : null)}
        saving={saving}
        valid={Boolean(valid)}
        onClose={onClose}
        onSave={submit}
        saveLabel="Añadir persona"
      />
    </Sheet>
  );
};

const AccessPanel = ({ person, roles, canAssignAdmin, onClose, onUpdate }) => {
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
      setError(submitError.message || 'No se pudo guardar el acceso.');
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
      setError(submitError.message || 'No se pudo quitar el PIN.');
      setSaving(false);
    }
  };
  return (
    <Sheet
      title={
        <input
          className="sheet-title-input"
          aria-label="Nombre de la persona"
          maxLength={160}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      }
      eyebrow="Administrar acceso al POS"
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
            Quitar el PIN actual
          </button>
        ) : null}
      </div>
      <SheetFooter
        error={
          error ||
          (!validName
            ? 'Escribe el nombre de la persona.'
            : !validPin
              ? 'El PIN debe tener de 4 a 8 dígitos y debe coincidir.'
              : null)
        }
        saving={saving}
        valid={changed && validPin && validName}
        onClose={onClose}
        onSave={save}
        saveLabel="Guardar acceso"
      />
    </Sheet>
  );
};

function Sheet({ title, eyebrow, onClose, topContent, children }) {
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <aside className="sheet" aria-label={title}>
        <div className="sheet-head">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              {title}
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Cerrar">
            <I.X size={16} />
          </button>
        </div>
        {topContent ? (
          <div
            style={{
              padding: '0 24px 16px',
              borderBottom: '1px solid var(--line)',
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
        <span role="alert" style={{ flex: 1, fontSize: 12.5, color: 'var(--danger)' }}>
          {error}
        </span>
      ) : (
        <span style={{ flex: 1 }} />
      )}
      <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
        Cancelar
      </button>
      <button
        className="btn btn-primary focusable"
        disabled={!valid || saving}
        style={{ opacity: valid && !saving ? 1 : 0.5 }}
        onClick={onSave}
      >
        {saving ? 'Guardando…' : saveLabel}
      </button>
    </div>
  );
}

export default StaffScreen;
