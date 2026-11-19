import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getAuthHeaders, getStoredSession, handleSessionExpired } from './auth.jsx';
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
  if (res.status === 401) {
    // The business shell has no session. A consumer token reaches this branch:
    // it is not a merchant session, and a stale cached profile must not keep the
    // console on a "could not load" card.
    handleSessionExpired();
    const err = new Error('Sesión expirada');
    err.status = 401;
    throw err;
  }
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
  // Two requests resolve independently. The list can finish first; without a
  // separate flag its `setLoading(false)` turned the shell's loading state off
  // while the capability request was still in flight, and the shell answered
  // "Sin negocio seleccionado" over a café that was about to load.
  const [capabilitiesLoading, setCapabilitiesLoading] = useState(true);
  // A selected id from localStorage is not proof of membership. Before the list
  // resolves it may name a café the signed-in person cannot open; asking for its
  // capabilities is one 403 for a nonmember, and a stale role for a switch.
  const [merchantsLoaded, setMerchantsLoaded] = useState(false);
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
        if (active) {
          setMerchantsLoaded(true);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const merchantIds = merchants.map((merchant) => merchant.id).join('|');

  useEffect(() => {
    // Wait for the membership list. Until it resolves, `selectedMerchantId` is
    // only a localStorage hint, not a café this person may read.
    if (!merchantsLoaded) return undefined;
    const knownMerchant = merchantIds.split('|').includes(selectedMerchantId);
    if (!selectedMerchantId || !knownMerchant) {
      // NO CAFÉ, NO AUTHORITY. Keep the old capabilities here and a merchant
      // switch would leave the previous café's permissions on screen for one
      // frame — enough to draw the previous merchant's member list, or to offer
      // a command the new membership does not hold.
      setCapabilities(null);
      setCapabilitiesLoading(false);
      setLoading(false);
      return undefined;
    }
    let active = true;
    // Clear before the request. `DashboardLayout` renders its loading state when
    // `loading && !capabilities`; keeping the old object made that condition false
    // and the old screen stayed mounted under the new merchant's name.
    setCapabilities(null);
    setCapabilitiesLoading(true);
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
        if (active) {
          setCapabilitiesLoading(false);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [selectedMerchantId, selectedLocationId, merchantsLoaded, merchantIds]);

  const setSelectedMerchantId = (merchantId) => {
    // Clear authority IN THE SAME UPDATE as the merchant id. The capability
    // effect runs after render; until it does, every data hook would see the
    // new merchant id with the old café's permissions and fetch the new
    // merchant's member list under the old role.
    setCapabilities(null);
    setCapabilitiesLoading(true);
    setError(null);
    setSelectedMerchantIdState(merchantId);
    setSelectedLocationIdState('');
    if (merchantId) window.localStorage.setItem(SELECTED_MERCHANT_KEY, merchantId);
    window.localStorage.removeItem(SELECTED_LOCATION_KEY);
  };

  const setSelectedLocationId = (locationId) => {
    if (
      locationId &&
      locationId !== selectedLocationId &&
      capabilities?.canSwitchLocations !== true
    ) {
      return;
    }
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

  // THE PLATFORM GRANT, read from the session the API already sends. Not
  // inferred from `merchants[].roles`: that array carries the platform role only
  // as a fallback for cafés where the user has no staff row, so an operator who
  // also works at one café reads as ordinary staff there.
  const platformRole = getStoredSession()?.platformRole ?? null;

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
      loading: loading || capabilitiesLoading,
      error,
      setSelectedMerchantId,
      setSelectedLocationId,
      updateSelectedMerchant,
      isProductActive: (productKey) => isProductActive(productKey, capabilities),
      canShowModule: (moduleKey) => canShowModule(moduleKey, capabilities, platformRole),
      visibleModules: getVisibleModules(capabilities, platformRole),
      platformRole,
    }),
    [
      merchants,
      selectedMerchantId,
      selectedLocationId,
      capabilities,
      loading,
      capabilitiesLoading,
      error,
      updateSelectedMerchant,
      platformRole,
    ],
  );

  return <MerchantContext.Provider value={value}>{children}</MerchantContext.Provider>;
}

export function useMerchant() {
  return useContext(MerchantContext);
}
