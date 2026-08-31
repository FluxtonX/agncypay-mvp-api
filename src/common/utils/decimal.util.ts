import { Prisma } from '@prisma/client';

/**
 * Standardized Fintech Decimal Math Utility
 * Wraps Prisma.Decimal (Decimal.js) to guarantee 4-decimal-place precision
 * without JavaScript floating-point binary inaccuracies.
 */

export type DecimalValue = Prisma.Decimal | number | string;

export function toDecimal(value: DecimalValue | null | undefined, defaultValue = 0): Prisma.Decimal {
  if (value === null || value === undefined) {
    return new Prisma.Decimal(defaultValue);
  }
  if (value instanceof Prisma.Decimal) {
    return value;
  }
  return new Prisma.Decimal(value);
}

export function toNumber(value: DecimalValue | null | undefined, defaultValue = 0): number {
  if (value === null || value === undefined) {
    return defaultValue;
  }
  if (typeof value === 'number') {
    return value;
  }
  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }
  const parsed = parseFloat(String(value));
  return isNaN(parsed) ? defaultValue : parsed;
}

export function centsToDecimal(cents: number): Prisma.Decimal {
  return new Prisma.Decimal(cents).dividedBy(100);
}

export function decimalToCents(decimal: DecimalValue): number {
  const d = toDecimal(decimal);
  return d.times(100).round().toNumber();
}

export function addDecimals(a: DecimalValue, b: DecimalValue): Prisma.Decimal {
  return toDecimal(a).plus(toDecimal(b));
}

export function subDecimals(a: DecimalValue, b: DecimalValue): Prisma.Decimal {
  return toDecimal(a).minus(toDecimal(b));
}

export function mulDecimals(a: DecimalValue, b: DecimalValue): Prisma.Decimal {
  return toDecimal(a).times(toDecimal(b));
}

export function divDecimals(a: DecimalValue, b: DecimalValue): Prisma.Decimal {
  const divisor = toDecimal(b);
  if (divisor.isZero()) {
    throw new Error('Division by zero in decimal math operation');
  }
  return toDecimal(a).dividedBy(divisor);
}

export function isEqualDecimal(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).equals(toDecimal(b));
}

export function isGreaterThanDecimal(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).greaterThan(toDecimal(b));
}

export function isLessThanDecimal(a: DecimalValue, b: DecimalValue): boolean {
  return toDecimal(a).lessThan(toDecimal(b));
}
