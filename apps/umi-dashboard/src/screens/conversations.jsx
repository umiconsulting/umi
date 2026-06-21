import React, { useState } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import { useConversationsData } from '../data.jsx'

const ConversationsScreen = () => {
  const [page, setPage] = useState(1)
  const { data, loading } = useConversationsData({ page })
  const conversations = data?.conversations || []
  const total = data?.total || 0
  const totalPages = data?.totalPages || 1
  const active = conversations.filter(c => c.status === 'active').length

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>
      <div className="ed-head fade-up d1">
        <div className="titles">
          <div className="sec-index">
            <span className="nn">A</span><span>/</span>
            <span>CONVERSAFLOW <XSep/> {total.toLocaleString('es-MX')} THREADS <XSep/> {active} ACTIVE</span>
          </div>
          <h2>Conversaciones WhatsApp</h2>
          <div className="en">Recent operational conversations · conversaflow.conversations</div>
        </div>
        {loading && <span style={{fontSize:12, color:'var(--ink-3)'}}>Cargando…</span>}
      </div>

      <div className="log-list fade-up d2">
        {conversations.length === 0 && !loading && (
          <div className="card" style={{padding:'42px 28px', textAlign:'center', color:'var(--ink-3)'}}>
            <I.WhatsApp size={30} style={{opacity:.35, marginBottom:10}}/>
            <div style={{fontWeight:600}}>No conversations found.</div>
          </div>
        )}
        {conversations.map((conversation) => (
          <div className="log-row" key={conversation.id}>
            <span className="t">
              {conversation.lastMessageAt
                ? new Date(conversation.lastMessageAt).toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit'})
                : '—'}
            </span>
            <span className={'marker ' + (conversation.status === 'active' ? 'info' : 'warn')} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round">
                <line x1="4" y1="4" x2="20" y2="20"/>
                <line x1="20" y1="4" x2="4" y2="20"/>
              </svg>
            </span>
            <div className="body">
              <div>
                <b>{conversation.customerName || 'Cliente WhatsApp'}</b>
                <span style={{fontFamily:'var(--font-mono)', color:'var(--ink-3)', marginLeft:10}}>{conversation.customerPhone || ''}</span>
              </div>
              <div className="meta">
                {conversation.summary || conversation.currentState || 'Sin resumen'}
                <XSep/> {conversation.messageCount || 0} mensajes
              </div>
            </div>
            <span className={'badge ' + (conversation.status === 'active' ? 'badge-admin' : 'badge-staff')}>
              {conversation.status || 'unknown'}
            </span>
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div style={{display:'flex', justifyContent:'center', gap:10}}>
          <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
            <I.ChevronLeft size={14}/> Anterior
          </button>
          <span style={{fontFamily:'var(--font-mono)', color:'var(--ink-2)', alignSelf:'center'}}>{page} / {totalPages}</span>
          <button className="btn btn-ghost btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => Math.min(totalPages, p + 1))}>
            Siguiente <I.ChevronRight size={14}/>
          </button>
        </div>
      )}
    </div>
  )
}

export default ConversationsScreen
