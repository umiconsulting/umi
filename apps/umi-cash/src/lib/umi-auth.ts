import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { backendFetch } from './backend';

export async function umiAdminFetch(path: string): Promise<Response> {
  const store = await cookies();
  const cookie = store.getAll().map(({ name, value }) => `${name}=${value}`).join('; ');
  const response = await backendFetch(path, { headers: { cookie } });
  if (response.status === 401 || response.status === 403) redirect('/umi/login');
  if (!response.ok) throw new Error('El panel de Umi no está disponible.');
  return response;
}

export async function requireUmiAdmin(): Promise<void> {
  await umiAdminFetch('/api/umi/session');
}
