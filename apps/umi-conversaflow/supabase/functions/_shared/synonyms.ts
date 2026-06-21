export const SIZE_SYNONYMS: Record<string, "CH" | "GDE"> = {
  ch: "CH",
  chico: "CH",
  chica: "CH",
  pequena: "CH",
  pequeno: "CH",
  pequeño: "CH",
  gde: "GDE",
  grande: "GDE",
};

export const TEMP_SYNONYMS: Record<string, "CALIENTE" | "ROCAS" | "FRAPPE"> = {
  caliente: "CALIENTE",
  frio: "ROCAS",
  cold: "ROCAS",
  iced: "ROCAS",
  fria: "ROCAS",
  fría: "ROCAS",
  helado: "ROCAS",
  hielo: "ROCAS",
  rocas: "ROCAS",
  frappe: "FRAPPE",
  frappé: "FRAPPE",
  frappes: "FRAPPE",
};

export const MILK_SYNONYMS: Record<
  string,
  "DESLACTOSADA" | "ALMENDRA" | "COCO" | "AVENA" | "SOYA"
> = {
  deslactosada: "DESLACTOSADA",
  deslactosado: "DESLACTOSADA",
  coco: "COCO",
  almendra: "ALMENDRA",
  soya: "SOYA",
  soja: "SOYA",
  avena: "AVENA",
};

export function normalizeSynonymText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}
