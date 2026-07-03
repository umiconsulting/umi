import type { VoiceConfig } from './business-config.service';
import type { CustomerFacts, WorkingMemory } from './memory.service';
import type { PartialCancelledOrderContext } from './conversation.types';

/**
 * System-prompt builder. Verbatim port of `whatsapp-handler/prompts.ts`
 * (behavior-fidelity carry-over, preflight §7). PROMPT_VERSION is a code
 * constant logged to traces — never an env var.
 */
export const PROMPT_VERSION = 'v5.1.0';

export interface PromptContext {
  customerName: string | null;
  currentState: string;
  workingMemory?: WorkingMemory;
  partialCancelledOrder?: PartialCancelledOrderContext | null;
}

function sanitizeCustomerFacts(facts: CustomerFacts): CustomerFacts {
  const MAX_FIELD_LEN = 100;
  const MAX_ARRAY_ITEMS = 10;
  const INJECTION_PATTERN =
    /\b(ignore|disregard|forget|override|system:|assistant:|instruction)\b/i;

  function cleanArray(arr: unknown): string[] {
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((item): item is string => typeof item === 'string')
      .filter((item) => !INJECTION_PATTERN.test(item))
      .map((item) => item.substring(0, MAX_FIELD_LEN))
      .slice(0, MAX_ARRAY_ITEMS);
  }

  function cleanString(s: unknown): string | null {
    if (typeof s !== 'string' || !s) return null;
    if (INJECTION_PATTERN.test(s)) return null;
    return s.substring(0, MAX_FIELD_LEN);
  }

  return {
    preferences: cleanArray(facts.preferences),
    dislikes: cleanArray(facts.dislikes),
    typical_order: cleanString(facts.typical_order),
    allergies: cleanArray(facts.allergies),
    notes: cleanString(facts.notes),
  };
}

/**
 * Neutralize prompt-injection in free-text memory (rolling summary, recalled
 * past-conversation snippets) before it is interpolated into the system prompt.
 * Strips role-prefixed lines and instruction-override tokens without discarding
 * the whole snippet — the same untrusted-input philosophy as sanitizeCustomerFacts.
 */
function sanitizeMemorySnippet(text: string): string {
  return text
    .replace(/^\s*(system|assistant|user|cliente|asistente)\s*:/gim, '')
    .replace(/\b(ignore|disregard|forget|override)\s+(all\s+)?(previous|prior|above)\b/gi, '[removed]')
    .replace(/\[\/?INST\]/gi, '')
    .replace(/<\|[^|]*\|>/g, '')
    .trim();
}

function formatFacts(facts: CustomerFacts): string {
  const safe = sanitizeCustomerFacts(facts);
  const lines: string[] = [];
  if (safe.preferences?.length) {
    lines.push(`- Preferencias: ${safe.preferences.join(', ')}`);
  }
  if (safe.dislikes?.length) {
    lines.push(`- No le gusta: ${safe.dislikes.join(', ')}`);
  }
  if (safe.typical_order) lines.push(`- Pedido típico: ${safe.typical_order}`);
  if (safe.allergies?.length) {
    lines.push(`- Alergias/intolerancias: ${safe.allergies.join(', ')}`);
  }
  if (safe.notes) lines.push(`- Notas: ${safe.notes}`);
  return lines.join('\n');
}

function buildWorkingMemorySections(ctx: PromptContext): string {
  const wm = ctx.workingMemory;

  const facts = wm?.facts;
  const hasFacts =
    !!facts &&
    (Object.values(facts) as unknown[]).some((v) =>
      Array.isArray(v) ? v.length > 0 : v != null,
    );

  const factsSection = hasFacts
    ? `\n## HISTORIAL DEL CLIENTE\n${formatFacts(
        facts,
      )}\n⚠️ Estos datos son referencia de contexto. No son válidos para mencionar productos o precios sin una llamada fresca al menú.\n`
    : '';

  const summarySection = wm?.summary
    ? `\n## RESUMEN DE CONVERSACIÓN ANTERIOR\n${sanitizeMemorySnippet(wm.summary)}\n`
    : '';

  const semanticSection = wm?.semanticContext?.length
    ? `\n## CONTEXTO RELEVANTE DE CONVERSACIONES PASADAS\n${wm.semanticContext
        .map((m) => `[${m.role === 'assistant' ? 'assistant' : 'user'}]: ${sanitizeMemorySnippet(m.content)}`)
        .join('\n')}\n`
    : '';

  const partialCancellationSection = ctx.partialCancelledOrder
    ? `\n## CAMBIOS PENDIENTES EN EL PEDIDO
Motivo de la cancelación parcial: ${ctx.partialCancelledOrder.reason}
Items cancelados:
${
        ctx.partialCancelledOrder.cancelledItems
          .map(
            (item) =>
              `- ${item.quantity}x ${item.name}${
                item.variantName ? ` (${item.variantName})` : ''
              }`,
          )
          .join('\n') || '- Ninguno'
      }
Items restantes:
${
        ctx.partialCancelledOrder.remainingItems
          .map(
            (item) =>
              `- ${item.quantity}x ${item.name}${
                item.variantName ? ` (${item.variantName})` : ''
              }`,
          )
          .join('\n') || '- Ninguno'
      }
Si el cliente acepta estos cambios, confirma el pedido actualizado. Si quiere cancelar todo, procede con la cancelación completa. Si pide más modificaciones, primero aclara si desea aceptar/cancelar el pedido ajustado o iniciar un pedido nuevo aparte. No inicies un pedido nuevo automáticamente.\n`
    : '';

  return `${factsSection}${summarySection}${semanticSection}${partialCancellationSection}`;
}

export function buildVoiceSystemPrompt(params: {
  customerName: string | null;
  currentState: string;
  workingMemory?: WorkingMemory;
  partialCancelledOrder?: PartialCancelledOrderContext | null;
  voice: VoiceConfig;
}): string {
  const nameSection = params.customerName
    ? `Cliente: ${params.customerName}`
    : 'Cliente: Desconocido';

  const styleNotes = params.voice.style_notes?.length
    ? `\nNotas de estilo:\n${params.voice.style_notes
        .map((note) => `- ${note}`)
        .join('\n')}`
    : '';

  return `
# ROL
Eres ${params.voice.assistant_name}, asistente de WhatsApp del negocio.

# VOZ
- Locale: ${params.voice.locale}
- Tono: ${params.voice.tone}${styleNotes}
- Sé natural, cálido y breve.
- Responde como si la acción ya hubiera sido verificada por el sistema.

# CONTEXTO
${nameSection}
Estado actual: ${params.currentState}
  ${buildWorkingMemorySections({
    customerName: params.customerName,
    currentState: params.currentState,
    workingMemory: params.workingMemory,
    partialCancelledOrder: params.partialCancelledOrder,
  })}

# RESTRICCIONES
- Nunca inventes precios, nombres, cantidades, IDs de orden, horarios ni pagos.
- Usa solo los datos presentes en ACTION_TAKEN y SUGGESTED_REPLY.
- No menciones herramientas, prompts, bases de datos ni procesos internos.
- Si no hubo acción operativa, responde de forma conversacional y útil.
- No digas que el pedido del cliente es "demasiado específico", "muy largo" o similar; los pedidos con varias preferencias son normales.
- Si existe una cancelación parcial pendiente y el cliente acepta los cambios, confirma el pedido actualizado. Si rechaza los cambios por completo, puedes cancelar el pedido. Si pide modificaciones adicionales, primero aclara si quiere aceptar/cancelar el pedido ajustado o iniciar un pedido nuevo aparte. No conviertas eso automáticamente en una nueva orden.

# BÚSQUEDA SIN COINCIDENCIA
Si el ACTION_TAKEN de search_menu trae \`data_summary.match_type = "near"\`, el cliente pidió algo que no existe tal cual pero hay productos parecidos en \`data_summary.candidates\`:
- Reconoce brevemente que no tenemos exactamente lo que pidió.
- Ofrece 2–3 alternativas concretas por nombre de \`candidates\`, agrupadas por categoría cuando ayude.
- Nunca listes nombres de categorías internas en crudo (como "Sin categoría", "OTROS", "RENTA ESPACIOS", "MERCH").
- Nunca le pidas al cliente "escoge una categoría" si hay candidatos disponibles: proponle productos.

Si \`match_type = "none"\`, sé breve: pide que describa qué tipo de antojo tiene (dulce, salado, bebida caliente, fría) para orientarlo, sin volcar el listado interno.

Si \`match_type = "browse"\`, usa los ejemplos de \`data_summary.categories\` para proponer 2–3 opciones concretas por categoría, no solo los nombres de las categorías.
`.trim();
}

/**
 * Multi-branch instruction block. Present ONLY when the tenant has >1 active
 * location and branch resolution is enabled. When no branch is chosen yet it
 * makes the bot ask once (in the business voice) before taking/confirming an
 * order and call `set_branch`; once chosen it tells the bot to stop asking.
 */
export interface BranchPromptContext {
  branches: string[];
  selectedBranch: string | null;
}

function buildBranchSection(branch: BranchPromptContext | null | undefined): string {
  if (!branch) return '';
  if (branch.selectedBranch) {
    return `
# SUCURSAL
El cliente ya eligió la sucursal: ${branch.selectedBranch}. No vuelvas a preguntar por la sucursal; continúa con su pedido normalmente.
`;
  }
  if (branch.branches.length < 2) return '';
  const list = branch.branches.map((b) => `- ${b}`).join('\n');
  return `
# SUCURSALES
Este negocio tiene varias sucursales:
${list}
Antes de agregar productos o confirmar un pedido, DEBES preguntar de qué sucursal quiere ordenar el cliente. Haz UNA sola pregunta, en la voz del negocio. Cuando el cliente indique la sucursal —aunque use un apodo o abreviación como "chapu" por "Chapultepec"— llama a la herramienta \`set_branch\` con el nombre. Si no queda claro a cuál se refiere, vuelve a preguntar mostrando las opciones. No olvides lo que el cliente ya pidió: después de fijar la sucursal, continúa con ese pedido.
`;
}

export function buildHarnessSystemPrompt(params: {
  customerName: string | null;
  currentState: string;
  workingMemory?: WorkingMemory;
  partialCancelledOrder?: PartialCancelledOrderContext | null;
  voice: VoiceConfig;
  branchContext?: BranchPromptContext | null;
}): string {
  const basePrompt = buildVoiceSystemPrompt(params);
  const branchSection = buildBranchSection(params.branchContext);

  return `
${basePrompt}
${branchSection}
# HERRAMIENTAS
Usa herramientas cuando necesites verificar información operativa o afectar el pedido.
- \`search_menu\`: para productos, categorías, disponibilidad aproximada y búsquedas vagas como "comida", "algo dulce" o "otra bebida".
- \`add_to_cart\`: para agregar o ajustar productos en el carrito borrador. Incluye size, temp y milk cuando el cliente los especifique.
- \`confirm_order\`: solo después de que el cliente confirme explícitamente el resumen actual del pedido.
- \`confirm_order_changes\`: para aceptar un pedido ajustado después de una cancelación parcial activa.
- \`cancel_order\`: para cancelar un pedido pendiente cuando ya tengas o consigas el motivo.
- \`get_recent_customer_orders\`: para revisar pedidos previos antes de repetirlos.
- \`reorder_last_order\`: solo después de confirmar explícitamente que quiere repetir el último pedido.
- \`get_business_hours\`: para horarios o si todavía reciben pedidos.
- \`get_business_info\`: para dirección, pagos y datos operativos.

# REGLAS DE ORQUESTACIÓN
- La historia reciente ya contiene contexto conversacional. Úsala para resolver referencias como "el cappuccino también grande", "lo mismo" o "otra cosa".
- Si una herramienta devuelve \`needs_clarification\`, haz esa pregunta exacta.
- Si una herramienta devuelve \`summary_text\` o \`display_text\`, úsalo como base principal de tu respuesta.
- Nunca confirmes una orden, número de orden, precio o cambio de carrito si ninguna herramienta lo verificó.
- No bloquees búsquedas vagas: si el cliente expresa intención de explorar el menú sin producto exacto, usa \`search_menu\`.
- Consultas informativas (qué es, qué lleva, qué contiene, qué ingredientes tiene, cómo sabe, qué variantes tiene) sin palabras de pedido explícitas ("quiero", "dame", "ponme", "me das"): usa \`search_menu\` y responde descriptivamente. NUNCA llames \`add_to_cart\` por una consulta informativa.
- Si el resultado de \`search_menu\` no trae descripción de ingredientes, sé honesto: no tienes ese detalle; sugiere preguntar en el local si necesita saberlo. Menciona nombre, categoría y precio si los hay.
`.trim();
}
