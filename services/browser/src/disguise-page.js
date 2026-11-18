// Runs in every frame of a stealth live login window, before the page's own scripts (see disguise.ts). `FULL`, the brand
// list of real Google Chrome of this version, is written above this line when the extension is made.
// It reports a real graphics card instead of SwiftShader, and Google Chrome's brands instead of Chromium's only.
// Everything else stays true. Each replaced function prints as native code, like the one it replaces.
/* global FULL */
(() => {
  const VENDOR = "Google Inc. (Intel)";
  const RENDERER = "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)";
  const UNMASKED_VENDOR = 37445;
  const UNMASKED_RENDERER = 37446;

  const native = new WeakMap();
  const toString = new Proxy(Function.prototype.toString, {
    apply: (real, self, args) => (native.has(self) ? native.get(self) : Reflect.apply(real, self, args)),
  });
  native.set(toString, "function toString() { [native code] }");
  Function.prototype.toString = toString;
  const fake = (real, apply, name) => {
    const proxy = new Proxy(real, { apply });
    native.set(proxy, `function ${name}() { [native code] }`);
    return proxy;
  };

  for (const context of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
    if (!context) continue;
    context.prototype.getParameter = fake(
      context.prototype.getParameter,
      (real, self, args) =>
        args[0] === UNMASKED_VENDOR ? VENDOR : args[0] === UNMASKED_RENDERER ? RENDERER : Reflect.apply(real, self, args),
      "getParameter",
    );
  }

  const ua = globalThis.NavigatorUAData?.prototype;
  if (!ua) return;
  const majorOnly = () => FULL.map((b) => ({ brand: b.brand, version: b.version.split(".")[0] }));
  const brands = Object.getOwnPropertyDescriptor(ua, "brands");
  Object.defineProperty(ua, "brands", { ...brands, get: fake(brands.get, () => majorOnly(), "get brands") });
  ua.toJSON = fake(ua.toJSON, (real, self, args) => ({ ...Reflect.apply(real, self, args), brands: majorOnly() }), "toJSON");
  ua.getHighEntropyValues = fake(
    ua.getHighEntropyValues,
    async (real, self, args) => {
      const values = await Reflect.apply(real, self, args);
      if (values.brands) values.brands = majorOnly();
      if (values.fullVersionList) values.fullVersionList = FULL.map((b) => ({ ...b }));
      return values;
    },
    "getHighEntropyValues",
  );
})();
