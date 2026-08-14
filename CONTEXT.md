# Modelo de dominio de UmiPOS

## Gate 3F

- `apps/umi-cash` conserva la lealtad del consumidor, el wallet y los pases de Umi Cash.
- `apps/umi-api` controla los hechos de lealtad y valor para ventas de UmiPOS.
- Los dos límites no comparten balances ni ledgers.

- Un `Customer` identifica a una persona dentro de un merchant.
- Un `CustomerContact` contiene un contacto normalizado y una vista protegida.
- Un `CustomerConsent` registra una decisión inmutable por tipo de consentimiento.
- Un `LoyaltyAccount` contiene puntos de un cliente y de un programa.
- Un `RewardAuthorization` reserva puntos. No canjea los puntos.
- Un `WalletAccount` contiene valor del merchant para un cliente y una moneda.
- Un `GiftCard` contiene valor al portador. El sistema guarda el código como hash.
- Un `StoredValueAuthorization` reserva valor. No crea un débito final.
- Un ledger contiene hechos inmutables. Una proyección se puede reconstruir desde esos hechos.
- El checkout compromete la venta, el inventario, los puntos y el valor en una transacción.
- Un refund agrega hechos de reversión. No modifica el hecho original.
