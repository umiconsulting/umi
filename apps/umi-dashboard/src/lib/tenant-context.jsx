import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getAuthHeaders } from './auth.jsx'
import { buildModuleAvailability, canShowModule, getVisibleModules, isProductActive } from './module-registry.js'

const TenantContext = createContext(null)
const SELECTED_TENANT_KEY = 'umi-dashboard-selected-tenant'
const SELECTED_LOCATION_KEY = 'umi-dashboard-selected-location'

async function apiGet(path) {
  const headers = await getAuthHeaders()
  const res = await fetch(path, { headers })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(payload.error || `${res.status} ${path}`)
  return payload
}

export function TenantProvider({ children }) {
  const [tenants, setTenants] = useState([])
  const [selectedTenantId, setSelectedTenantIdState] = useState(() => window.localStorage.getItem(SELECTED_TENANT_KEY) || '')
  const [selectedLocationId, setSelectedLocationIdState] = useState(() => window.localStorage.getItem(SELECTED_LOCATION_KEY) || '')
  const [capabilities, setCapabilities] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    apiGet('/api/me/tenants')
      .then((payload) => {
        if (!active) return
        const nextTenants = payload.tenants || []
        setTenants(nextTenants)
        const stored = window.localStorage.getItem(SELECTED_TENANT_KEY)
        const nextSelected = nextTenants.some((tenant) => tenant.id === stored)
          ? stored
          : nextTenants[0]?.id || ''
        setSelectedTenantIdState(nextSelected)
        if (nextSelected) window.localStorage.setItem(SELECTED_TENANT_KEY, nextSelected)
      })
      .catch((err) => {
        if (!active) return
        setError(err.message)
        setTenants([])
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!selectedTenantId) {
      setCapabilities(null)
      return undefined
    }
    let active = true
    setLoading(true)
    setError(null)
    const qs = selectedLocationId ? `?locationId=${encodeURIComponent(selectedLocationId)}` : ''
    apiGet(`/api/tenants/${encodeURIComponent(selectedTenantId)}/capabilities${qs}`)
      .then((payload) => {
        if (!active) return
        const next = { ...payload, modules: payload.modules || buildModuleAvailability(payload) }
        const locationOk = !selectedLocationId || next.locations?.some((location) => location.id === selectedLocationId)
        if (!locationOk) {
          setSelectedLocationIdState('')
          window.localStorage.removeItem(SELECTED_LOCATION_KEY)
        }
        setCapabilities(next)
      })
      .catch((err) => {
        if (!active) return
        setCapabilities(null)
        setError(err.message)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [selectedTenantId, selectedLocationId])

  const setSelectedTenantId = (tenantId) => {
    setSelectedTenantIdState(tenantId)
    setSelectedLocationIdState('')
    if (tenantId) window.localStorage.setItem(SELECTED_TENANT_KEY, tenantId)
    window.localStorage.removeItem(SELECTED_LOCATION_KEY)
  }

  const setSelectedLocationId = (locationId) => {
    setSelectedLocationIdState(locationId || '')
    if (locationId) window.localStorage.setItem(SELECTED_LOCATION_KEY, locationId)
    else window.localStorage.removeItem(SELECTED_LOCATION_KEY)
  }

  const updateSelectedTenant = (patch) => {
    if (!selectedTenantId || !patch) return
    setTenants(prev => prev.map(tenant => (
      tenant.id === selectedTenantId ? { ...tenant, ...patch } : tenant
    )))
    setCapabilities(prev => (
      prev?.tenant ? { ...prev, tenant: { ...prev.tenant, ...patch } } : prev
    ))
  }

  const value = useMemo(() => ({
    tenants,
    selectedTenantId,
    selectedLocationId,
    selectedTenant: tenants.find((tenant) => tenant.id === selectedTenantId) || capabilities?.tenant || null,
    selectedLocation: capabilities?.selectedLocation || null,
    capabilities,
    loading,
    error,
    setSelectedTenantId,
    setSelectedLocationId,
    updateSelectedTenant,
    isProductActive: (productKey) => isProductActive(productKey, capabilities),
    canShowModule: (moduleKey) => canShowModule(moduleKey, capabilities),
    visibleModules: getVisibleModules(capabilities),
  }), [tenants, selectedTenantId, selectedLocationId, capabilities, loading, error])

  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant() {
  return useContext(TenantContext)
}
