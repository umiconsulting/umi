import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAuthHeaders } from './auth.jsx';
import { apiUrl, withCreds, errMessage } from './config.js';
import {
  buildModuleAvailability,
  canShowModule,
  getVisibleModules,
  isProductActive,
} from './module-registry.js';
import { routes } from '@umi/contract/routes';

const MerchantContext = createContext(null);
const SELECTED_MERCHANT_KEY = 'umi-dashboard-selected-merchant';
const SELECTED_LOCATION_KEY = 'umi-dashboard-selected-location';

async function apiGet(path) {
  const headers = await getAuthHeaders();
  const res = await fetch(apiUrl(path), withCreds({ headers }));
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(errMessage(payload, `${res.status} ${path}`));
  return payload;
}

export function MerchantProvider({ children }) {
  const [merchants, setMerchants] = useState([]);
  const [selectedMerchantId, setSelectedMerchantIdState] = useState(
    () => window.localStorage.getItem(SELECTED_MERCHANT_KEY) || '',
  );
  const [selectedLocationId, setSelectedLocationIdState] = useState(
    () => window.localStorage.getItem(SELECTED_LOCATION_KEY) || '',
  );
  const [capabilities, setCapabilities] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    apiGet(routes.me.merchants)
      .then((payload) => {
        if (!active) return;
        const nextMerchants = payload.merchants || [];
        setMerchants(nextMerchants);
        const stored = window.localStorage.getItem(SELECTED_MERCHANT_KEY);
        const nextSelected = nextMerchants.some((merchant) => merchant.id === stored)
          ? stored
          : nextMerchants[0]?.id || '';
        setSelectedMerchantIdState(nextSelected);
        if (nextSelected) window.localStorage.setItem(SELECTED_MERCHANT_KEY, nextSelected);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message);
        setMerchants([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedMerchantId) {
      setCapabilities(null);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError(null);
    const qs = selectedLocationId ? `?locationId=${encodeURIComponent(selectedLocationId)}` : '';
    apiGet(`/api/merchants/${encodeURIComponent(selectedMerchantId)}/capabilities${qs}`)
      .then((payload) => {
        if (!active) return;
        const next = { ...payload, modules: payload.modules || buildModuleAvailability(payload) };
        const locationOk =
          !selectedLocationId ||
          next.locations?.some((location) => location.id === selectedLocationId);
        if (!locationOk) {
          setSelectedLocationIdState('');
          window.localStorage.removeItem(SELECTED_LOCATION_KEY);
        }
        setCapabilities(next);
      })
      .catch((err) => {
        if (!active) return;
        setCapabilities(null);
        setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedMerchantId, selectedLocationId]);

  const setSelectedMerchantId = (merchantId) => {
    setSelectedMerchantIdState(merchantId);
    setSelectedLocationIdState('');
    if (merchantId) window.localStorage.setItem(SELECTED_MERCHANT_KEY, merchantId);
    window.localStorage.removeItem(SELECTED_LOCATION_KEY);
  };

  const setSelectedLocationId = (locationId) => {
    setSelectedLocationIdState(locationId || '');
    if (locationId) window.localStorage.setItem(SELECTED_LOCATION_KEY, locationId);
    else window.localStorage.removeItem(SELECTED_LOCATION_KEY);
  };

  // useCallback + an explicit dep so the memo below can track it. It closes over
  // selectedMerchantId; today that value is also in the memo's deps, so the closure
  // happens to stay fresh — but nothing enforced that. The moment this reads one more
  // reactive value, every context consumer would silently receive a stale function.
  const updateSelectedMerchant = useCallback(
    (patch) => {
      if (!selectedMerchantId || !patch) return;
      setMerchants((prev) =>
        prev.map((merchant) =>
          merchant.id === selectedMerchantId ? { ...merchant, ...patch } : merchant,
        ),
      );
      setCapabilities((prev) =>
        prev?.merchant ? { ...prev, merchant: { ...prev.merchant, ...patch } } : prev,
      );
    },
    [selectedMerchantId],
  );

  const value = useMemo(
    () => ({
      merchants,
      selectedMerchantId,
      selectedLocationId,
      selectedMerchant:
        merchants.find((merchant) => merchant.id === selectedMerchantId) ||
        capabilities?.merchant ||
        null,
      selectedLocation: capabilities?.selectedLocation || null,
      capabilities,
      loading,
      error,
      setSelectedMerchantId,
      setSelectedLocationId,
      updateSelectedMerchant,
      isProductActive: (productKey) => isProductActive(productKey, capabilities),
      canShowModule: (moduleKey) => canShowModule(moduleKey, capabilities),
      visibleModules: getVisibleModules(capabilities),
    }),
    [
      merchants,
      selectedMerchantId,
      selectedLocationId,
      capabilities,
      loading,
      error,
      updateSelectedMerchant,
    ],
  );

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant() {
  return useContext(MerchantContext);
}
