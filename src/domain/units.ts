/** Weight display helpers. Stored weights and volumes are always kilograms. */

import type { WeightUnit } from './types';

export const KG_PER_LB = 0.45359237;
export const DISPLAY_MAX_KG = 1000;
const displayFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export function weightUnitLabel(unit: WeightUnit): string {
  return unit;
}

export function weightForDisplay(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kg / KG_PER_LB : kg;
}

export function weightToKg(value: number, unit: WeightUnit): number {
  return unit === 'lb' ? value * KG_PER_LB : value;
}

export function displayMaxWeight(unit: WeightUnit): number {
  return unit === 'lb'
    ? Math.round((DISPLAY_MAX_KG / KG_PER_LB) * 100) / 100
    : DISPLAY_MAX_KG;
}

export function formatWeight(kg: number, unit: WeightUnit, digits = 1): string {
  const value = weightForDisplay(kg, unit);
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  }).format(value);
}

export function formatVolume(kg: number, unit: WeightUnit): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(weightForDisplay(kg, unit));
}

export function formatWeightInput(kg: number, unit: WeightUnit): string {
  return String(Math.round(weightForDisplay(kg, unit) * 100) / 100);
}

export function formatBodyWeight(kg: number, unit: WeightUnit): string {
  return `${displayFormat.format(Math.round(weightForDisplay(kg, unit) * 10) / 10)} ${unit}`;
}
