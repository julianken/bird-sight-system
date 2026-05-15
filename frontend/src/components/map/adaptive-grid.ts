export type PositiveInt = number & { readonly __brand: 'PositiveInt' };

export function toPositiveInt(n: number): PositiveInt {
  if (!Number.isInteger(n) || n < 1) {
    throw new TypeError(`Expected a positive integer, got ${n}. Value must be a positive integer.`);
  }
  return n as PositiveInt;
}
