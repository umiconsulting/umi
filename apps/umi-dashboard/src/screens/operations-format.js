export function formatOperationMoney(value, currency) {
  if (value == null || !currency) return '—';
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(value / 100);
}

export function formatOperationDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}
