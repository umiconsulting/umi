import { getSupabaseClient } from "../_shared/supabase.ts";
import { insertMessage } from "../_shared/memory.ts";
import { upsertConversationTurn } from "../_shared/turns.ts";
import { processTurnProcess } from "../job-worker/processors/turn-process.ts";
import { executeTool } from "../whatsapp-handler/tools.ts";

type Suite = {
  id: string;
  name: string;
  messages: string[];
  expectedTools: string[];
};

const BUSINESS_ID = Deno.env.get("DEFAULT_BUSINESS_ID")!;

const SUITES: Suite[] = [
  {
    id: "suite_1",
    name: "Vague browse, cart build, revision, confirmation",
    expectedTools: ["search_menu", "add_to_cart", "edit_cart", "confirm_order"],
    messages: [
      "Hola, que tienes frio pero dulce?",
      "Algo con cafe pero no tan pesado.",
      "Va, dame un latte regular chico en las rocas con leche de coco.",
      "Tambien una galleta de leonor de chocochip.",
      "La chocolatechip.",
      "Mejor quita el latte, solo quiero la galleta.",
      "Y agregame un americano chico frio.",
      "Ese sin leche, porfa.",
      "Seria todo.",
      "Si, confirmo.",
    ],
  },
  {
    id: "suite_2",
    name: "Memory, preferences, repeat order, safe confirmation",
    expectedTools: [
      "get_recent_customer_orders",
      "search_menu",
      "add_to_cart",
      "reorder_last_order",
      "confirm_order",
    ],
    messages: [
      "Hola, soy el de siempre.",
      "Si, que fue lo ultimo que pedi?",
      "El ultimo, pero con leche de avena como me gusta.",
      "Antes dime si tienen algo dulce sin cafe.",
      "Mmm agregame una galleta de chispas tambien.",
      "Entonces seria lo de siempre mas la galleta?",
      "Si repite el ultimo y agrega la galleta.",
      "Ah pero no le pongas leche regular, me cae mal.",
      "Mejor no repitas, solo quiero un chai con avena.",
      "Grande caliente, confirmalo.",
    ],
  },
  {
    id: "suite_3",
    name: "Frustration, contact, cancellation, recovery",
    expectedTools: [
      "get_business_info",
      "cancel_order",
      "get_business_hours",
      "search_menu",
    ],
    messages: [
      "Por que no me contestas?",
      "Me perdiste, quiero hablar con alguien.",
      "Cual es el numero?",
      "Bueno, cancela mi orden.",
      "Porque ya se tardaron mucho.",
      "Y donde estan ubicados?",
      "A que hora cierran hoy?",
      "Tienen vacantes?",
      "Ok entonces mejor quiero hacer otra orden.",
      "Algo salado, monchoso.",
    ],
  },
  {
    id: "suite_4",
    name: "Hours, payment, complex cart corrections",
    expectedTools: [
      "get_business_hours",
      "get_business_info",
      "add_to_cart",
      "edit_cart",
      "search_menu",
      "confirm_order",
    ],
    messages: [
      "Esta abierto ahorita?",
      "Puedo pagar por transferencia?",
      "Perfecto, quiero un pumpkin matcha latte chico a las rocas con deslactosada.",
      "Y un brownie matcha caliente.",
      "No, mejor el brownie no.",
      "Agrega una limonada o algo sin cafe mejor.",
      "La limonada mineral.",
      "Grande si hay.",
      "Para recoger a nombre de Mariana.",
      "Confirmo.",
    ],
  },
  {
    id: "suite_5",
    name: "Ambiguous product, category confusion, typo recovery",
    expectedTools: ["search_menu", "add_to_cart", "edit_cart", "confirm_order"],
    messages: [
      "Quiero una galleta de la mesa de leonor.",
      "Cuales tienes?",
      "La de chocholatechip.",
      "Y tambien un late regular.",
      "Chico.",
      "En rocas con coco.",
      "No era coco, era avena.",
      "Ya quedo?",
      "Si.",
      "Me equivoque, todavia no.",
    ],
  },
  {
    id: "suite_6",
    name: "Cart editing — delete, swap, pronoun reference, clear and restart",
    expectedTools: ["add_to_cart", "edit_cart", "confirm_order"],
    messages: [
      // Add two items to build a cart
      "Quiero un americano chico frio.",
      "Y tambien una galleta chocolatechip.",
      // Pronoun-reference swap: "ese" = last added item (THE reported bug)
      "Quita ese y ponme una horchata fria mejor.",
      // Named item removal
      "No, mejor quita la horchata, solo quiero el americano.",
      // Swap by name
      "Cambia el americano por un latte regular chico.",
      // Re-add second item
      "Agregame la galleta de nuevo.",
      // Clear cart and restart (real pattern from messages.tsv)
      "Olvida todo eso, quiero empezar de nuevo.",
      // New item after clear
      "Dame un chai latte chico con leche de avena.",
      // Option correction on active item
      "Mejor con leche de coco, no de avena.",
      // Confirm
      "Va, confirmo.",
    ],
  },
  {
    id: "suite_7",
    name: "Product description and clarification — no accidental add_to_cart",
    // search_menu must be used for description queries; add_to_cart only after explicit order
    expectedTools: ["search_menu", "add_to_cart", "confirm_order"],
    messages: [
      // Ingredient/description query — extracted from messages.tsv real cases
      // Real: "que tiene la galleta Kenny?" / "que ingredientes tiene el pumpkin spice latte"
      "¿Que lleva el Rosa Latte? ¿Que ingredientes tiene?",
      // Real: "el matcha lleva cafe?" — botanical clarification, not ordering intent
      "¿El matcha tiene cafe o no?",
      // Real: "dime que variantes tienes de la mesa de leonor" — options browse, not add
      "¿Que variantes tiene La Mesa de Leonor?",
      // Obscure product — bot should be honest about limited description info
      // Real: bot replied "Honestamente, no tengo los detalles exactos de qué lleva la Empanada Marul"
      "¿Que es la empanada marul, de que esta hecha?",
      // After getting info, user explicitly decides to order
      "Ok, entendi. Dame un Matchata chico caliente.",
      // Confirm
      "Si, confirmo.",
    ],
  },
];

const KNOWN_TOOL_NAMES = new Set([
  "get_business_info",
  "get_business_hours",
  "search_menu",
  "search_products",
  "add_to_cart",
  "edit_cart",
  "confirm_order",
  "confirm_order_changes",
  "cancel_order",
  "get_recent_customer_orders",
  "reorder_last_order",
]);

function pickSuites(id: string | null): Suite[] {
  if (!id || id === "all") return SUITES;
  const suite = SUITES.find((item) => item.id === id);
  if (!suite) throw new Error(`Unknown suite: ${id}`);
  return [suite];
}

async function createSignoffConversation(
  supabase: any,
  runId: string,
  suite: Suite,
) {
  const phone = `+1555${
    runId.replace(/[^0-9]/g, "").slice(-6).padStart(6, "0")
  }${suite.id.replace(/\D/g, "")}`;
  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .insert({
      business_id: BUSINESS_ID,
      phone,
      name: `SIGNOFF ${suite.id}`,
    })
    .select()
    .single();
  if (customerError || !customer) {
    throw new Error(
      `create signoff customer failed: ${customerError?.message}`,
    );
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("conversations")
    .insert({
      business_id: BUSINESS_ID,
      customer_id: customer.id,
      status: "active",
      current_state: "initial",
      state_version: 0,
      draft_cart_version: 0,
      state_data: { signoff_run_id: runId, suite_id: suite.id },
    })
    .select()
    .single();
  if (conversationError || !conversation) {
    throw new Error(
      `create signoff conversation failed: ${conversationError?.message}`,
    );
  }

  return { customer, conversation };
}

async function seedSuiteMemoryAndOrders(
  supabase: any,
  suite: Suite,
  customerId: string,
) {
  if (suite.id !== "suite_2") return;

  await supabase.from("transactions").insert({
    id: crypto.randomUUID(),
    business_id: BUSINESS_ID,
    customer_id: customerId,
    transaction_type: "order",
    status: "completed",
    total_amount: 85,
    details: {
      signoff_seed: true,
      customer_note: "prefiere leche de avena",
      items: [
        {
          product_id: "signoff-cappuccino",
          product_name: "Capuccino",
          variant_name: "GDE, avena",
          quantity: 1,
          unit_price: 85,
        },
      ],
    },
  });

  await supabase.from("customer_preferences").upsert({
    business_id: BUSINESS_ID,
    customer_id: customerId,
    facts: {
      preferences: ["leche de avena"],
      dislikes: ["leche regular"],
      typical_order: "Capuccino grande con leche de avena",
      allergies: [],
      notes: "Cliente de sign-off para repetir pedido previo.",
    },
  }, { onConflict: "business_id,customer_id" });
}

function riskManagedExecuteTool(
  capturedSideEffects: unknown[],
  suite: Suite,
): typeof executeTool {
  return async (supabase, name, input, ctx) => {
    if (suite.id === "suite_2" && name === "get_recent_customer_orders") {
      return {
        success: true,
        found: 1,
        orders: [
          {
            id: `signoff-history-${suite.id}`,
            status: "completed",
            created_at: new Date(Date.now() - 86400000).toISOString(),
            total: 85,
            items: [
              {
                product_name: "Capuccino",
                quantity: 1,
                variant_name: "GDE, avena",
                unit_price: 85,
              },
            ],
            customer_note: "prefiere leche de avena",
          },
        ],
        message: "Encontré 1 pedido reciente del cliente.",
      };
    }

    if (
      [
        "confirm_order",
        "confirm_order_changes",
        "cancel_order",
        "reorder_last_order",
      ].includes(name)
    ) {
      capturedSideEffects.push({ name, input });
      return {
        success: true,
        signoff_intercepted: true,
        order_id: `signoff-${crypto.randomUUID()}`,
        customer_reply:
          `[SIGNOFF] ${name} fue interceptada: no se creó/canceló una orden real.`,
        message:
          `[SIGNOFF] ${name} intercepted to avoid irreversible production side effects.`,
      };
    }
    return executeTool(supabase, name, input, ctx);
  };
}

async function runSuite(supabase: any, runId: string, suite: Suite) {
  const { customer, conversation } = await createSignoffConversation(
    supabase,
    runId,
    suite,
  );
  await seedSuiteMemoryAndOrders(supabase, suite, customer.id);
  const outboxRows: unknown[] = [];
  const backgroundJobs: unknown[] = [];
  const interceptedSideEffects: unknown[] = [];
  const turns: unknown[] = [];

  for (let index = 0; index < suite.messages.length; index++) {
    const text = suite.messages[index];
    const userMessageId = await insertMessage(
      conversation.id,
      "user",
      text,
      supabase,
      `signoff:${runId}:${suite.id}:${index}`,
    );
    const { data: currentConversation } = await supabase
      .from("conversations")
      .select("state_version")
      .eq("id", conversation.id)
      .single();
    const now = new Date().toISOString();
    const turn = await upsertConversationTurn(supabase, {
      conversationId: conversation.id,
      customerId: customer.id,
      businessId: BUSINESS_ID,
      status: "released",
      sourceMessageIds: [String(userMessageId)],
      mergedUserText: text,
      integrityDecision: "release",
      integrityReason: "signoff_suite_turn",
      baseStateVersion: currentConversation?.state_version ?? 0,
      firstMessageAt: now,
      lastMessageAt: now,
      releasedAt: now,
    });

    await processTurnProcess(supabase, {
      conversation_id: conversation.id,
      customer_id: customer.id,
      business_id: BUSINESS_ID,
      turn_id: turn.id,
      request_id: `signoff:${runId}:${suite.id}:${index}`,
    }, {
      executeToolFn: riskManagedExecuteTool(interceptedSideEffects, suite),
      insertOutboxFn: async (_client, params) => {
        outboxRows.push(params);
        return `signoff-outbox-${crypto.randomUUID()}`;
      },
      insertJobFn: async (_client, params) => {
        backgroundJobs.push(params);
        return `signoff-job-${crypto.randomUUID()}`;
      },
      triggerJobWorkerFn: async () => {},
    });

    const { data: completedTurn } = await supabase
      .from("conversation_turns")
      .select("id, status, reconciled_action, assistant_message_id")
      .eq("id", turn.id)
      .single();
    const { data: assistantMessage } = completedTurn?.assistant_message_id
      ? await supabase
        .from("messages")
        .select("content")
        .eq("id", completedTurn.assistant_message_id)
        .single()
      : { data: null };

    turns.push({
      index,
      user: text,
      status: completedTurn?.status ?? null,
      assistant: assistantMessage?.content ?? null,
      tool_chain: completedTurn?.reconciled_action?.tool_chain ?? [],
      stop_reason: completedTurn?.reconciled_action?.stop_reason ?? null,
    });
  }

  const usedTools = new Set<string>();
  for (const turn of turns as any[]) {
    const chain = Array.isArray(turn.tool_chain) ? turn.tool_chain : [];
    for (const item of chain) {
      if (item?.name) usedTools.add(item.name);
    }
    if (
      !Array.isArray(turn.tool_chain) &&
      typeof turn.tool_chain?.excerpt === "string"
    ) {
      for (
        const match of turn.tool_chain.excerpt.matchAll(/"name":"([^"]+)"/g)
      ) {
        if (KNOWN_TOOL_NAMES.has(match[1])) usedTools.add(match[1]);
      }
    }
  }

  return {
    suite_id: suite.id,
    suite_name: suite.name,
    conversation_id: conversation.id,
    customer_id: customer.id,
    expected_tools: suite.expectedTools,
    used_tools: [...usedTools],
    missing_expected_tools: suite.expectedTools.filter((tool) =>
      !usedTools.has(tool)
    ),
    outbox_rows_captured: outboxRows.length,
    background_jobs_captured: backgroundJobs.length,
    irreversible_tools_intercepted: interceptedSideEffects,
    turns,
  };
}

Deno.serve(async (req) => {
  try {
    const configuredToken = Deno.env.get("SIGNOFF_RUNNER_TOKEN") ?? "";
    const providedToken = req.headers.get("x-signoff-token") ?? "";
    if (!configuredToken || providedToken !== configuredToken) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    if (!BUSINESS_ID) {
      throw new Error("DEFAULT_BUSINESS_ID is required");
    }

    const url = new URL(req.url);
    const suiteId = url.searchParams.get("suite");
    const runId = url.searchParams.get("run_id") ??
      `signoff-${
        new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
      }`;
    const supabase = getSupabaseClient();
    const selectedSuites = pickSuites(suiteId);
    const results = [];
    for (const suite of selectedSuites) {
      results.push(await runSuite(supabase, runId, suite));
    }
    return Response.json({ run_id: runId, results });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }, { status: 500 });
  }
});
