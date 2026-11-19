// Run by settle.browser.test.ts under tsx, the way the container runs the service. A page whose content fades in after it loads.
import { chromium } from "playwright";
import { waitUntilShown } from "../src/settle.js";

const FADES_IN = '<div id="wrap" style="opacity:0;transition:opacity 200ms"><h1>Blue widget</h1><p>In stock</p></div><script>setTimeout(()=>{document.getElementById("wrap").style.opacity="1"},700)</script>';
const NEVER = '<div style="opacity:0"><h1>Blue widget</h1></div>';
const PLAIN = "<h1>Blue widget</h1><p>In stock</p>";
const NO_HEADING = '<div style="opacity:0"><p>No heading here</p></div>';

const effective = () =>
  document.querySelector("h1") ? [...[document.querySelector("h1") as Element].flatMap((h) => { const o: number[] = []; for (let e: Element | null = h; e; e = e.parentElement) o.push(Number(getComputedStyle(e).opacity)); return o; })].reduce((a, b) => a * b, 1) : -1;

const browser = await chromium.launch({ args: process.env.CI ? ["--no-sandbox"] : [] });
try {
  const out: Record<string, unknown> = {};
  for (const [name, html] of Object.entries({ FADES_IN, NEVER, PLAIN, NO_HEADING })) {
    const page = await browser.newPage();
    await page.setContent(html);
    const before = await page.evaluate(effective);
    const start = Date.now();
    const settled = await waitUntilShown(page, name === "NEVER" ? 600 : 4000);
    out[name] = { before, after: await page.evaluate(effective), settled, ms: Date.now() - start };
    await page.close();
  }
  console.log(JSON.stringify(out));
} finally {
  await browser.close();
}
