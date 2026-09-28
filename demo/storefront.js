/**
 * Demo-only: connects the static Vercel preview to the real Shopify store through the
 * public Storefront API (tokenless access — no secret, nothing is written to the store
 * except a shopping cart when a visitor clicks "In winkelwagen").
 *
 * - Product page: fetches the live price/availability for the product.
 * - Add to cart:  creates / updates a Shopify cart and keeps its id in localStorage.
 * - Cart page:    renders the Shopify cart and sends the visitor to Shopify Checkout.
 * - Fallback:     if the API is unreachable, "add to cart" uses a Shopify cart permalink
 *                 (https://<store>/cart/<variant-id>:<qty>), which also ends in checkout.
 *
 * This file is NOT part of the Shopify theme; on Shopify the theme uses native /cart routes.
 */
(() => {
  const cfg = window.WL_DEMO;
  if (!cfg) return;
  const ENDPOINT = `https://${cfg.domain}/api/${cfg.apiVersion}/graphql.json`;
  const CART_KEY = 'wl-demo-cart-id';
  const ctx = { country: cfg.country, language: cfg.language };

  const CART_FIELDS = `fragment CartFields on Cart { id checkoutUrl totalQuantity cost { subtotalAmount { amount currencyCode } } lines(first: 50) { nodes { id quantity cost { totalAmount { amount currencyCode } } merchandise { ... on ProductVariant { id title price { amount currencyCode } image { url altText } product { title handle } } } } } }`;

  const gql = async (query, variables = {}) => {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!res.ok) throw new Error(`Shopify ${res.status}`);
    const json = await res.json();
    if (json.errors?.length) throw new Error(json.errors[0].message);
    return json.data;
  };

  const money = ({ amount, currencyCode }) =>
    new Intl.NumberFormat('nl-NL', { style: 'currency', currency: currencyCode }).format(Number(amount));
  const gid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/ProductVariant/${id}`);
  const numericId = (id) => String(id).split('/').pop();
  const storage = {
    get: () => { try { return localStorage.getItem(CART_KEY); } catch { return null; } },
    set: (v) => { try { v ? localStorage.setItem(CART_KEY, v) : localStorage.removeItem(CART_KEY); } catch { /* private mode */ } },
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const setCount = (n) => {
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = n;
      el.closest('.cart-count')?.setAttribute('data-count', n);
    });
  };

  const toast = (text, href, linkText) => {
    const el = document.getElementById('CartToast');
    if (!el) return;
    el.querySelector('[data-cart-toast-text]').textContent = text;
    const link = el.querySelector('.cart-toast__link');
    link.href = href || '/cart';
    link.textContent = `[${linkText || 'Bekijk winkelwagen'}]`;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 6000);
  };

  /* ---------------------------------------------------------------- cart API */
  const Cart = {
    async get() {
      const id = storage.get();
      if (!id) return null;
      const data = await gql(`${CART_FIELDS} query CartGet($id: ID!) { cart(id: $id) { ...CartFields } }`, { id });
      if (!data.cart) storage.set(null);
      return data.cart;
    },
    async add(variantId, quantity) {
      const lines = [{ merchandiseId: gid(variantId), quantity }];
      const id = storage.get();
      let result;
      if (id) {
        const d = await gql(`${CART_FIELDS} mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { field message } } }`, { cartId: id, lines });
        result = d.cartLinesAdd;
      }
      if (!result?.cart) {
        const d = await gql(`${CART_FIELDS} mutation CartCreate($lines: [CartLineInput!]!, $country: CountryCode, $language: LanguageCode) @inContext(country: $country, language: $language) { cartCreate(input: { lines: $lines }) { cart { ...CartFields } userErrors { field message } } }`, { lines, ...ctx });
        result = d.cartCreate;
      }
      if (result.userErrors?.length) throw new Error(result.userErrors[0].message);
      storage.set(result.cart.id);
      return result.cart;
    },
    async update(lineId, quantity) {
      const d = await gql(`${CART_FIELDS} mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { field message } } }`, { cartId: storage.get(), lines: [{ id: lineId, quantity }] });
      return d.cartLinesUpdate.cart;
    },
    async remove(lineId) {
      const d = await gql(`${CART_FIELDS} mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ...CartFields } userErrors { field message } } }`, { cartId: storage.get(), lineIds: [lineId] });
      return d.cartLinesRemove.cart;
    },
  };

  /* ---------------------------------------------------- product page: live data */
  const liveProduct = async (root) => {
    const handle = root.dataset.productHandle;
    try {
      const d = await gql(
        `query ProductPrice($handle: String!, $country: CountryCode, $language: LanguageCode) @inContext(country: $country, language: $language) { product(handle: $handle) { id title variants(first: 50) { nodes { id availableForSale price { amount currencyCode } compareAtPrice { amount currencyCode } } } } }`,
        { handle, ...ctx }
      );
      if (!d.product) throw new Error('Product niet gevonden in Shopify');
      const current = root.querySelector('input[name="id"]')?.value;
      const v = d.product.variants.nodes.find((n) => numericId(n.id) === String(current)) || d.product.variants.nodes[0];
      const price = root.querySelector('[data-price]');
      if (price) {
        price.innerHTML = v.compareAtPrice && Number(v.compareAtPrice.amount) > Number(v.price.amount)
          ? `<s>${money(v.compareAtPrice)}</s>${money(v.price)}`
          : money(v.price);
      }
      const btn = root.querySelector('[data-add-to-cart]');
      if (btn && !v.availableForSale) { btn.disabled = true; btn.querySelector('span').textContent = btn.dataset.soldOut; }
      root.setAttribute('data-live', 'true');
      const badge = document.createElement('p');
      badge.className = 'label label--sm';
      badge.style.cssText = 'color:var(--color-accent);margin:-14px 0 22px';
      badge.textContent = '● Live prijs uit Shopify';
      root.querySelector('.product__price')?.after(badge);
    } catch (err) {
      console.warn('[demo] live product data unavailable:', err);
    }
  };

  /* ------------------------------------------------------------ add to cart */
  document.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.matches('form[action="/cart/add"]')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const fd = new FormData(form);
    const variantId = fd.get('id');
    const qty = Math.max(1, Number(fd.get('quantity')) || 1);
    const btn = form.querySelector('[data-add-to-cart]');
    btn?.setAttribute('aria-busy', 'true');
    try {
      const cart = await Cart.add(variantId, qty);
      setCount(cart.totalQuantity);
      toast('Toegevoegd aan je Shopify-winkelwagen', cart.checkoutUrl, 'Afrekenen');
    } catch (err) {
      console.warn('[demo] Storefront API failed, using cart permalink:', err);
      window.location.href = `https://${cfg.checkoutHost}/cart/${numericId(variantId)}:${qty}`;
    } finally {
      btn?.removeAttribute('aria-busy');
    }
  }, true);

  /* -------------------------------------------------------------- cart page */
  const renderCart = (section, cart) => {
    const lines = cart?.lines?.nodes ?? [];
    if (!lines.length) {
      section.innerHTML = `<div class="listing-head"><h1 class="h-display">Winkelwagen</h1></div>
        <div class="empty-state"><p class="label">Je winkelwagen is leeg.</p>
        <p style="margin-top:20px"><a class="link-bracket" href="/collections/all">Verder winkelen</a></p></div>`;
      return;
    }
    section.innerHTML = `<div class="listing-head"><h1 class="h-display">Winkelwagen</h1></div>
      <table class="cart-table"><thead><tr><th class="label">Product</th><th class="label">Aantal</th><th class="label" style="text-align:right">Totaal</th></tr></thead><tbody>
      ${lines.map((l) => `<tr data-line="${esc(l.id)}">
        <td><div class="cart-item"><a class="media" href="/products/${esc(l.merchandise.product.handle)}">${l.merchandise.image ? `<img src="${esc(l.merchandise.image.url)}&width=240" alt="${esc(l.merchandise.image.altText || l.merchandise.product.title)}" width="240" height="300">` : ''}</a>
          <div><a class="cart-item__title" href="/products/${esc(l.merchandise.product.handle)}">${esc(l.merchandise.product.title)}</a>
          <p class="cart-item__variant label label--sm">${esc(l.merchandise.title)}</p><p class="label label--sm">${money(l.merchandise.price)}</p></div></div></td>
        <td><div class="qty"><input type="number" min="0" value="${l.quantity}" aria-label="Aantal" data-qty-input></div>
          <button type="button" class="cart-remove label label--sm" data-remove>Verwijderen</button></td>
        <td style="text-align:right" class="mono">${money(l.cost.totalAmount)}</td></tr>`).join('')}
      </tbody></table>
      <div class="cart-footer"><div></div><div class="cart-footer__totals">
        <p class="cart-footer__subtotal"><span>Subtotaal</span><span>${money(cart.cost.subtotalAmount)}</span></p>
        <p class="label label--sm">Verzendkosten en kortingscodes vul je in bij het afrekenen.</p>
        <a class="btn btn--block" href="${esc(cart.checkoutUrl)}">Afrekenen</a>
        <p class="label label--sm" style="color:var(--color-muted)">Je gaat naar de echte Shopify checkout van ${esc(cfg.checkoutHost)}.</p>
      </div></div>`;
  };

  const initCartPage = async () => {
    const section = document.querySelector('.cart');
    if (!section) return;
    const refresh = (cart) => { renderCart(section, cart); setCount(cart?.totalQuantity ?? 0); };
    try { refresh(await Cart.get()); } catch (err) { console.warn('[demo] cart unavailable', err); }
    let t;
    section.addEventListener('change', (e) => {
      if (!e.target.matches('[data-qty-input]')) return;
      const lineId = e.target.closest('[data-line]').dataset.line;
      clearTimeout(t);
      t = setTimeout(async () => refresh(await Cart.update(lineId, Math.max(0, Number(e.target.value) || 0))), 350);
    });
    section.addEventListener('click', async (e) => {
      if (!e.target.matches('[data-remove]')) return;
      refresh(await Cart.remove(e.target.closest('[data-line]').dataset.line));
    });
  };

  document.addEventListener('DOMContentLoaded', async () => {
    document.querySelectorAll('[data-product-handle]').forEach(liveProduct);
    if (document.body.classList.contains('template-cart')) {
      initCartPage();
    } else {
      try { const cart = await Cart.get(); setCount(cart?.totalQuantity ?? 0); } catch { /* offline */ }
    }
  });
})();
