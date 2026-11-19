/** Pages for the cookie banner tests. `cookiebot` is laid out like the real Cookiebot dialog from a supplier capture. */
const product = '<h1>Blue widget</h1><p>In stock</p><button>Add to cart</button>';
const banner = (attrs: string, button: string) =>
  `<div ${attrs} style="position:fixed;top:60px;left:100px;width:480px;background:#fff;z-index:9999"><h2>This website uses cookies</h2><p>We use cookies to personalise content and ads, and to analyse our traffic.</p><label>Necessary</label><label>Preferences</label><label>Statistics</label><label>Marketing</label><a href="#">Show details</a><button>${button}</button></div>`;

export const PAGES = {
  cookiebot: product + banner('id="CybotCookiebotDialog" role="dialog" aria-modal="true"', "OK"),
  /** A banner from a tool the list does not know, found by what it is: fixed, talks about cookies, has a button. */
  unknown: product + banner('class="x7f3"', "Accept all"),
  /** A shop that sells cookies. Nothing here is a banner. */
  cookieShop: '<h1>Chocolate cookies</h1><p>A box of 12 cookies</p><button>Add to cart</button>',
  /** A fixed panel that is not about cookies. */
  cartDrawer: product + '<div style="position:fixed;right:0;top:0;width:300px;background:#fff"><h2>Your basket</h2><button>Checkout</button></div>',
};
