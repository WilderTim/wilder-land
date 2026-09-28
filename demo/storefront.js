/**
 * Demo-only: connects the static Vercel preview to the real Shopify store through the
 * public Storefront API (tokenless access — no secret; the only thing written to Shopify
 * is a shopping cart when a visitor adds something).
 *
 * It plugs a Storefront-API "adapter" into the theme's cart drawer (assets/theme.js), so
 * the drawer, header count and quick-add behave exactly like on Shopify. It also:
 * - shows the live price on the product page;
 * - renders the /cart page from the Shopify cart;
 * - falls back to a Shopify cart permalink (https://<store>/cart/<variant>:<qty>) when the
 *   API can't be reached, which also ends in Shopify Checkout.
 *
 * This file is NOT part of the Shopify theme.
 */
(() => {
  const cfg = window.WL_DEMO;
  if (!cfg || !window.WLCart) return;
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

  const money = ({ amount, currencyCode }) => new Intl.NumberFormat('nl-NL', { style: 'currency', currency: currencyCode }).format(Number(amount));
  const gid = (id) => (String(id).startsWith('gid://') ? String(id) : `gid://shopify/ProductVariant/${id}`);
  const numericId = (id) => String(id).split('/').pop();
  const storage = {
    get: () => { try { return localStorage.getItem(CART_KEY); } catch { return null; } },
    set: (v) => { try { v ? localStorage.setItem(CART_KEY, v) : localStorage.removeItem(CART_KEY); } catch { /* private mode */ } },
  };

  const normalize = (cart) => ({
    count: cart?.totalQuantity ?? 0,
    subtotal: cart ? money(cart.cost.subtotalAmount) : '',
    checkoutUrl: cart?.checkoutUrl ?? '#',
    lines: (cart?.lines?.nodes ?? []).map((l) => ({
      key: l.id,
      title: l.merchandise.product.title,
      variant: l.merchandise.title === 'Default Title' ? '' : l.merchandise.title,
      url: `/products/${l.merchandise.product.handle}`,
      image: l.merchandise.image ? `${l.merchandise.image.url}${l.merchandise.image.url.includes('?') ? '&' : '?'}width=200` : '',
      quantity: l.quantity,
      price: money(l.cost.totalAmount),
    })),
  });

  const run = async (op, vars) => {
    const data = await gql(`${CART_FIELDS} ${op}`, vars);
    const payload = Object.values(data)[0];
    if (payload?.userErrors?.length) throw new Error(payload.userErrors[0].message);
    const cart = payload?.cart ?? payload;
    if (cart?.id) storage.set(cart.id);
    return cart;
  };

  const adapter = {
    async get() {
      const id = storage.get();
      if (!id) return normalize(null);
      const cart = await run('query CartGet($id: ID!) { cart(id: $id) { ...CartFields } }', { id });
      if (!cart) storage.set(null);
      return normalize(cart);
    },
    async add(formData) {
      const variantId = formData.get('id');
      const quantity = Math.max(1, Number(formData.get('quantity')) || 1);
      const lines = [{ merchandiseId: gid(variantId), quantity }];
      try {
        const id = storage.get();
        let cart = null;
        if (id) {
          cart = await run('mutation CartLinesAdd($cartId: ID!, $lines: [CartLineInput!]!) { cartLinesAdd(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { field message } } }', { cartId: id, lines }).catch(() => null);
        }
        if (!cart) {
          cart = await run('mutation CartCreate($lines: [CartLineInput!]!, $country: CountryCode, $language: LanguageCode) @inContext(country: $country, language: $language) { cartCreate(input: { lines: $lines }) { cart { ...CartFields } userErrors { field message } } }', { lines, ...ctx });
        }
        return normalize(cart);
      } catch (err) {
        console.warn('[demo] Storefront API failed, using cart permalink:', err);
        window.location.href = `https://${cfg.checkoutHost}/cart/${numericId(variantId)}:${quantity}`;
        return new Promise(() => {}); // navigating away
      }
    },
    async change(lineId, quantity) {
      const cartId = storage.get();
      const cart = quantity > 0
        ? await run('mutation CartLinesUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) { cartLinesUpdate(cartId: $cartId, lines: $lines) { cart { ...CartFields } userErrors { field message } } }', { cartId, lines: [{ id: lineId, quantity }] })
        : await run('mutation CartLinesRemove($cartId: ID!, $lineIds: [ID!]!) { cartLinesRemove(cartId: $cartId, lineIds: $lineIds) { cart { ...CartFields } userErrors { field message } } }', { cartId, lineIds: [lineId] });
      return normalize(cart);
    },
  };
  window.WLCart.adapter = adapter;

  /* ---------------------------------------------------- product page: live data */
  const liveProduct = async (root) => {
    try {
      const d = await gql(
        'query ProductPrice($handle: String!, $country: CountryCode, $language: LanguageCode) @inContext(country: $country, language: $language) { product(handle: $handle) { id title variants(first: 50) { nodes { id availableForSale price { amount currencyCode } compareAtPrice { amount currencyCode } } } } }',
        { handle: root.dataset.productHandle, ...ctx }
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
      root.querySelector('[data-live-badge]')?.removeAttribute('hidden');
    } catch (err) {
      console.warn('[demo] live product data unavailable:', err);
    }
  };

  /* ----------------------------------------------- /cart page (static in demo) */
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const renderCartPage = (section, cart) => {
    const head = '<div class="listing-head"><h1 class="h-display">Winkelwagen</h1></div>';
    if (!cart.lines.length) {
      section.innerHTML = `${head}<div class="empty-state"><p class="label">Je winkelwagen is leeg.</p><p style="margin-top:20px"><a class="link-bracket" href="/collections/all">Verder winkelen</a></p></div>`;
      return;
    }
    section.innerHTML = `${head}
      <table class="cart-table"><thead><tr><th class="label">Product</th><th class="label">Aantal</th><th class="label" style="text-align:right">Totaal</th></tr></thead><tbody>
      ${cart.lines.map((l) => `<tr data-line="${esc(l.key)}">
        <td><div class="cart-item"><a class="media" href="${esc(l.url)}">${l.image ? `<img src="${esc(l.image)}" alt="" width="176" height="220">` : ''}</a>
          <div><a class="cart-item__title" href="${esc(l.url)}">${esc(l.title)}</a>${l.variant ? `<p class="cart-item__variant label">${esc(l.variant)}</p>` : ''}</div></div></td>
        <td><div class="qty"><input type="number" min="0" value="${l.quantity}" aria-label="Aantal" data-page-qty></div>
          <button type="button" class="cart-remove label" data-page-remove>Verwijderen</button></td>
        <td style="text-align:right" class="mono">${esc(l.price)}</td></tr>`).join('')}
      </tbody></table>
      <div class="cart-footer"><div></div><div class="cart-footer__totals">
        <p class="cart-footer__subtotal"><span>Subtotaal</span><span>${esc(cart.subtotal)}</span></p>
        <p class="label label--muted">Verzendkosten en kortingscodes vul je in bij het afrekenen.</p>
        <a class="btn btn--block" href="${esc(cart.checkoutUrl)}">Afrekenen</a>
        <p class="drawer-note">Je gaat naar de echte Shopify checkout van ${esc(cfg.checkoutHost)}.</p>
      </div></div>`;
  };

  const initCartPage = async () => {
    const section = document.querySelector('.cart');
    if (!section) return;
    const refresh = (cart) => { renderCartPage(section, cart); window.WLCart.setCount(cart.count); };
    try { refresh(await adapter.get()); } catch (err) { console.warn('[demo] cart unavailable', err); }
    let timer;
    section.addEventListener('change', (e) => {
      if (!e.target.matches('[data-page-qty]')) return;
      const key = e.target.closest('[data-line]').dataset.line;
      clearTimeout(timer);
      timer = setTimeout(async () => refresh(await adapter.change(key, Math.max(0, Number(e.target.value) || 0))), 350);
    });
    section.addEventListener('click', async (e) => {
      if (e.target.matches('[data-page-remove]')) refresh(await adapter.change(e.target.closest('[data-line]').dataset.line, 0));
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-product-handle]').forEach(liveProduct);
    if (document.body.classList.contains('template-cart')) initCartPage();
  });
})();
