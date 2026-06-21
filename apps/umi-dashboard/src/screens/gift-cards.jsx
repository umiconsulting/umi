import React, { useState } from 'react'
import { I } from '../icons.jsx'
import { XSep } from '../shell.jsx'
import { useGiftCardsData } from '../data.jsx'

const GiftCardsScreen = () => {
  const [page, setPage] = useState(1)
  const { data, loading } = useGiftCardsData({ page })
  const cards = data?.giftCards || []
  const total = data?.total || 0
  const totalPages = data?.totalPages || 1
  const openTotal = cards
    .filter(card => !card.isRedeemed)
    .reduce((sum, card) => sum + (card.amountCentavos || 0), 0)

  return (
    <div style={{display:'flex', flexDirection:'column', gap:24}}>
      <div className="ed-head fade-up d1">
        <div className="titles">
          <div className="sec-index">
            <span className="nn">A</span><span>/</span>
            <span>UMI CASH <XSep/> {total.toLocaleString('es-MX')} GIFT CARDS</span>
          </div>
          <h2>Gift cards</h2>
          <div className="en">Issued gift cards · umi_cash.GiftCard</div>
        </div>
        {loading && <span style={{fontSize:12, color:'var(--ink-3)'}}>Cargando…</span>}
      </div>

      <div className="grid grid-2 fade-up d2" style={{gap:14}}>
        <div className="strip-metric">
          <div>
            <div className="lbl">Abiertas</div>
            <div className="en">Open balance on this page</div>
          </div>
          <div className="val">$ {(openTotal / 100).toLocaleString('es-MX')}</div>
          <span className="delta-mini up">{cards.filter(c => !c.isRedeemed).length}</span>
        </div>
        <div className="strip-metric">
          <div>
            <div className="lbl">Canjeadas</div>
            <div className="en">Redeemed on this page</div>
          </div>
          <div className="val">{cards.filter(c => c.isRedeemed).length}</div>
          <span className="delta-mini">{cards.length} shown</span>
        </div>
      </div>

      <div className="card fade-up d3" style={{padding:0, overflow:'hidden'}}>
        <table className="matrix">
          <thead>
            <tr>
              <th>Code</th>
              <th>Recipient</th>
              <th style={{textAlign:'right'}}>Amount</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 && !loading && (
              <tr><td colSpan={5} style={{textAlign:'center', padding:40, color:'var(--ink-3)'}}>No gift cards found.</td></tr>
            )}
            {cards.map(card => (
              <tr key={card.id}>
                <td style={{fontFamily:'var(--font-mono)', fontSize:12}}>{card.code}</td>
                <td>
                  <div style={{fontWeight:600}}>{card.recipientName || '—'}</div>
                  <div style={{fontSize:12, color:'var(--ink-3)'}}>{card.recipientEmail || card.recipientPhone || 'No contact'}</div>
                </td>
                <td style={{textAlign:'right', fontWeight:700}}>{card.amountMXN}</td>
                <td>
                  <span className={'badge ' + (card.isRedeemed ? 'badge-staff' : 'badge-admin')}>
                    {card.isRedeemed ? 'REDEEMED' : 'OPEN'}
                  </span>
                </td>
                <td style={{color:'var(--ink-2)'}}>
                  {card.createdAt ? new Date(card.createdAt).toLocaleDateString('es-MX', { day:'numeric', month:'short' }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

export default GiftCardsScreen
