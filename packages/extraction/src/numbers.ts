/** The first whole number in some text: 46, 1,204 (1204), 12+ (12), "Only 3 left" (3). null when there is none. */
export function readNumber(text: string): number | null {
  const found = /\d[\d,]*/.exec(text);
  return found ? Number(found[0].replace(/,/g, "")) : null;
}
