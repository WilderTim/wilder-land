# Wilder Land — Shopify theme (D2C + Zakelijk)

One custom **Shopify Online Store 2.0 theme** for both stores. It is built pixel-for-pixel from the Figma design:

- **wilder-land.com** (consumers)
- **zakelijk.wilder-land.com** (B2B)

Shopify is the back office for everything: products, prices, stock, checkout, payments, customers, blogs, menus and discounts. This repo is only the "skin" (the interface).

```
assets/      CSS, JS, self-hosted fonts, demo placeholder images (wl-*.jpg)
config/      theme settings (colours, store mode, B2B rules)
layout/      page shell (theme.liquid)
locales/     Dutch (default) + English texts
sections/    every homepage block from Figma + product / collection / cart / blog pages
snippets/    product card, price (with B2B rules), responsive image
templates/   which sections appear on which page type
demo/ + scripts/ + vercel.json   static demo build for Vercel (not uploaded to Shopify)
```

---

## 1. The demo on Vercel

`npm run build:demo` renders **this exact theme code** into static HTML in `dist/`. It uses the snapshot in `demo/data.json`.

One product is live: **Holy Smokey Part II – 75CL** (`copy-of-onkruidenthee-kombucha-75-cl`) from the Zakelijk store. On the demo it works like this:

- **Price and availability** load live from Shopify's public Storefront API. No token is needed and nothing is written to the store.
- **"In winkelwagen"** creates a real Shopify cart.
- **"Afrekenen"** opens the real Shopify checkout on `zakelijk.wilder-land.com`.
- If the API is unreachable, the button falls back to a Shopify cart link (`/cart/<variant>:<qty>`), which also lands in checkout.

> ⚠️ This is the real checkout of the live B2B store. Don't complete a payment unless you want a real order (or cancel/refund it afterwards).

**Deploy (one-time, about 1 minute):**
1. Go to vercel.com → **Add New… → Project** → import the GitHub repo `WilderTim/wilder-land`.
2. Pick the branch and leave all settings as they are. `vercel.json` already sets the build command (`npm run build:demo`) and output directory (`dist`).
3. Click **Deploy**. Every push after that creates a new preview URL automatically.

The other three product cards and all editorial images are placeholders cropped from the Figma export. On Shopify you replace them in the theme editor.

---

## 2. Putting the theme on Shopify (when you're ready)

Use Shopify's **GitHub integration**. Your current B2B theme (`Wilderland-B2B/master`) already works this way.

1. Shopify admin → **Online Store → Themes → Add theme → Connect from GitHub** → pick this repo and branch.
2. The theme is added **unpublished**. Preview it, then fill in images and texts in the theme editor.
3. Publish when happy.

**Recommended branch setup for two stores:** keep a separate branch per store, for example `store/d2c` and `store/b2b`. Both are merged from `main`. This matters because Shopify commits the theme-editor content (`templates/*.json`, `config/settings_data.json`) back to the connected branch. Separate branches keep the two stores' content from overwriting each other, while code changes flow to both.

> ⚠️ The Zakelijk store currently has **20 of 20 themes** (Shopify's maximum). Most are old backups, so delete a few before connecting a new one.

**Store mode:** Theme settings → **Winkel** → *Type winkel* = Consument / Zakelijk. In Zakelijk mode:
- Prices and ordering are only visible to logged-in customers who have the customer tag set in the settings (default `zakelijk`).
- Everyone else sees "Log in voor prijzen" and a request-account form.
- New sign-ups get the tag `aanvraag`. You approve them in **Klanten** by adding the tag `zakelijk`.

---

## 3. What the team manages in Shopify (no code)

| Want to… | Where in Shopify |
|---|---|
| Add a product, price, stock, photos | Producten |
| Card text line 1 ("Gerookte (on)kruidenthee") | Product → metafield `custom.subtitle` (create it once under Settings → Custom data). Falls back to *product type*. |
| Badge on a product card ("Nieuw", "Limited") | Add product tag `label:Nieuw` |
| Collections that fill themselves | Collection → *Smart* → condition "product tag is …" |
| Filters on collection pages (by tag, type, price) | Free **Search & Discovery** app → Filters |
| Homepage: images, texts, order of blocks, add/remove sections | Online Store → Themes → **Customize** |
| Menus in header/footer | Online Store → Navigation (`main-menu`, `ontdek`, `klantenservice`, `meer-over-wilder-land`, `footer-bottom`) |
| Blog posts / Collabs | Online Store → Blog posts. Create a blog "Collabs" and select it in the *Collabs* section. Article **tags** show as the ingredient list. |
| Discount codes, shipping, taxes, iDEAL/Apple Pay | Discounts / Settings |
| B2B customer access | Klanten → tag `zakelijk` |

Storefront UX built in: sticky header (transparent over the hero, solid on scroll), mobile menu, slide-in cart with quantity controls, quick "add to cart" on single-variant product cards, product accordions (*Uitklapbare tekst* blocks), breadcrumbs, and a newsletter sign-up in the footer. Layout sits in a centred container (Theme settings → Layout → *Maximale paginabreedte*, default 1440px), so it stays compact on big screens.

Every homepage section from Figma is a reusable section with presets: Hero, Productrij, Statement, Twee afbeeldingen, Ingrediënten, Afbeelding met tekst, Lopende tekst, Drie afbeeldingen, Collabs, Grote slogan, Apps. The team can add them to any page.

---

## 4. Tags, analytics and third parties

Don't paste tracking scripts into the theme. Shopify's own systems cover this, and they also track checkout, which a theme can't reach:

- **Google Analytics 4 / Google Ads / Merchant Center:** *Google & YouTube* app.
- **Meta, TikTok, Pinterest:** their official Shopify apps (server-side conversions included).
- **Google Tag Manager or any other tag:** Settings → **Customer events** → *Add custom pixel*. It runs sandboxed and respects consent.
- **Cookie consent (AVG/GDPR):** Settings → Customer privacy → cookie banner. Pixels only fire after consent.
- **Email / reviews / loyalty (Klaviyo, Judge.me, …):** install the app. Its widgets appear as *app blocks*: add an "Apps" section anywhere, or add the block inside the product section.
- **ERP / accounting / warehouse:** connect to Shopify itself (apps or the Admin API), never to the theme.

`{{ content_for_header }}` in `layout/theme.liquid` is where Shopify injects all of the above. Don't remove it.

---

## 5. Developing

```bash
npm install
npm run build:demo        # static demo → dist/
npx @shopify/cli theme dev --store wilder-land-b2b.myshopify.com   # live preview against real store data (read-only, needs login)
npx @shopify/cli theme check                                      # lint (currently 0 issues)
```

Fonts are self-hosted from `/assets` (Instrument Serif, IBM Plex Mono and IBM Plex Sans, all OFL licensed), so no Google Fonts request goes out, which is good for GDPR. If you have licensed brand fonts, replace the `.woff2` files and keep the file names.
