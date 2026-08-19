import { useState, useId } from 'react';
import { I } from '@/icons.jsx';
import { RegionHead } from '@/shell.jsx';
import { createStaffMember, deleteStaffMember, useStaffData } from '@/data.jsx';

// Screen 4 — Staff & Access
// Data: useStaffData() → merchant.staff scoped by merchant

const PERMS = [
  { id: 'scan', label: 'Escanear el QR del cliente', sub: 'Registrar visitas y canjear premios' },
  { id: 'topup', label: 'Abonar al monedero', sub: 'Agregar saldo a una tarjeta' },
  { id: 'analytics', label: 'Ver analítica', sub: 'Panel de métricas e informes' },
  { id: 'settings', label: 'Cambiar los ajustes del negocio', sub: 'Horarios, marca, promociones' },
  { id: 'staff', label: 'Administrar el equipo', sub: 'Invitar, quitar y cambiar roles' },
  { id: 'giftcards', label: 'Ver tarjetas de regalo', sub: 'Tarjetas emitidas y sus saldos' },
];

const DEFAULT_MATRIX = {
  ADMIN: { scan: true, topup: true, analytics: true, settings: true, staff: true, giftcards: true },
  STAFF: {
    scan: true,
    topup: true,
    analytics: false,
    settings: false,
    staff: false,
    giftcards: false,
  },
};

// Avatar hue from name — deterministic so the same user always gets same color
function nameToHue(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000) return 'just now';
  if (ms < 3600000) return Math.floor(ms / 60000) + ' min ago';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h ago';
  if (ms < 7 * 86400000) return Math.floor(ms / 86400000) + 'd ago';
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

const StaffScreen = () => {
  const [inviteOpen, setInviteOpen] = useState(false);
  const [matrix, setMatrix] = useState(DEFAULT_MATRIX);
  const [filter, setFilter] = useState('ALL');
  const [refresh, setRefresh] = useState(0);
  const [rosterError, setRosterError] = useState(null);

  const { data: staffData, loading } = useStaffData(refresh);
  const staff = (staffData && staffData.staff) || [];
  const activeStaff = staff.filter((s) => s.status !== 'disabled');
  const filtered = filter === 'ALL' ? activeStaff : activeStaff.filter((s) => s.role === filter);

  const togglePerm = (role, perm) => {
    setMatrix((m) => ({ ...m, [role]: { ...m[role], [perm]: !m[role][perm] } }));
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <RegionHead
        title="Equipo activo"
        note={
          loading
            ? 'Cargando…'
            : `${activeStaff.filter((s) => s.role === 'ADMIN').length} con acceso de administrador.`
        }
        count={{ value: activeStaff.length, label: 'personas' }}
        actions={
          <>
            <div className="seg" role="tablist">
              {['ALL', 'ADMIN', 'STAFF'].map((f) => (
                <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'ALL' ? 'Todos' : f.charAt(0) + f.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            <button className="btn btn-primary focusable" onClick={() => setInviteOpen(true)}>
              <I.Plus size={16} /> Invitar
            </button>
          </>
        }
      />

      {/* Roster table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Disabling a member used to fail in silence — the row simply stayed. */}
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
              ? 'No hay miembros de equipo registrados.'
              : `No hay usuarios con rol ${filter}.`}
          </div>
        ) : (
          <table className="matrix">
            <thead>
              <tr>
                <th style={{ width: '35%' }}>Persona</th>
                <th>Rol</th>
                <th>Teléfono / correo</th>
                <th>Desde</th>
                <th style={{ width: 64 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const hue = nameToHue(s.name || 'X');
                const initials = (s.name || '?')
                  .split(' ')
                  .map((p) => p[0])
                  .slice(0, 2)
                  .join('')
                  .toUpperCase();
                return (
                  <tr key={s.id}>
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
                          <div style={{ fontWeight: 600, fontSize: 14 }}>
                            {s.name || <em style={{ color: 'var(--ink-3)' }}>Sin nombre</em>}
                          </div>
                          <div
                            style={{
                              fontSize: 11.5,
                              color: 'var(--ink-3)',
                              textTransform: 'uppercase',
                              letterSpacing: '0.06em',
                            }}
                          >
                            {s.email || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={'badge ' + (s.role === 'ADMIN' ? 'badge-admin' : 'badge-staff')}
                      >
                        {s.role === 'ADMIN' && <I.Lock size={10} />}
                        {s.role}
                      </span>
                    </td>
                    <td
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12.5,
                        color: 'var(--ink-2)',
                      }}
                    >
                      {s.phone || <span className="no-value" aria-label="Sin teléfono" />}
                    </td>
                    <td style={{ color: 'var(--ink-2)', fontSize: 13 }}>
                      {fmtRelative(s.createdAt)}
                    </td>
                    <td>
                      <button
                        className="btn-icon"
                        aria-label="Disable staff"
                        title="Disable staff"
                        onClick={async () => {
                          try {
                            await deleteStaffMember(s.id);
                            setRefresh((r) => r + 1);
                          } catch (err) {
                            setRosterError(err.message || 'No se pudo desactivar.');
                          }
                        }}
                      >
                        <I.Trash size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Permission matrix */}
      <div className="ed-head" style={{ marginTop: 8 }}>
        <div className="titles">
          <h2>Matriz de permisos</h2>
          <div className="en">Qué puede hacer cada rol en Umi Cash, KDS y ConversaFlow.</div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ width: '40%' }}>Acción</th>
              <th style={{ textAlign: 'center' }}>
                <span className="badge badge-admin" style={{ padding: '4px 10px' }}>
                  <I.Lock size={10} /> ADMIN
                </span>
              </th>
              <th style={{ textAlign: 'center' }}>
                <span className="badge badge-staff" style={{ padding: '4px 10px' }}>
                  STAFF
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {PERMS.map((p) => (
              <tr key={p.id}>
                <td>
                  <div style={{ fontWeight: 600, fontSize: 13.5 }}>{p.label}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{p.sub}</div>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div
                    className={'switch ' + (matrix.ADMIN[p.id] ? 'on' : '')}
                    style={{ display: 'inline-block' }}
                    onClick={() => togglePerm('ADMIN', p.id)}
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <div
                    className={'switch ' + (matrix.STAFF[p.id] ? 'on' : '')}
                    style={{ display: 'inline-block' }}
                    onClick={() => togglePerm('STAFF', p.id)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviteOpen && (
        <InvitePanel
          onClose={() => setInviteOpen(false)}
          onCreate={async (s) => {
            await createStaffMember(s);
            setInviteOpen(false);
            setRefresh((r) => r + 1);
          }}
        />
      )}
    </div>
  );
};

const InvitePanel = ({ onClose, onCreate }) => {
  const uid = useId();
  const [form, setForm] = useState({ name: '', phone: '', role: 'STAFF' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const update = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.name.trim() && form.phone.trim();

  // The sheet stays open on refusal. It used to close on success only by luck —
  // a rejected create skipped the close AND said nothing, so the operator saw an
  // untouched form and no reason.
  const submit = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate({ name: form.name, role: form.role, phone: form.phone });
    } catch (err) {
      setError(err.message || 'No se pudo enviar la invitación.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}></div>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Equipo y accesos</div>
            <h2 className="h-section" style={{ marginTop: 4 }}>
              Invitar a alguien del equipo
            </h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close">
            <I.X size={16} />
          </button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label htmlFor={`${uid}-full-name`}>Nombre completo</label>
            <input
              id={`${uid}-full-name`}
              className="input tall"
              placeholder="María García"
              value={form.name}
              onChange={update('name')}
            />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-phone-number`}>Teléfono</label>
            <input
              id={`${uid}-phone-number`}
              className="input tall"
              placeholder="+52 ..."
              value={form.phone}
              onChange={update('phone')}
            />
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Se enviará una invitación por WhatsApp.
            </div>
          </div>
          <div className="field">
            <span className="field-label">Rol</span>
            <div className="seg" style={{ width: '100%' }}>
              <button
                className={form.role === 'STAFF' ? 'on' : ''}
                style={{ flex: 1 }}
                onClick={() => setForm((f) => ({ ...f, role: 'STAFF' }))}
              >
                STAFF
              </button>
              <button
                className={form.role === 'ADMIN' ? 'on' : ''}
                style={{ flex: 1 }}
                onClick={() => setForm((f) => ({ ...f, role: 'ADMIN' }))}
              >
                ADMIN
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {form.role === 'ADMIN'
                ? 'Acceso completo, incluidos equipo y ajustes.'
                : 'Puede escanear QR y abonar al monedero.'}
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          {/* The refusal sits where the action is, not in a corner toast. */}
          {error ? (
            <span
              role="alert"
              style={{
                flex: 1,
                fontSize: 12.5,
                color: 'var(--danger)',
                textAlign: 'left',
                alignSelf: 'center',
              }}
            >
              {error}
            </span>
          ) : null}
          <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </button>
          <button
            className="btn btn-primary focusable"
            disabled={!valid || saving}
            style={{ opacity: valid && !saving ? 1 : 0.5 }}
            onClick={submit}
          >
            <I.WhatsApp size={15} /> {saving ? 'Enviando…' : 'Enviar invitación'}
          </button>
        </div>
      </aside>
    </>
  );
};

export default StaffScreen;
