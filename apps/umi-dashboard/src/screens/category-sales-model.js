export function categorySalesState(rows, total) {
  if (!Array.isArray(rows)) return 'unavailable';
  if (rows.some((row) => !Number.isSafeInteger(row.netMinorUnits))) return 'unavailable';
  const sum = rows.reduce((value, row) => value + BigInt(row.netMinorUnits), 0n);
  if (!Number.isSafeInteger(total) || sum !== BigInt(total)) return 'unavailable';
  if (rows.some((row) => row.netMinorUnits < 0) || total < 0) return 'signed';
  return total === 0 ? 'empty' : 'ready';
}

export function allocateHexagons(rows, cells) {
  const total = rows.reduce((sum, row) => sum + BigInt(row.netMinorUnits), 0n);
  if (total <= 0n || rows.some((row) => row.netMinorUnits < 0)) return [];
  const allocations = rows.map((row, index) => {
    const weighted = BigInt(row.netMinorUnits) * BigInt(cells);
    return { index, key: row.key, cells: Number(weighted / total), remainder: weighted % total };
  });
  let remaining = cells - allocations.reduce((sum, row) => sum + row.cells, 0);
  for (const row of [...allocations].sort((a, b) =>
    a.remainder === b.remainder ? a.key.localeCompare(b.key) : a.remainder > b.remainder ? -1 : 1,
  )) {
    if (remaining-- <= 0) break;
    row.cells += 1;
  }
  return allocations.map((row) => row.cells);
}
