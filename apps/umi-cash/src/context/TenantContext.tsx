'use client';

import { createContext, useContext } from 'react';

export type TenantContextValue = {
  slug: string;
  name: string;
  city: string | null;
  primaryColor: string;
  secondaryColor: string | null;
  cardPrefix: string;
  topupEnabled: boolean;
};

const TenantContext = createContext<TenantContextValue | null>(null);

export function TenantProvider({
  value,
  children,
}: {
  value: TenantContextValue;
  children: React.ReactNode;
}) {
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext);
  if (!ctx) throw new Error('useTenant must be used within TenantProvider');
  return ctx;
}
