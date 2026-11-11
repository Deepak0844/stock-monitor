import { describe, expect, it } from "vitest";
import { takePicture } from "./capture.js";

// A stand-in page: only what takePicture uses. Sizes are what a long, photo-heavy product page gives.
const pageGiving = (sizes: { fullPng: number; fullJpeg: number; visiblePng: number }) => ({
  screenshot: async ({ type, fullPage }: { type: "png" | "jpeg"; fullPage: boolean }) => {
    const size = !fullPage ? sizes.visiblePng : type === "jpeg" ? sizes.fullJpeg : sizes.fullPng;
    return Buffer.alloc(size, type === "jpeg" ? 0xd8 : 0x50);
  },
});

describe("takePicture", () => {
  it("keeps the whole page as a PNG when it fits", async () => {
    const picture = await takePicture(pageGiving({ fullPng: 600_000, fullJpeg: 200_000, visiblePng: 100_000 }) as never);
    expect(Buffer.from(picture as string, "base64")).toHaveLength(600_000);
  });

  it("keeps the whole page as a JPEG when the PNG is too big, rather than only the visible part", async () => {
    const picture = await takePicture(pageGiving({ fullPng: 3_000_000, fullJpeg: 400_000, visiblePng: 100_000 }) as never);
    expect(Buffer.from(picture as string, "base64")).toHaveLength(400_000);
  });

  it("falls back to the visible part when even the JPEG is too big", async () => {
    const picture = await takePicture(pageGiving({ fullPng: 9_000_000, fullJpeg: 2_000_000, visiblePng: 100_000 }) as never);
    expect(Buffer.from(picture as string, "base64")).toHaveLength(100_000);
  });
});
