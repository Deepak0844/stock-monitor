// Booker product page scripts as the owner copied them (2026-11-21), trimmed: no nonce, no ephemeral key, fewer fields.
const bookerScript = (id: string, name: string, availability: string) => `
    import { h, render, Container, ProductDetailHero } from 'bundle';

    const args = {
        ...{"images":["https://media.booker.co.uk/bbimages/1/${id}.jpg"],"details":{"id":"${id}","name":"${name}","tags":[],"servings":["Case of 12"],"variant":"pdp"},"id":"${id}","sucode":${id},"categoryID":"300654","standardPricing":{"price":"£13.69","pricewithvat":"£16.43","offer":null},"showaddtotrolley":true,"vat":"20%","availability":${availability},"rtsPostcode":"LS12 6HU","productid":"${id}","loggedout":true,"quantity":0},
        onclick: () => ({ image: 'https://media.booker.co.uk/bbimages/1/${id}.jpg', availablebranches: {branches: []} })
    };

    const productDetailHero = document.getElementById("productDetailHero_01390dc6b3534e2d8a8b23c33083e5c8");
    render(h(Container, { spacing: "none" }, h(ProductDetailHero, args)), productDetailHero);

    window.renderedContentOp = {"products":[{"id":"${id}","name":"${name}","price":13.69,"quantity":1,"variant":"","availability":""}]};
`;

export const BOOKER_IN_STOCK = bookerScript(
  "303983",
  "Monster Energy Drink Lando Norris Zero Sugar 500ml Can",
  `{"status":"inStock","outofstocknotice":"","alternativeurl":false,"alternativelabel":null,"supressbranchlink":true,"stockEnabled":true,"isTnaProduct":false,"realtimeStockMappedStatus":"In Stock"}`,
);
export const BOOKER_OUT_OF_STOCK = bookerScript(
  "302148",
  "Coca-Cola Lime 500ml PM £1.79",
  `{"status":"outOfStock","outofstocknotice":"Product no longer available.","alternativeurl":false,"alternativelabel":"View Alternative Products","supressbranchlink":true,"stockEnabled":true,"isTnaProduct":false,"realtimeStockMappedStatus":null}`,
);
