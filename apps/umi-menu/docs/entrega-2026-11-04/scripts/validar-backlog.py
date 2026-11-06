#!/usr/bin/env python3
"""Valida el backlog y sus archivos locales. No publica ni modifica GitHub."""
from pathlib import Path
from urllib.parse import unquote, urlsplit
import csv
import hashlib
import json
import re

root = Path(__file__).resolve().parents[1]
data = json.loads((root / 'backlog/backlog.json').read_text())
stories, decisions = data['stories'], data['decisions']
items = stories + decisions
errors = []

def check(condition, message):
    if not condition:
        errors.append(message)

story_ids = {x['id'] for x in stories}
decision_ids = {x['id'] for x in decisions}
check(len(story_ids) == len(stories), 'IDs de historia duplicados')
check(len(decision_ids) == len(decisions), 'IDs de decisión duplicados')
check(not story_ids & decision_ids, 'ID compartido entre historia y decisión')
check(data['tracker'] == 'GitHub Issues', 'Tracker distinto de GitHub Issues')
check(data['development_pr_base'] == 'staging', 'Base de desarrollo distinta de staging')
check(data['promotion_target'] == 'main', 'Destino de promoción distinto de main')

approved_doc = (root / 'docs/01-contexto-y-decisiones.md').read_text()
approved = set(re.findall(r'^\| (D\d+) \|', approved_doc, re.M))
technical_doc = (root / 'docs/11-mapa-tecnico-y-pruebas.md').read_text()
areas = set(re.findall(r'^\| `([a-z_]+)` \|', technical_doc, re.M))
covered = set(data['common_decisions'])
plans = set()
tasks = []
for item in items:
    ident = item['id']
    required = ['title', 'type', 'status', 'acceptance', 'tasks']
    if item in stories:
        required += ['actor', 'goal', 'value', 'phase', 'plan', 'areas', 'staging', 'out_of_scope']
        check(set(item['depends_on']) <= story_ids, ident + ': dependencia desconocida')
        check(set(item['decision_blockers']) <= decision_ids, ident + ': decisión desconocida')
        check(ident not in item['depends_on'], ident + ': depende de sí misma')
        check(len(item['depends_on']) == len(set(item['depends_on'])), ident + ': dependencia repetida')
        check(set(item['areas']) <= areas, ident + ': área ausente del mapa técnico')
        covered.update(item['decisions'])
        plans.update(item['plan'])
    else:
        required += ['question', 'output']
        check(any(ident in s['decision_blockers'] for s in stories), ident + ': no bloquea ninguna historia')
    for field in required:
        check(bool(item.get(field)), ident + ': falta ' + field)
    folder = 'historias' if item['type'] == 'historia' else 'decisiones'
    target = root / 'backlog' / folder / (ident + '.md')
    check(target.is_file(), ident + ': falta Markdown generado')
    body = target.read_text() if target.is_file() else ''
    check(item['title'] in body, ident + ': título desactualizado en Markdown')
    for i, criterion in enumerate(item['acceptance'], 1):
        check(f'{ident}-CA{i:02}' in body and criterion in body, ident + ': criterio desactualizado')
    for task in item['tasks']:
        check(bool(re.fullmatch(re.escape(ident) + r'-T\d{2}', task['id'])), ident + ': ID de tarea inválido')
        for field in ['title', 'action', 'done']:
            check(bool(task.get(field)), task['id'] + ': falta ' + field)
            check(task.get(field, '') in body, task['id'] + ': Markdown desactualizado')
        check(task['id'] in body, task['id'] + ': ausente del Markdown')
        tasks.append((ident, task))

task_ids = [t['id'] for _, t in tasks]
check(len(set(task_ids)) == len(task_ids), 'IDs de tarea duplicados')
check(covered == approved, 'Cobertura Dxx incorrecta: ' + str(covered ^ approved))
expected_plans = {f'P{i:02}' for i in range(1, 20)} | {'P06D'}
check(plans == expected_plans, 'Cobertura Pxx incorrecta: ' + str(plans ^ expected_plans))
check(decision_ids == {f'MD-A{i:02}' for i in range(1, 14)}, 'Cobertura A01–A13 incorrecta')

pending = {s['id']: set(s['depends_on']) for s in stories}
layers = 0
while pending:
    ready = {i for i, deps in pending.items() if not deps}
    if not ready:
        errors.append('Ciclo o dependencia inválida: ' + ', '.join(sorted(pending)))
        break
    layers += 1
    pending = {i: deps - ready for i, deps in pending.items() if i not in ready}

with (root / 'backlog/historias.csv').open(encoding='utf-8-sig', newline='') as f:
    rows = list(csv.DictReader(f))
check(len(rows) == len(items), 'Conteo de historias/decisiones CSV diferente')
check({r['ID local'] for r in rows} == story_ids | decision_ids, 'IDs CSV de historias distintos')
with (root / 'backlog/tareas.csv').open(encoding='utf-8-sig', newline='') as f:
    rows = list(csv.DictReader(f))
check(len(rows) == len(tasks), 'Conteo de tareas CSV diferente')
expected_tasks = {t['id']: (owner, t) for owner, t in tasks}
for row in rows:
    entry = expected_tasks.get(row['ID tarea'])
    check(entry is not None, 'Tarea CSV desconocida: ' + row['ID tarea'])
    if entry:
        owner, task = entry
        check((row['Historia o decisión'], row['Título'], row['Acción'], row['Termina cuando']) ==
              (owner, task['title'], task['action'], task['done']), row['ID tarea'] + ': CSV desactualizado')
check({r['ID tarea'] for r in rows} == set(task_ids), 'IDs CSV de tareas distintos')

# Enlaces Markdown en la documentación vigente; las fuentes históricas conservan sus rutas.
documents = [root / 'README.md', root / 'AGENTS.md']
documents += sorted((root / 'docs').glob('*.md'))
documents += sorted((root / 'backlog').rglob('*.md'))
documents += sorted((root / 'evidencia').glob('*.md'))
link_count = 0
for path in documents:
    body = re.sub(r'```.*?```', '', path.read_text(), flags=re.S)
    for match in re.finditer(r'!?\[[^\]]*\]\(([^)]+)\)', body):
        href = match.group(1).strip()
        if href.startswith('<'):
            href = href[1:href.index('>')]
        else:
            href = href.split(' ', 1)[0]
        url = urlsplit(href)
        if url.scheme or url.netloc or not url.path:
            continue
        target = (path.parent / unquote(url.path)).resolve()
        link_count += 1
        check(target.is_relative_to(root), f'Enlace no portátil: {path.relative_to(root)} -> {href}')
        check(target.exists(), f'Enlace inexistente: {path.relative_to(root)} -> {href}')

origin = json.loads((root / 'inventario-origen.json').read_text())
for entry in origin['files']:
    target = root / entry['file']
    check(target.is_file(), 'Falta copia original: ' + entry['file'])
    if target.is_file():
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        check(digest == entry['sha256'], 'Copia original modificada: ' + entry['file'])

report = {
    'stories': len(stories), 'decisions': len(decisions), 'tasks': len(tasks),
    'dependency_layers': layers, 'approved_decisions_covered': len(covered),
    'plan_deliverables_covered': len(plans), 'current_documents_checked': len(documents),
    'local_links_checked': link_count, 'original_copies_checked': len(origin['files']),
    'github_issues_recorded': sum(bool(i.get('github_issue')) for i in items),
    'errors': errors,
}
print(json.dumps(report, ensure_ascii=False, indent=2))
raise SystemExit(1 if errors else 0)
