// All monetary values are stored as integer centavos to avoid float issues
// $150.50 MXN = 15050 centavos

export function formatMXN(centavos: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
  }).format(centavos / 100);
}

export function centavosFromPesos(pesosString: string): number {
  const normalized = pesosString.replace(',', '.').trim();
  const value = parseFloat(normalized);
  if (isNaN(value) || value < 0) throw new Error('Monto inválido');
  return Math.round(value * 100);
}

// Quick top-up amounts for the admin UI
export const COMMON_TOPUP_AMOUNTS: { label: string; centavos: number }[] = [
  { label: '$50', centavos: 5_000 },
  { label: '$100', centavos: 10_000 },
  { label: '$200', centavos: 20_000 },
  { label: '$500', centavos: 50_000 },
];

// Max single top-up: $10,000 MXN
export const MAX_TOPUP_CENTAVOS = 1_000_000;
