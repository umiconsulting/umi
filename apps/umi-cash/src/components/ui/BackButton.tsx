'use client';

import { useRouter } from 'next/navigation';

export default function BackButton({ label = '← Volver' }: { label?: string }) {
  const router = useRouter();
  return (
    <button onClick={() => router.back()} className="btn-secondary inline-block">
      {label}
    </button>
  );
}
