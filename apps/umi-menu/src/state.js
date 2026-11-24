'use strict';
(function (root) {
  function validateLine(items, line) {
    const item = items.find((item) => item.productId === line.productId);
    if (!item || item.availability !== 'enabled')
      throw new Error('Un producto cambió o requiere atención del personal. Revisa tu pedido.');
    const variants = item.variants ?? [];
    if (item.hasVariants && !line.variantId)
      throw new Error('Elige una presentación del producto.');
    if (
      line.variantId &&
      !variants.some(
        (variant) => variant.id === line.variantId && variant.availability === 'enabled',
      )
    )
      throw new Error('La presentación elegida ya no está disponible.');
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 50)
      throw new Error('Elige entre 1 y 50 unidades por producto.');
    const modifiers = line.modifiers ?? [];
    const ids = new Set();
    for (const selection of modifiers) {
      if (
        ids.has(selection.modifierId) ||
        selection.quantity !== 1 ||
        !item.optionGroups.some((group) =>
          group.modifiers.some((modifier) => modifier.id === selection.modifierId),
        )
      )
        throw new Error('Una opción del producto cambió. Revisa tu pedido.');
      ids.add(selection.modifierId);
    }
    for (const group of item.optionGroups) {
      const count = group.modifiers.filter((modifier) => ids.has(modifier.id)).length;
      if (count < group.minSelect || (group.maxSelect !== null && count > group.maxSelect))
        throw new Error(`Revisa las opciones de ${group.name}.`);
    }
    if (
      line.note != null &&
      (typeof line.note !== 'string' || line.note.length > 500 || /[<>]/.test(line.note))
    )
      throw new Error('Las indicaciones deben ser texto de hasta 500 caracteres.');
    return item;
  }
  function priceLine(items, line) {
    const item = validateLine(items, line);
    const ids = new Set((line.modifiers ?? []).map((modifier) => modifier.modifierId));
    const extra = item.optionGroups
      .flatMap((group) => group.modifiers)
      .filter((modifier) => ids.has(modifier.id))
      .reduce((sum, modifier) => sum + modifier.priceDelta.minorUnits, 0);
    const variantDelta =
      (item.variants ?? []).find((variant) => variant.id === line.variantId)?.priceDelta
        .minorUnits ?? 0;
    return (item.price.minorUnits + variantDelta + extra) * line.quantity;
  }
  function addLine(lines, next) {
    const key = (line) =>
      JSON.stringify([
        line.productId,
        line.variantId ?? null,
        line.modifiers.map((m) => m.modifierId).sort(),
        line.note ?? null,
      ]);
    const index = lines.findIndex((line) => key(line) === key(next));
    if (index < 0) {
      if (lines.length >= 50)
        throw new Error('Puedes agregar hasta 50 productos distintos por pedido.');
      return [...lines, next];
    }
    const quantity = lines[index].quantity + next.quantity;
    if (quantity > 50) throw new Error('Puedes agregar hasta 50 unidades por producto.');
    return lines.map((line, i) => (i === index ? { ...line, quantity } : line));
  }
  function pendingRequest(lines, idempotencyKey) {
    return {
      idempotencyKey,
      lines: JSON.parse(JSON.stringify(lines)),
      guestName: null,
      guestPhone: null,
      note: null,
    };
  }
  const api = { validateLine, priceLine, addLine, pendingRequest };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MenuState = api;
})(globalThis);
