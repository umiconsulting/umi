import { QueryClient } from '@tanstack/react-query';

/**
 * One shared query cache for the dashboard. The Customers screen is read-heavy,
 * so the defaults favour a warm cache across list↔profile navigation over
 * chattiness: data is fresh for a short window, kept for five minutes after a
 * view unmounts, and not refetched just because the owner tabbed away and back.
 *
 * This is the first adopter (the WhatsApp transcript). Other data hooks stay on
 * the bespoke `_useAsync` loader until they are migrated deliberately.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
