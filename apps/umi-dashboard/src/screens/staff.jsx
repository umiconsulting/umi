import React, { useState } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import { createStaffMember, deleteStaffMember, useStaffData } from '../data.jsx'

// Screen 4 — Staff & Access
// Data: useStaffData() → conversaflow.staff_members scoped by business tenant


const PERMS = [
  { id: 'scan',     label: 'Scan customer QR',         sub: 'Register visits and redeem' },
  { id: 'topup',    label: 'Top-up monedero',          sub: 'Add balance to a wallet' },
  { id: 'analytics',label: 'View analytics',           sub: 'KPI dashboard and reports' },
  { id: 'settings', label: 'Manage business settings', sub: 'Hours, branding, promos' },
  { id: 'staff',    label: 'Manage staff',             sub: 'Invite, remove, change roles' },
  { id: 'giftcards',label: 'View gift cards',          sub: 'Issued cards and balances' },
];

const DEFAULT_MATRIX = {
  ADMIN: { scan: true,  topup: true, analytics: true,  settings: true,  staff: true,  giftcards: true  },
  STAFF: { scan: true,  topup: true, analytics: false, settings: false, staff: false, giftcards: false },
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
  if (ms < 60000)       return 'just now';
  if (ms < 3600000)     return Math.floor(ms / 60000)   + ' min ago';
  if (ms < 86400000)    return Math.floor(ms / 3600000) + 'h ago';
  if (ms < 7 * 86400000) return Math.floor(ms / 86400000) + 'd ago';
  return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

const StaffScreen = () => {
  const [reveal, setReveal]       = useState({});
  const [inviteOpen, setInviteOpen] = useState(false);
  const [matrix, setMatrix]       = useState(DEFAULT_MATRIX);
  const [filter, setFilter]       = useState('ALL');
  const [refresh, setRefresh]     = useState(0);

  const { data: staffData, loading } = useStaffData(refresh);
  const staff = (staffData && staffData.staff) || [];
  const activeStaff = staff.filter(s => s.status !== 'disabled');
  const filtered = filter === 'ALL' ? activeStaff : activeStaff.filter(s => s.role === filter);

  const togglePerm = (role, perm) => {
    setMatrix(m => ({ ...m, [role]: { ...m[role], [perm]: !m[role][perm] } }));
  };

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>
      {/* Header */}
      <div className="ed-head fade-up d1">
        <div className="titles">
          <div className="sec-index">
            <span className="nn">A</span><span>/</span>
            <span>
              CONVERSAFLOW <XSep/> {activeStaff.length} MEMBERS <XSep/> {activeStaff.filter(s=>s.role==='ADMIN').length} ADMINS
              {loading && <span style={{marginLeft:8,fontSize:10,opacity:0.6}}>· cargando…</span>}
            </span>
          </div>
          <h2>Equipo activo</h2>
          <div className="en">Staff roster · conversaflow.staff_members</div>
        </div>
        <div style={{display:'flex', gap:10, alignItems:'center'}}>
          <div className="seg" role="tablist">
            {['ALL', 'ADMIN', 'STAFF'].map(f => (
              <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                {f === 'ALL' ? 'Todos' : f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <button className="btn btn-primary focusable" onClick={() => setInviteOpen(true)}>
            <I.Plus size={16}/> Invitar
          </button>
        </div>
      </div>

      {/* Roster table */}
      <div className="card fade-up d2" style={{padding:0, overflow:'hidden'}}>
        {filtered.length === 0 && !loading ? (
          <div style={{padding:'48px 32px', textAlign:'center', color:'var(--ink-3)'}}>
            {filter === 'ALL' ? 'No hay miembros de equipo registrados.' : `No hay usuarios con rol ${filter}.`}
          </div>
        ) : (
          <table className="matrix">
            <thead>
              <tr>
                <th style={{width:'35%'}}>Member</th>
                <th>Role</th>
                <th>Phone / Email</th>
                <th>Joined</th>
                <th style={{width:64}}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => {
                const hue = nameToHue(s.name || 'X');
                const initials = (s.name || '?').split(' ').map(p => p[0]).slice(0, 2).join('').toUpperCase();
                return (
                  <tr key={s.id}>
                    <td>
                      <div style={{display:'flex', alignItems:'center', gap:12}}>
                        <div className="avatar-lg" style={{
                          background: `oklch(0.78 0.08 ${hue})`,
                          color: `oklch(0.28 0.08 ${hue})`,
                        }}>
                          {initials}
                        </div>
                        <div>
                          <div style={{fontWeight:600, fontSize:14}}>{s.name || <em style={{color:'var(--ink-3)'}}>Sin nombre</em>}</div>
                          <div style={{fontSize:11.5, color:'var(--ink-3)', textTransform:'uppercase', letterSpacing:'0.06em'}}>
                            {s.email || '—'}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={'badge ' + (s.role === 'ADMIN' ? 'badge-admin' : 'badge-staff')}>
                        {s.role === 'ADMIN' && <I.Lock size={10}/>}
                        {s.role}
                      </span>
                    </td>
                    <td style={{fontFamily:'var(--font-mono)', fontSize:12.5, color:'var(--ink-2)'}}>
                      {s.phone || <span style={{color:'var(--ink-4)'}}>—</span>}
                    </td>
                    <td style={{color:'var(--ink-2)', fontSize:13}}>
                      {fmtRelative(s.createdAt)}
                    </td>
                    <td>
                      <button
                        className="btn-icon"
                        aria-label="Disable staff"
                        title="Disable staff"
                        onClick={async () => {
                          await deleteStaffMember(s.id);
                          setRefresh(r => r + 1);
                        }}
                      >
                        <I.Trash size={15}/>
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
      <div className="ed-head fade-up d3" style={{marginTop:8}}>
        <div className="titles">
          <div className="sec-index"><span className="nn">B</span><span>/</span><span>ROLE-BASED ACCESS</span></div>
          <h2>Matriz de permisos</h2>
          <div className="en">Permission matrix <XSep/> Umi Cash <XSep/> KDS <XSep/> ConversaFlow</div>
        </div>
      </div>

      <div className="card fade-up d4" style={{padding:0, overflow:'hidden'}}>
        <table className="matrix">
          <thead>
            <tr>
              <th style={{width:'40%'}}>Action</th>
              <th style={{textAlign:'center'}}>
                <span className="badge badge-admin" style={{padding:'4px 10px'}}><I.Lock size={10}/> ADMIN</span>
              </th>
              <th style={{textAlign:'center'}}>
                <span className="badge badge-staff" style={{padding:'4px 10px'}}>STAFF</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {PERMS.map(p => (
              <tr key={p.id}>
                <td>
                  <div style={{fontWeight:600, fontSize:13.5}}>{p.label}</div>
                  <div style={{fontSize:12.5, color:'var(--ink-3)'}}>{p.sub}</div>
                </td>
                <td style={{textAlign:'center'}}>
                  <div className={'switch ' + (matrix.ADMIN[p.id] ? 'on' : '')} style={{display:'inline-block'}}
                       onClick={() => togglePerm('ADMIN', p.id)}/>
                </td>
                <td style={{textAlign:'center'}}>
                  <div className={'switch ' + (matrix.STAFF[p.id] ? 'on' : '')} style={{display:'inline-block'}}
                       onClick={() => togglePerm('STAFF', p.id)}/>
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
            setRefresh(r => r + 1);
          }}
        />
      )}
    </div>
  );
};

const InvitePanel = ({ onClose, onCreate }) => {
  const [form, setForm] = useState({ name: '', phone: '', role: 'STAFF' });
  const update = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const valid = form.name.trim() && form.phone.trim();

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose}></div>
      <aside className="sheet">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Staff & Access</div>
            <h2 className="h-section" style={{marginTop:4}}>Invite a team member</h2>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close"><I.X size={16}/></button>
        </div>
        <div className="sheet-body">
          <div className="field">
            <label>Full name</label>
            <input className="input tall" placeholder="María García" value={form.name} onChange={update('name')}/>
          </div>
          <div className="field">
            <label>Phone number</label>
            <input className="input tall" placeholder="+52 ..." value={form.phone} onChange={update('phone')}/>
            <div style={{fontSize:12, color:'var(--ink-3)'}}>An invite link will be sent via WhatsApp.</div>
          </div>
          <div className="field">
            <label>Role</label>
            <div className="seg" style={{width:'100%'}}>
              <button className={form.role === 'STAFF' ? 'on' : ''} style={{flex:1}} onClick={() => setForm(f => ({...f, role:'STAFF'}))}>STAFF</button>
              <button className={form.role === 'ADMIN' ? 'on' : ''} style={{flex:1}} onClick={() => setForm(f => ({...f, role:'ADMIN'}))}>ADMIN</button>
            </div>
            <div style={{fontSize:12, color:'var(--ink-3)'}}>
              {form.role === 'ADMIN' ? 'Full access including staff and settings.' : 'Can scan QR and top-up wallets.'}
            </div>
          </div>
        </div>
        <div className="sheet-foot">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary focusable"
            disabled={!valid}
            style={{opacity: valid ? 1 : 0.5}}
            onClick={() => onCreate({ name: form.name, role: form.role, phone: form.phone })}
          >
            <I.WhatsApp size={15}/> Send invite
          </button>
        </div>
      </aside>
    </>
  );
};

export default StaffScreen
