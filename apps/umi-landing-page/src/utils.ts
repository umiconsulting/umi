import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

// Función para combinar clases de Tailwind de manera eficiente
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Función para formateo de fechas
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
