#!/usr/bin/env python3
"""Structural audit of a third-party agent-skill tree.

Run:
    python3 tools/skill-audit/skillscan.py .agents/skills/design > findings.json

This is deliberately NOT a keyword scanner. A skill written to be malicious is
written precisely to defeat lexical patterns -- published detectors catch ~20%
of deliberately-hidden payloads because malicious intent embeds in ordinary
documentation without ever using a suspicious word. So every check here keys on
*structure* instead:

  layer 1  invisible codepoints   text a reviewer's eye and `git diff` cannot see
  layer 2  capability reach       what the shipped code can actually DO
  layer 3  instruction/data mix   directives sitting in files that hold data
  layer 4  unreviewable mass      where a payload could hide from any human

The scanner only *locates* candidates. It cannot decide intent, and it is not
supposed to: `TOKEN` in a design-system skill means "design token", and
`fetch()` may be reading a `data:` URI. Every finding needs a human judge pass.
Read docs/reports/2026-07-22-agent-skill-supply-chain-audit-method.md for the
method this implements, its measured false-positive behaviour, and what it
cannot see at all.
"""

from __future__ import annotations

import csv
import io
import json
import math
import os
import re
import statistics
import sys
import tarfile
import unicodedata
import zipfile
from collections import Counter, defaultdict

CODE_EXT = {".py", ".ts", ".js", ".jsx", ".mjs", ".cjs", ".sh", ".html"}
DATA_EXT = {".json", ".txt", ".yaml", ".yml"}

findings: list[dict] = []


def add(layer: str, sev: str, path: str, detail: str, evidence: str = "") -> None:
    findings.append(
        {
            "layer": layer,
            "severity": sev,
            "path": path,
            "detail": detail,
            "evidence": evidence[:400],
        }
    )


# --------------------------------------------------------------------- layer 1
# Invisible content channels. An injection the reviewer cannot see is the entire
# point of ASCII smuggling: the Unicode tag block reproduces a full ASCII
# keyboard in codepoints that render as nothing, so a payload survives code
# review and `git diff` untouched while the model still tokenizes it.
INVISIBLE = {
    # U+E0000-U+E007F. The smuggling channel. Legitimately used only by a
    # handful of flag emoji -- in a skill tree it has no honest purpose.
    "unicode-tag-block": lambda cp: 0xE0000 <= cp <= 0xE007F,
    # Trojan Source (CVE-2021-42574): reorders how source reads vs how it runs.
    "bidi-control": lambda cp: 0x202A <= cp <= 0x202E or 0x2066 <= cp <= 0x2069,
    "zero-width": lambda cp: 0x200B <= cp <= 0x200F or 0x2060 <= cp <= 0x2064 or cp == 0xFEFF,
    "variation-selector": lambda cp: 0xFE00 <= cp <= 0xFE0F or 0xE0100 <= cp <= 0xE01EF,
    "private-use-area": lambda cp: 0xE000 <= cp <= 0xF8FF,
}
# Emoji presentation selectors and stray BOMs are ambient noise in any tree that
# contains a checkmark; a *run* of them is not. Only the top two ranges are
# unambiguous, so only they open at HIGH.
UNAMBIGUOUS = {"unicode-tag-block", "bidi-control"}


def scan_invisible(path: str, text: str) -> None:
    hits: Counter[str] = Counter()
    first: dict[str, str] = {}
    for i, ch in enumerate(text):
        cp = ord(ch)
        if cp < 0x80:
            continue
        for name, pred in INVISIBLE.items():
            if pred(cp):
                hits[name] += 1
                first.setdefault(name, f"offset {i} U+{cp:04X}")
        if unicodedata.category(ch) == "Cf" and not any(p(cp) for p in INVISIBLE.values()):
            hits["other-format-Cf"] += 1
            first.setdefault("other-format-Cf", f"offset {i} U+{cp:04X}")
    for name, n in hits.items():
        if name in UNAMBIGUOUS:
            sev = "HIGH"
        elif n >= 5:
            sev = "MEDIUM"
        else:
            sev = "LOW"
        add("1-invisible", sev, path, f"{n}x {name}", first[name])


# --------------------------------------------------------------------- layer 2
# Capability reach. Skill frontmatter declares tool *types* and never tool
# *targets* -- a skill granted Read can read any file on the machine, not just
# project files -- so the manifest cannot bound risk and the shipped code must
# be inventoried directly. These patterns are intentionally broad: the output is
# an inventory to adjudicate, not a verdict.
CAPABILITY = {
    "egress": re.compile(
        r"\b(fetch|axios|requests\.(?:get|post)|urllib|httpx|curl|wget"
        r"|XMLHttpRequest|WebSocket|net\.connect|http\.request|urlopen)\b"
    ),
    "exec": re.compile(
        r"\b(subprocess|os\.system|os\.popen|child_process|execSync|spawnSync"
        r"|eval|Function\s*\(|exec\s*\(|popen)\b"
    ),
    "cred-path": re.compile(
        r"(\.ssh/|\.aws/|\.netrc|id_rsa|\.env\b|credentials|keychain"
        r"|\.npmrc|\.git-credentials|SECRET|TOKEN|API_KEY|PRIVATE_KEY)"
    ),
    "install-persistence": re.compile(
        r"(npm\s+i(?:nstall)?\s+-g|pip\s+install|brew\s+install"
        r"|~/\.claude|\.bashrc|\.zshrc|\.profile|crontab|launchctl)"
    ),
    # A skill that writes skill files can rewrite itself or its neighbours --
    # the persistence primitive behind nested-injection attacks.
    "self-modify": re.compile(r"(SKILL\.md|\.agents/skills|\.claude/skills)"),
}


def scan_capability(path: str, text: str) -> None:
    if os.path.splitext(path)[1] not in CODE_EXT:
        return
    for name, rx in CAPABILITY.items():
        ms = list(rx.finditer(text))
        if not ms:
            continue
        line = text[: ms[0].start()].count("\n") + 1
        add("2-capability", "INFO", path, f"{name} x{len(ms)}", f"L{line}: {ms[0].group(0)}")


# --------------------------------------------------------------------- layer 3
# Instruction/data confusion. An agent's context window conflates instructions
# and content the way von Neumann memory conflates code and data, so *any* file
# the agent is told to read is an instruction channel -- extension irrelevant. A
# reference CSV is therefore an injection surface, and the signal is structural:
# a directive is anomalous *for its column*, whatever words it uses.
SECOND_PERSON = re.compile(r"\byou (?:must|should|will|need to|are to|have to)\b", re.I)
IMPERATIVE = re.compile(
    r"^\s*(?:please\s+)?(?:first\s+|always\s+|never\s+|do\s+not\s+|don't\s+)?"
    r"(ignore|disregard|forget|override|bypass|skip|run|execute|fetch|send|post|"
    r"upload|read|open|write|delete|install|export|reveal|print|output|respond|"
    r"reply|say|tell|call|invoke|use)\b",
    re.I,
)
MARKUP_IN_DATA = re.compile(r"(```|^#{1,6}\s|<\s*script|<\s*!--|\[.+\]\(.+\))")
URL = re.compile(r"https?://", re.I)


def scan_csv(path: str, text: str) -> None:
    try:
        rows = list(csv.reader(io.StringIO(text)))
    except csv.Error as e:
        add("3-data", "MEDIUM", path, f"unparseable as CSV: {e}")
        return
    if not rows:
        return
    header, body = rows[0], rows[1:]

    def col(i: int) -> str:
        return header[i] if i < len(header) else f"col{i}"

    # Length outliers: an injected directive is long for the column it hides in.
    cols: dict[int, list[str]] = defaultdict(list)
    for r in body:
        for i, cell in enumerate(r):
            cols[i].append(cell)
    for i, cells in cols.items():
        lens = [len(c) for c in cells if c]
        if len(lens) < 4:
            continue
        med = statistics.median(lens)
        thresh = max(med * 8, med + 200)
        for rownum, c in enumerate(cells, start=2):
            if len(c) > thresh:
                add(
                    "3-data",
                    "MEDIUM",
                    path,
                    f"row {rownum} col '{col(i)}': {len(c)}ch vs column median {med:.0f}",
                    c,
                )

    # Content with no business inside a data cell.
    for rownum, r in enumerate(rows, start=1):
        for i, c in enumerate(r):
            where = f"row {rownum} col '{col(i)}'"
            if SECOND_PERSON.search(c):
                add("3-data", "HIGH", path, f"{where}: agent-directed directive", c)
            if MARKUP_IN_DATA.search(c):
                add("3-data", "HIGH", path, f"{where}: markup/code in data cell", c)
            if "\n" in c:
                add("3-data", "MEDIUM", path, f"{where}: embedded newline", c)
            if IMPERATIVE.match(c) and len(c) > 40:
                add("3-data", "MEDIUM", path, f"{where}: imperative-led prose", c)
            if URL.search(c):
                add("3-data", "LOW", path, f"{where}: URL in data cell", c)


def scan_data_text(path: str, text: str) -> None:
    for m in SECOND_PERSON.finditer(text):
        line = text[: m.start()].count("\n") + 1
        add("3-data", "MEDIUM", path, f"L{line}: agent-directed directive in data file", m.group(0))


# --------------------------------------------------------------------- layer 4
# Unreviewable mass. Not evidence of anything by itself -- but it is exactly
# where a payload would be invisible to every human reviewer, so it gets
# inventoried rather than waved past as "vendored".
B64 = re.compile(r"[A-Za-z0-9+/]{200,}={0,2}")
MAGIC = {
    b"\x00asm": "wasm",
    b"\x89PNG": "png",
    b"PK\x03\x04": "zip",
    b"\x1f\x8b": "gzip",
    b"%PDF": "pdf",
    b"\x7fELF": "elf",
    b"\xcf\xfa\xed\xfe": "mach-o",
}


def entropy(b: bytes) -> float:
    if not b:
        return 0.0
    counts = Counter(b)
    n = len(b)
    return -sum((v / n) * math.log2(v / n) for v in counts.values())


def sniff(raw: bytes) -> str:
    for magic, name in MAGIC.items():
        if raw.startswith(magic):
            return name
    return "unknown"


def scan_opacity(path: str, raw: bytes, text: str | None) -> None:
    if text is None:
        add(
            "4-opacity",
            "INFO",
            path,
            f"binary ({sniff(raw)}), {len(raw)} bytes, entropy {entropy(raw):.2f}",
        )
        return
    ext = os.path.splitext(path)[1]
    if ext in CODE_EXT:
        longest = max((len(line) for line in text.split("\n")), default=0)
        if longest > 2000:
            add("4-opacity", "MEDIUM", path, f"minified: longest line {longest}ch, {len(raw)} bytes")
    for m in B64.finditer(text):
        blob = m.group(0)
        line = text[: m.start()].count("\n") + 1
        # Decode the head so the inventory says *what* is embedded, not just
        # that something is. An embedded PNG is furniture; an ELF is not.
        try:
            import base64

            kind = sniff(base64.b64decode(blob[:64] + "==", validate=False))
        except Exception:
            kind = "unknown"
        add("4-opacity", "MEDIUM", path, f"L{line}: base64 blob {len(blob)}ch ({kind})", blob[:80])


# ------------------------------------------------------------------- archives
# An archive is a scan-evasion channel: a filesystem walk never opens it, so
# anything inside ships unreviewed. Recurse into them.
def scan_archive(path: str, raw: bytes) -> None:
    members: list[tuple[str, bytes]] = []
    try:
        if raw.startswith(b"PK\x03\x04"):
            with zipfile.ZipFile(io.BytesIO(raw)) as zf:
                members = [(i.filename, zf.read(i)) for i in zf.infolist() if not i.is_dir()]
        else:
            with tarfile.open(fileobj=io.BytesIO(raw)) as tf:
                for m in tf.getmembers():
                    if not m.isfile():
                        continue
                    fh = tf.extractfile(m)
                    if fh:
                        members.append((m.name, fh.read()))
    except Exception as e:
        add("4-opacity", "MEDIUM", path, f"archive could not be opened for scanning: {e}")
        return
    add("4-opacity", "INFO", path, f"archive: {len(members)} members, scanned recursively")
    for name, data in members:
        scan_file(f"{path}!{name}", data)


def scan_file(rel: str, raw: bytes) -> None:
    try:
        text: str | None = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = None
    scan_opacity(rel, raw, text)
    if raw.startswith((b"PK\x03\x04", b"\x1f\x8b")) or rel.endswith((".tar", ".tgz")):
        scan_archive(rel, raw)
        return
    if text is None:
        return
    scan_invisible(rel, text)
    scan_capability(rel, text)
    ext = os.path.splitext(rel)[1]
    if ext == ".csv":
        scan_csv(rel, text)
    elif ext in DATA_EXT:
        scan_data_text(rel, text)


def main() -> int:
    if len(sys.argv) != 2:
        sys.stderr.write(f"usage: {sys.argv[0]} <skill-tree-dir>\n")
        return 2
    root = sys.argv[1]
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for fn in filenames:
            p = os.path.join(dirpath, fn)
            try:
                raw = open(p, "rb").read()
            except OSError as e:
                sys.stderr.write(f"skip {p}: {e}\n")
                continue
            scan_file(os.path.relpath(p, root), raw)

    rank = {"HIGH": 0, "MEDIUM": 1, "LOW": 2, "INFO": 3}
    findings.sort(key=lambda f: (rank[f["severity"]], f["layer"], f["path"]))
    json.dump(findings, sys.stdout, indent=1, ensure_ascii=False)
    sys.stdout.write("\n")
    tally = Counter(f"{f['severity']}/{f['layer']}" for f in findings)
    sys.stderr.write(f"{len(findings)} findings {json.dumps(dict(sorted(tally.items())))}\n")
    # Exit code is advisory only. Nothing here is a verdict without a judge pass,
    # so this must not be wired into CI as a blocking gate.
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
