// report.mjs — render the 9-section architectural-knowledge report from the
// catalog. This is NOT documentation and NOT generated code; it is a set of
// findings derived from the factual graph. Empty sections say so explicitly
// (a clean result is a real result), and every section that rests on a heuristic
// carries its confidence and the soundness caveats up top.

function bullet(s) { return `- ${s}` }
function h2(s) { return `\n## ${s}\n` }

export function renderReport(c) {
  const L = []
  L.push(`# Repository Cartography — ${c.meta.rootName}`)
  L.push(`\n_Factual metadata graph (deterministic-first). ${c.meta.files.total} files: ` +
    Object.entries(c.meta.files.byLang).map(([k, v]) => `${v} ${k}`).join(', ') +
    `. ${c.graph.moduleCount} modules, ${c.graph.edgeCount} runtime edges._`)

  L.push(h2('Soundness caveats'))
  for (const cav of c.meta.caveats) L.push(bullet(cav))

  // 1 — Business Capabilities
  L.push(h2('1. Business Capabilities'))
  const nestFeatures = c.modules.filter((m) => m.nestModules.length).map((m) => m.module.split(':')[1])
  if (c.contextMap.contexts.schemas.length)
    L.push(bullet(`Data domains (Postgres schemas): ${c.contextMap.contexts.schemas.sort().join(', ')}`))
  if (nestFeatures.length)
    L.push(bullet(`Backend feature modules: ${[...new Set(nestFeatures)].sort().join(', ')}`))
  L.push(bullet(`Deployable contexts (apps): ${c.contextMap.contexts.apps.sort().join(', ')}`))

  // 2 — Aggregate Roots
  L.push(h2('2. Aggregate Roots'))
  if (!c.transactions.ownershipAvailable) L.push('_No authoritative DDL in scope — ownership/aggregate analysis is disabled for this run (point the tool at a repo whose schema DDL is included)._')
  if (!c.aggregates.length) L.push('_None detected from FK-cascade clusters._')
  for (const a of c.aggregates.slice(0, 15)) {
    const parts = a.parts.length ? ` — owns ${a.parts.length}: ${a.parts.join(', ')}` : ' — (no owned children)'
    L.push(bullet(`**${a.root}**${parts}${a.repository ? `  ·  repo: \`${a.repository}\`` : ''}`))
  }

  // 3 — Most Central Module
  L.push(h2('3. Most Central Module'))
  const bt = c.graph.centrality.betweenness[0]
  const topHub = [...c.graph.coupling].sort((a, b) => b.ca - a.ca)[0] // most depended-upon
  if (bt) L.push(bullet(`Highest betweenness (architectural chokepoint / max blast radius): **${bt.node}** (${bt.betweenness})`))
  if (topHub) L.push(bullet(`Most depended-upon hub (highest afferent coupling): **${topHub.node}** (Ca ${topHub.ca}, I=${topHub.instability ?? 'n/a'})`))
  L.push(bullet('_Change here has the widest reach — add extra review/test gates. High centrality on a stable module is expected, not a defect._'))

  // 4 — Highest Coupling
  L.push(h2('4. Highest Coupling'))
  const topCoupled = [...c.graph.coupling].sort((a, b) => b.total - a.total).slice(0, 8)
  for (const r of topCoupled) L.push(bullet(`${r.node} — Ca ${r.ca}, Ce ${r.ce}, I=${r.instability ?? 'n/a'}`))
  L.push(bullet('_A stable sink (high Ca, I≈0) is healthy. The concern is a widely-depended-on module that itself has high Ce (fan-in hub that is unstable)._'))

  // 5 — Suspicious Dependencies
  L.push(h2('5. Suspicious Dependencies'))
  const sdp = c.graph.sdp.slice(0, 8)
  if (!sdp.length && !c.layering.length) L.push('_No Stable-Dependencies-Principle violations or layering inversions found._')
  for (const v of sdp) L.push(bullet(`SDP: ${v.from} (I=${v.iFrom}) → ${v.to} (I=${v.iTo}) — depends toward less-stable (+${v.delta})`))
  for (const v of c.layering) L.push(bullet(`Layering: ${v.from} imports persistence directly (${v.detail}) — should go through a service/repository`))

  // 6 — Cycles
  L.push(h2('6. Cycles'))
  L.push(bullet('_Unit = **component (folder rollup)**, not the framework module system. NestJS `@Module` cycles are tracked separately below via forwardRef._'))
  if (!c.graph.cycles.length) L.push('_None. The component dependency graph is a DAG (Acyclic Dependencies Principle holds)._')
  for (const cyc of c.graph.cycles) {
    const tag = cyc.rollupArtifact ? ' _(LOW CONFIDENCE: involves a catch-all `:.` root bucket — may be a folder-rollup artifact, not a true cyclic dependency)_' : ''
    L.push(bullet(`SCC (${cyc.nodes.length} components): ${cyc.nodes.join(', ')}${tag}`))
    for (const circ of cyc.circuits.slice(0, 5)) L.push(`    - circuit: ${circ.join(' → ')}`)
    if (cyc.truncated) L.push('    - _(circuit enumeration truncated — dense tangle)_')
  }
  L.push(bullet(`NestJS \`@Module\` graph: ${(c.graph.forwardRefs && c.graph.forwardRefs.length) || 0} forwardRef site(s) (0 ⇒ the declared @Module graph is acyclic).`))

  // 7 — Transaction Hotspots
  L.push(h2('7. Transaction Hotspots'))
  if (c.transactions.note) L.push(bullet(`_${c.transactions.note}_`))
  const hs = c.transactions.hotspots
  if (!hs.length && !c.transactions.externalIOInTx.length)
    L.push('_None. Each transaction writes a single aggregate root (+ its children / outbox)._')
  for (const t of hs.slice(0, 12))
    L.push(bullet(`${t.file} — one \`${t.method}\` writes ${t.roots.length} distinct roots: ${t.roots.join(', ')} → candidate to split via an outbox event`))
  for (const t of c.transactions.externalIOInTx.slice(0, 12))
    L.push(bullet(`${t.file} — external I/O inside a \`${t.method}\` transaction → move the effect to the outbox/relay (DB can't roll back the outside world)`))

  // 8 — Dead Modules
  L.push(h2('8. Dead Modules'))
  if (!c.graph.dead.length) L.push('_None (every module has an incoming edge of some kind, excluding entrypoints)._')
  for (const d of c.graph.dead.slice(0, 20)) L.push(bullet(`${d} — nothing imports it (verify it is not a runtime/DI entrypoint before removing)`))

  // 9 — Missing Boundaries
  L.push(h2('9. Missing Boundaries'))
  const miss = []
  for (const t of hs) miss.push(`${t.file}: multiple aggregates mutated in one transaction (should communicate via events)`)
  for (const r of c.contextMap.relationships.filter((r) => r.type === 'Shared Kernel'))
    miss.push(`Shared Kernel on \`${r.table}\` (${r.apps.join(' + ')}) — dual-writer; confirm this is intended co-ownership, not accidental coupling`)
  for (const leak of c.boundaryLeaks || [])
    miss.push(leak)
  if (!miss.length) L.push('_None detected._')
  const CAP = 15
  for (const m of miss.slice(0, CAP)) L.push(bullet(m))
  if (miss.length > CAP) L.push(bullet(`_…and ${miss.length - CAP} more (suppressed)._`))

  return L.join('\n') + '\n'
}
