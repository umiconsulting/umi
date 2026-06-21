# Skill template

```md
---
name: <skill-name>
description: <when to use this skill>
---

# <Title>

## Goal
- <single outcome>

## Steps
1. <step 1>
2. <step 2>
3. <step 3>

Read `<support-file>.md`.
```

## Registry metadata
- scope: <what this skill owns>
- trigger patterns: <how routing should discover it>
- placement hints: <where it applies in the filesystem>
- confidence: low | medium | high
- provenance: <which successful traces justified it>

## When not to create a skill
- The task is rare.
- The task is mostly judgment.
- The task belongs in `CLAUDE.md` as a project fact.
- The task duplicates an existing skill.
- The promotion criteria have not passed yet.
