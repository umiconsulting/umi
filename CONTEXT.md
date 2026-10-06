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

## Roles y permisos

- Un `Permiso canónico` es una autoridad de acción que Umi define y mantiene. Un merchant no crea permisos nuevos.
- Una `Plantilla de rol` es un perfil global que Umi mantiene con un nombre, una descripción y permisos predeterminados.
- Un `Rol del merchant` es un perfil propio de un merchant. Puede partir de una plantilla y conserva su configuración independiente.
- Una `Asignación de rol` vincula a una persona del equipo con un rol del merchant y con su alcance autorizado.
- Los `Permisos efectivos` son las autoridades que la API calcula para una asignación, su alcance y sus restricciones vigentes.
- `location.switch` permite seleccionar otra sucursal del mismo merchant.
- El `Alcance de sucursal` es la sucursal que la API obtiene de la asignación y de los permisos efectivos.
- Una `Sucursal seleccionada` es una intención de navegación. No concede autoridad por sí misma.
