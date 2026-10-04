/** Model replies sometimes punctuate a bare "no drift" answer. */
export function isNoDrift(value: string): boolean {
  return /^(?:无|没有|none|no(?:ne)? drift(?:s)?)[。.!！；;\s]*$/i.test(value.trim());
}
