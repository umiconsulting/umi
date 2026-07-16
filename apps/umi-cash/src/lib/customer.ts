/**
 * Profile fields written to a customer's core.people row at registration.
 *
 * Includes normalized_phone so the phone is denormalized onto people. Admin
 * phone-search and the register fast-path both read people.normalized_phone,
 * but core.resolve_contact only writes core.contact_methods — so without this the
 * column stays NULL forever (the El Gran Ribera duplicate-registration bug, 2026-07).
 * normalized_phone is omitted when unparseable so we never overwrite it with null.
 */
export function buildCustomerProfileData(input: {
  name: string;
  birthDate: string; // 'YYYY-MM-DD'
  device: string;
  os: string;
  normalizedPhone: string | null;
}): {
  display_name: string;
  birth_date: Date;
  metadata: Record<string, string>;
  normalized_phone?: string;
} {
  const data = {
    display_name: input.name,
    birth_date: new Date(input.birthDate + 'T00:00:00'),
    metadata: { device: input.device, os: input.os },
  } as {
    display_name: string;
    birth_date: Date;
    metadata: Record<string, string>;
    normalized_phone?: string;
  };
  if (input.normalizedPhone) data.normalized_phone = input.normalizedPhone;
  return data;
}
