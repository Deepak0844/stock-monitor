// The fake store's products, shared by the stack and the tests so expected numbers are computed, not typed.
import { LOC_A, LOC_B, makeVariant, type FakeVariant } from "../packages/shopify/test/testing.js";

export { LOC_A, LOC_B };
export const LOCATIONS = [
  { id: LOC_A, name: "Shop floor", isActive: true },
  { id: LOC_B, name: "Back room", isActive: true },
  { id: "gid://shopify/Location/3", name: "Closed depot", isActive: false },
];

const NAMES = ["Garden Gloves", "Hose Reel", "Watering Can", "Plant Pot"];
const TOTAL = 60;

export const VARIANTS: FakeVariant[] = Array.from({ length: TOTAL }, (_, i) => {
  const n = i + 1;
  return makeVariant(n, {
    productTitle: `${NAMES[i % NAMES.length]} ${Math.floor(i / NAMES.length) + 1}`,
    title: n === 5 ? "Default Title" : `${["Small", "Medium", "Large"][i % 3]} / ${["Green", "Blue"][i % 2]}`,
    sku: n % 17 === 0 ? null : `SKU-${String(n).padStart(4, "0")}`,
    tracked: n % 9 !== 0, // not tracked: a warning
    policy: n % 13 === 0 ? "CONTINUE" : "DENY", // keeps selling at 0: a warning
    stock: n % 11 === 0 ? { [LOC_B]: 20 } : { [LOC_A]: n % 7 === 0 ? 0 : n % 40 }, // every 11th is not stocked at LOC_A
  });
});

const needsAttention = (v: FakeVariant) => !v.tracked || v.policy === "CONTINUE";

export const COUNTS = {
  total: TOTAL,
  needsAttention: VARIANTS.filter(needsAttention).length,
  notStockedAtShopFloor: VARIANTS.filter((v) => v.stock[LOC_A] === undefined).length,
  hose: VARIANTS.filter((v) => v.productTitle.toLowerCase().includes("hose")).length,
  pageSize: 25,
};
