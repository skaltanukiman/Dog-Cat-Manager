import type { PetRecordType } from "@prisma/client";

/**
 * Keeps every Record surface on the same semantic color scale. Class names are
 * static so Tailwind can generate them without depending on runtime values.
 */
export const petRecordTypeStyles = {
  HEALTH: {
    card: "border-l-record-health",
    marker: "bg-record-health",
    badge: "bg-record-health-soft text-record-health ring-record-health/25"
  },
  MEDICAL: {
    card: "border-l-record-medical",
    marker: "bg-record-medical",
    badge: "bg-record-medical-soft text-record-medical ring-record-medical/25"
  },
  MEDICATION: {
    card: "border-l-record-medication",
    marker: "bg-record-medication",
    badge: "bg-record-medication-soft text-record-medication ring-record-medication/25"
  },
  VACCINATION: {
    card: "border-l-record-vaccination",
    marker: "bg-record-vaccination",
    badge: "bg-record-vaccination-soft text-record-vaccination ring-record-vaccination/25"
  },
  MEMORY: {
    card: "border-l-record-memory",
    marker: "bg-record-memory",
    badge: "bg-record-memory-soft text-record-memory ring-record-memory/25"
  }
} satisfies Record<PetRecordType, { card: string; marker: string; badge: string }>;

export const petRecordCreateKindStyles = {
  health: {
    selected: "border-record-health/30 bg-record-health-soft text-record-health",
    unselected: "border-slate-200 bg-white text-slate-700 hover:border-record-health/40 hover:bg-record-health-soft hover:text-record-health"
  },
  medical: {
    selected: "border-record-medical/30 bg-record-medical-soft text-record-medical",
    unselected: "border-slate-200 bg-white text-slate-700 hover:border-record-medical/40 hover:bg-record-medical-soft hover:text-record-medical"
  },
  medication: {
    selected: "border-record-medication/30 bg-record-medication-soft text-record-medication",
    unselected: "border-slate-200 bg-white text-slate-700 hover:border-record-medication/40 hover:bg-record-medication-soft hover:text-record-medication"
  },
  vaccination: {
    selected: "border-record-vaccination/30 bg-record-vaccination-soft text-record-vaccination",
    unselected: "border-slate-200 bg-white text-slate-700 hover:border-record-vaccination/40 hover:bg-record-vaccination-soft hover:text-record-vaccination"
  },
  memory: {
    selected: "border-record-memory/30 bg-record-memory-soft text-record-memory",
    unselected: "border-slate-200 bg-white text-slate-700 hover:border-record-memory/40 hover:bg-record-memory-soft hover:text-record-memory"
  }
} satisfies Record<string, { selected: string; unselected: string }>;
