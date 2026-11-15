// Closed, table-driven schema for the evidence policy and packet.
//
// The repository does not expose Ajv or Zod as root-resolvable imports, and this
// task may not edit the lockfile or install from the network. This module is the
// single structural definition; `evidence.mjs` walks it and rejects unknown keys.

export const SCHEMA_VERSION = '1';

const sha256Field = { key: 'sha256', kind: 'sha256' };

export const PACKET_SPEC = {
  kind: 'object',
  fields: [
    { key: 'schemaVersion', kind: 'const', value: SCHEMA_VERSION },
    { key: 'runId', kind: 'string', nonEmpty: true, pattern: /^[A-Za-z0-9._:-]{3,160}$/ },
    { key: 'createdAt', kind: 'isoDate' },
    { key: 'contentView', kind: 'enum', values: ['working-tree', 'ci-tree'] },
    { key: 'policySha256', kind: 'sha256' },
    {
      key: 'check',
      kind: 'object',
      fields: [
        { key: 'id', kind: 'string', nonEmpty: true },
        { key: 'argv', kind: 'array', minItems: 1, items: { kind: 'string', nonEmpty: true } },
        { key: 'cwd', kind: 'string', nonEmpty: true },
      ],
    },
    {
      key: 'capture',
      kind: 'object',
      fields: [
        { key: 'tool', kind: 'string', nonEmpty: true },
        { key: 'version', kind: 'string', nonEmpty: true },
      ],
    },
    {
      key: 'logs',
      kind: 'object',
      fields: [
        {
          key: 'stdout',
          kind: 'object',
          fields: [
            { key: 'path', kind: 'string', nonEmpty: true },
            sha256Field,
            { key: 'bytes', kind: 'int', min: 0 },
          ],
        },
        {
          key: 'stderr',
          kind: 'object',
          fields: [
            { key: 'path', kind: 'string', nonEmpty: true },
            sha256Field,
            { key: 'bytes', kind: 'int', min: 0 },
          ],
        },
      ],
    },
    {
      key: 'outcome',
      kind: 'object',
      fields: [
        { key: 'exitCode', kind: 'int', min: 0, max: 255 },
        { key: 'signal', kind: 'nullableString' },
      ],
    },
    {
      key: 'tested',
      kind: 'array',
      minItems: 1,
      items: {
        kind: 'object',
        fields: [
          { key: 'path', kind: 'string', nonEmpty: true },
          sha256Field,
          { key: 'bytes', kind: 'int', min: 0 },
        ],
      },
    },
    // Informational only. The validator never uses this field to decide
    // whether a packet is required; checked-in policy is authoritative.
    { key: 'required', kind: 'boolean', optional: true },
  ],
};

export const POLICY_SPEC = {
  kind: 'object',
  fields: [
    { key: 'schemaVersion', kind: 'const', value: SCHEMA_VERSION },
    {
      key: 'coverage',
      kind: 'object',
      fields: [
        { key: 'enforced', kind: 'boolean' },
        {
          key: 'requiredCheckIds',
          kind: 'array',
          minItems: 1,
          items: { kind: 'string', nonEmpty: true },
        },
      ],
    },
    { key: 'packetsDir', kind: 'string', nonEmpty: true },
    {
      key: 'checks',
      kind: 'array',
      minItems: 1,
      items: {
        kind: 'object',
        fields: [
          { key: 'id', kind: 'string', nonEmpty: true },
          { key: 'argv', kind: 'array', minItems: 1, items: { kind: 'string', nonEmpty: true } },
          { key: 'cwd', kind: 'string', nonEmpty: true },
          { key: 'tested', kind: 'array', minItems: 1, items: { kind: 'string', nonEmpty: true } },
          { key: 'minStdoutBytes', kind: 'int', min: 0, optional: true },
        ],
      },
    },
  ],
};

export function schemaDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    description:
      'Closed evidence packet schema. The structural walker rejects unknown keys, wrong types, and invalid digests.',
    packet: PACKET_SPEC,
    policy: POLICY_SPEC,
  };
}
