'use client';

export function LogoutButton() {
  async function handleLogout() {
    await fetch('/api/umi/auth', { method: 'DELETE' });
    window.location.href = '/umi/login';
  }

  return (
    <button onClick={handleLogout} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
      Cerrar sesión
    </button>
  );
}
