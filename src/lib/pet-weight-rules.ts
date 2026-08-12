export const PET_WEIGHT_INCREMENT_KG = 0.01;
export const MAX_PET_WEIGHT_KG = 999.99;
export const PET_WEIGHT_MEMO_MAX_LENGTH = 500;

export function isPetWeightInHundredths(weightKg: number) {
  const scaled = weightKg / PET_WEIGHT_INCREMENT_KG;
  return Number.isFinite(scaled) && Math.abs(scaled - Math.round(scaled)) < 1e-9;
}
