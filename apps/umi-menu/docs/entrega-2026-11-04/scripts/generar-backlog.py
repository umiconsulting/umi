#!/usr/bin/env python3
"""Genera los documentos y tablas locales desde backlog/backlog.json. No publica issues."""
from pathlib import Path
import csv
import json

root=Path(__file__).resolve().parents[1]
folder=root/'backlog'
data=json.loads((folder/'backlog.json').read_text())
stories=data['stories']; decisions=data['decisions']; all_items=stories+decisions
byid={x['id']:x for x in all_items}

def file_for(item):
    return ('historias/' if item['type']=='historia' else 'decisiones/')+item['id']+'.md'

def link(i):
    return f"[{i}]({file_for(byid[i])})"

for item in all_items:
    target=folder/file_for(item)
    target.parent.mkdir(parents=True,exist_ok=True)
    lines=[f"# [{item['id']}] {item['title']}",'',
      '**Repositorio:** `umiconsulting/umi` · **Seguimiento:** GitHub Issues.',
      f"**Estado local:** {item['status']}.",
      ('**Issue:** '+str(item['github_issue']) if item.get('github_issue') else 'No tiene número de issue asignado.'),'']
    if item['type']=='historia':
        blockers=item['depends_on']+item['decision_blockers']
        lines += ['## Historia','',f"Como **{item['actor']}**, quiero **{item['goal']}** para **{item['value']}**.",'',
          f"**Fase:** {item['phase']} · **Entregas del plan:** {', '.join(item['plan'])}.",
          f"**Reglas de origen:** {', '.join(dict.fromkeys(item['decisions']+data['common_decisions']))}.",
          f"**Áreas de referencia:** {', '.join(item['areas'])}. Véase el [mapa técnico](../../docs/11-mapa-tecnico-y-pruebas.md).",'',
          '## Dependencias','',
          'Para implementar: '+(', '.join(blockers) if blockers else 'no hay dependencia funcional previa en este backlog; revisar staging e instrucciones vigentes')+'.',
          'Las dependencias de código deben estar integradas y validadas en staging antes del PR o de la validación operativa dependiente. Las decisiones se cierran con su resultado aprobado.',
          '', '## Alcance excluido','',item['out_of_scope'],'']
    else:
        affected=[s['id'] for s in stories if item['id'] in s['decision_blockers']]
        lines += ['## Decisión necesaria','',item['question'],'',
          '**Resultado requerido:** '+item['output'],'',
          '**Historias bloqueadas directamente:** '+', '.join(affected)+'.','',
          'Esta es una decisión de producto/técnica, no una historia implementada. Su documentación acompaña al primer PR funcional que la use. No requiere un PR documental independiente.','']
    lines+=['## Criterios de aceptación','']
    lines += [f"- [ ] **{item['id']}-CA{i:02}:** {c}" for i,c in enumerate(item['acceptance'],1)]
    lines+=['','## Tareas','']
    for task in item['tasks']:
        lines += [f"### {task['id']} · {task['title']}",'',
          '- [ ] '+task['action'],'', '**Termina cuando:** '+task['done'],'']
    if item['type']=='historia':
        lines += [('## Validación de la promoción y del piloto' if item['id']=='MD-H32' else '## Validación en staging'),'',item['staging'],'',
          'Adjuntar revisión de API, cliente, esquema y despliegue; escenario, resultado y evidencia. Las pruebas locales complementan esta validación. Un caso omitido no cuenta como aprobado.','',
          '## Entrega y cierre','']
        if item['id']=='MD-H32':
            lines += [
              '- [ ] MD-H31 aprobada, con revisión de staging, criterios y evidencia identificados.',
              '- [ ] Promoción a **main** autorizada mediante el procedimiento de release vigente, sin cambios de desarrollo nuevos.',
              '- [ ] Verificar CI y runtime de la revisión promovida; activar el piloto acordado.',
              '- [ ] Vincular issue, promoción, comprobaciones posteriores y responsables de observación y reversión.',
              '- [ ] Cerrar esta historia después de comprobar la promoción y el piloto; la validación previa de staging por sí sola no la completa.','']
        elif item['id'] in ['MD-H19','MD-H31']:
            lines += [
              '- [ ] Registrar revisión, entorno, escenarios y resultados; un caso omitido no equivale a aprobado.',
              '- [ ] Vincular la evidencia al issue; cerrar solo al satisfacer todos sus criterios y la validación de staging.',
              '- [ ] Si se encuentra un defecto, resolverlo en un PR atómico a **staging** y repetir los casos afectados.',
              '- [ ] No crear un PR documental para registrar una comprobación sin cambio de código.',
              '- [ ] La promoción a **main** corresponde a MD-H32, tras la validación integral.','']
        else:
            lines += [
              '- [ ] Objetivo único; cambios acoplados de contrato, persistencia, UI y pruebas permanecen juntos cuando son necesarios.',
              '- [ ] PR de desarrollo con base **staging**; diff limitado a esta historia o a una subentrega explícita y verificable.',
              '- [ ] Pruebas locales y CI pertinentes; ninguna prueba requerida omitida se registra como pasada.',
              '- [ ] Comprobar el commit integrado y ejecutar el escenario anterior en staging.',
              '- [ ] Vincular issue, PR y evidencia. Cerrar la historia solo después de validar en staging.',
              '- [ ] Promoción a **main** posterior, con evidencia de staging y alcance identificado; no abrir desarrollo directamente a main.','']
    else:
        lines += ['## Cierre','',
          'Registrar responsable, fecha, resultado y ejemplos aprobados. Actualizar las historias afectadas. Investigar o proponer una opción no equivale a que el usuario la haya elegido.','']
    target.write_text('\n'.join(lines)+'\n')

# Deterministic topological order. IDs remain stable even if the order changes.
pending={s['id']:set(s['depends_on']) for s in stories}
order=[]; waves=[]
while pending:
    wave=sorted(i for i, deps in pending.items() if not deps)
    if not wave:raise SystemExit('Ciclo de dependencias: '+str(pending))
    waves.append(wave);order+=wave
    for i in wave:del pending[i]
    for deps in pending.values():deps.difference_update(wave)

task_count=sum(len(i['tasks']) for i in all_items)
lines=['# Backlog del menú digital para GitHub','',
  f"**{len(stories)} historias**, **{len(decisions)} decisiones** y **{task_count} tareas**. Repositorio: https://github.com/umiconsulting/umi.",'',
  'Estado: propuesta local revisable. Los IDs MD-Hxx/MD-Axx son referencias locales estables; consulta github_issue en backlog.json para las publicaciones registradas. Esta entrega inicial no publica issues, etiquetas ni asignaciones.','',
  '## Cómo usarlo','',
  '1. Lee la [guía de GitHub](../docs/10-historias-y-tareas-github.md) para reglas de publicación y cierre.',
  '2. Revisa las decisiones pendientes de las historias que quieres iniciar.',
  '3. Usa cada archivo de `historias/` como cuerpo de un issue; sus tareas quedan como checklist.',
  '4. Al publicar, sustituye las dependencias locales por los enlaces reales de GitHub y conserva ambos identificadores.',
  '5. Implementa con PRs atómicos a staging, prueba allí y promueve a main después de validar.','',
  '## Historias','',
  '| ID | Historia | Plan | Dependencias de código | Decisiones pendientes |',
  '| --- | --- | --- | --- | --- |']
for s in stories:
    lines.append('| '+ ' | '.join([link(s['id']),s['title'],', '.join(s['plan']),', '.join(s['depends_on']) or 'Ninguna',', '.join(s['decision_blockers']) or 'Ninguna directa'])+' |')
lines+=['','## Orden de implementación por dependencias','',
 'Las filas muestran capas del grafo, no sprints, fechas o asignaciones paralelas. Cerrar antes las decisiones de cada historia. La numeración del ID no determina el orden.','',
 '| Capa | Historias cuyos predecesores están en capas anteriores |', '| --- | --- |']
for i,wave in enumerate(waves,1):lines.append(f"| {i} | {', '.join(link(x) for x in wave)} |")
lines+=['','La primera entrega recomendada sigue siendo MD-H01, después de resolver MD-A01. MD-H03 no depende funcionalmente de ella y puede prepararse por separado.','',
 '## Decisiones pendientes','', '| ID | Decisión | Historias directamente afectadas |','| --- | --- | --- |']
for d in decisions:
    affected=[s['id'] for s in stories if d['id'] in s['decision_blockers']]
    lines.append('| '+' | '.join([link(d['id']),d['title'],', '.join(affected)])+' |')
lines+=['','## Archivos de trabajo','',
 '- [Datos completos del backlog](backlog.json): fuente editable de historias, criterios y tareas.',
 '- [Tabla de historias y decisiones](historias.csv).',
 '- [Tabla completa de tareas](tareas.csv).',
 '- [Correspondencia con entregas del plan](mapa-entregas.md).','',
 'Los CSV son tablas para revisión o adaptación a una herramienta. No se presentan como un formato de importación automática soportado por GitHub.','',
 'Para regenerar los documentos después de editar backlog.json, ejecuta `python3 scripts/generar-backlog.py` desde la raíz del paquete. Esto no modifica GitHub.']
(folder/'README.md').write_text('\n'.join(lines)+'\n')

with (folder/'historias.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['ID local','Tipo','Título','Fase','Plan','Depende de','Decisiones pendientes','Estado','GitHub issue','Archivo'])
    for x in all_items:w.writerow([x['id'],x['type'],x['title'],x.get('phase',''),'; '.join(x.get('plan',[])),'; '.join(x['depends_on']),'; '.join(x.get('decision_blockers',[])),x['status'],x.get('github_issue') or '',file_for(x)])
with (folder/'tareas.csv').open('w',newline='',encoding='utf-8-sig') as f:
    w=csv.writer(f);w.writerow(['ID tarea','Historia o decisión','Título','Acción','Termina cuando','Bloqueos de la historia','Estado'])
    for x in all_items:
        for t in x['tasks']:w.writerow([t['id'],x['id'],t['title'],t['action'],t['done'],'; '.join(x['depends_on']+x.get('decision_blockers',[])),'Pendiente'])
plans=list(dict.fromkeys(p for s in stories for p in s['plan']))
plans.sort(key=lambda x:(int(''.join(c for c in x if c.isdigit())),x))
lines=['# Correspondencia entre plan y backlog','',
 'Los identificadores Pxx siguen siendo objetivos del plan. Su división en historias permite PRs atómicos y pruebas separadas. No son números de PR.','',
 '| Entrega | Historias que la concretan |','| --- | --- |']
for p in plans:lines.append(f"| {p} | "+', '.join(link(s['id']) for s in stories if p in s['plan'])+' |')
lines+=['','MD-H28 explicita disponibilidad operativa. MD-H29 explicita el agregado de estaciones. MD-H33 completa origen en historial y reportes. MD-H19 y MD-H31 registran validaciones reales; MD-H32 registra la promoción/piloto.','',
 'P00 sigue descartado. Las decisiones se documentan con el primer PR funcional que las necesita.']
(folder/'mapa-entregas.md').write_text('\n'.join(lines)+'\n')
print(f'Generados {len(stories)} archivos de historia, {len(decisions)} decisiones y {task_count} tareas.')
