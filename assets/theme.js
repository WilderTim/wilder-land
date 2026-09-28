/* Wilder Land — progressive enhancements.
   Without JavaScript every form still works (it posts to Shopify's /cart routes). */
(() => {
  const theme = window.theme || {};
  const routes = () => theme.routes || { cart: '/cart', cartAdd: '/cart/add', cartChange: '/cart/change' };
  const t = (key, fallback) => (theme.strings && theme.strings[key]) || fallback;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const formatMoney = (cents, format = theme.moneyFormat || '€{{amount_with_comma_separator}}') => {
    const [whole, decimals] = (Number(cents || 0) / 100).toFixed(2).split('.');
    const group = (sep) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    return format.replace(/\{\{\s*(\w+)\s*\}\}/, (_, kind) => {
      if (kind === 'amount_no_decimals') return group(',');
      if (kind === 'amount_no_decimals_with_comma_separator') return group('.');
      if (kind === 'amount_with_comma_separator') return `${group('.')},${decimals}`;
      return `${group(',')}.${decimals}`;
    });
  };

  /* ---------------------------------------------------------------- header */
  const initHeader = () => {
    const header = document.querySelector('[data-header]');
    if (!header) return;
    if (header.classList.contains('site-header--overlay')) {
      const update = () => header.classList.toggle('is-scrolled', window.scrollY > 40 || document.body.classList.contains('menu-open'));
      update();
      window.addEventListener('scroll', update, { passive: true });
    }
    const toggle = document.querySelector('[data-menu-toggle]');
    const nav = document.querySelector('[data-mobile-nav]');
    if (toggle && nav) {
      const labelOpen = toggle.textContent.trim();
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', open);
        toggle.textContent = open ? t('close', 'Sluit') : labelOpen;
        nav.classList.toggle('is-open', open);
        document.body.classList.toggle('menu-open', open);
        document.body.classList.toggle('has-overlay', open);
        header.classList.toggle('is-scrolled', open || window.scrollY > 40);
      });
    }
  };

  /* ------------------------------------------------------------------ cart */
  // The adapter talks to a cart backend. Default: Shopify's AJAX cart API.
  // The static demo swaps it for the Storefront API (demo/storefront.js).
  const shopifyAdapter = {
    normalize(c) {
      return {
        count: c.item_count,
        subtotal: formatMoney(c.total_price),
        checkoutUrl: '/checkout',
        lines: c.items.map((i) => ({
          key: i.key,
          title: i.product_title,
          variant: i.product_has_only_default_variant ? '' : i.variant_title,
          url: i.url,
          image: i.image ? `${i.image}${i.image.includes('?') ? '&' : '?'}width=200` : '',
          quantity: i.quantity,
          price: formatMoney(i.final_line_price),
        })),
      };
    },
    async get() {
      const res = await fetch(`${routes().cart}.js`, { headers: { Accept: 'application/json' } });
      return this.normalize(await res.json());
    },
    async add(formData) {
      const res = await fetch(`${routes().cartAdd}.js`, { method: 'POST', headers: { Accept: 'application/json' }, body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.description || data.message || t('error', 'Er ging iets mis'));
      return this.get();
    },
    async change(key, quantity) {
      await fetch(`${routes().cartChange}.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ id: key, quantity }),
      });
      return this.get();
    },
  };

  const Cart = {
    adapter: shopifyAdapter,
    drawer: null,
    lastFocus: null,

    setCount(n) {
      document.querySelectorAll('[data-cart-count]').forEach((el) => {
        el.textContent = n;
        el.setAttribute('data-count', n);
      });
    },

    render(cart) {
      this.setCount(cart.count);
      const drawer = this.drawer;
      if (!drawer) return;
      const body = drawer.querySelector('[data-cart-lines]');
      const foot = drawer.querySelector('[data-cart-foot]');
      if (!cart.lines.length) {
        body.innerHTML = `<div class="drawer-empty"><p class="label">${esc(t('empty', 'Je winkelwagen is leeg.'))}</p><button type="button" class="link-bracket" style="background:none;border:0;cursor:pointer" data-cart-close>${esc(t('continue', 'Verder winkelen'))}</button></div>`;
        foot.hidden = true;
        return;
      }
      body.innerHTML = cart.lines.map((l) => `
        <div class="drawer-line" data-key="${esc(l.key)}">
          <a class="media" href="${esc(l.url)}">${l.image ? `<img src="${esc(l.image)}" alt="" width="152" height="190" loading="lazy">` : ''}</a>
          <div>
            <a class="drawer-line__title" href="${esc(l.url)}">${esc(l.title)}</a>
            ${l.variant ? `<p class="drawer-line__variant label">${esc(l.variant)}</p>` : ''}
            <div class="drawer-line__actions">
              <div class="qty qty--sm">
                <button type="button" data-step="-1" aria-label="-">−</button>
                <input type="number" min="0" value="${l.quantity}" aria-label="${esc(t('quantity', 'Aantal'))}" data-line-qty>
                <button type="button" data-step="1" aria-label="+">+</button>
              </div>
              <button type="button" class="cart-remove label" data-remove>${esc(t('remove', 'Verwijderen'))}</button>
            </div>
          </div>
          <span class="drawer-line__price">${esc(l.price)}</span>
        </div>`).join('');
      foot.hidden = false;
      foot.querySelector('[data-cart-subtotal]').textContent = cart.subtotal;
      foot.querySelector('[data-cart-checkout]').href = cart.checkoutUrl;
    },

    async refresh() {
      try { this.render(await this.adapter.get()); } catch (e) { console.warn('[cart]', e); }
    },

    open() {
      if (!this.drawer) { window.location.href = routes().cart; return; }
      this.lastFocus = document.activeElement;
      this.drawer.classList.add('is-open');
      document.querySelector('.drawer-backdrop')?.classList.add('is-open');
      document.body.classList.add('has-overlay');
      this.drawer.querySelector('[data-cart-close]')?.focus();
    },

    close() {
      this.drawer?.classList.remove('is-open');
      document.querySelector('.drawer-backdrop')?.classList.remove('is-open');
      document.body.classList.remove('has-overlay');
      this.lastFocus?.focus?.();
    },

    async add(form, button) {
      button?.setAttribute('aria-busy', 'true');
      try {
        this.render(await this.adapter.add(new FormData(form)));
        this.open();
      } catch (err) {
        alert(err.message || t('error', 'Er ging iets mis'));
      } finally {
        button?.removeAttribute('aria-busy');
      }
    },

    async change(key, quantity) {
      this.drawer?.querySelector(`[data-key="${CSS.escape(key)}"]`)?.setAttribute('aria-busy', 'true');
      try { this.render(await this.adapter.change(key, quantity)); } catch (e) { console.warn('[cart]', e); this.refresh(); }
    },

    init() {
      this.drawer = document.querySelector('[data-cart-drawer]');
      const onCartPage = document.body.classList.contains('template-cart');

      document.addEventListener('click', (e) => {
        if (e.target.closest('[data-cart-open]') && this.drawer && !onCartPage) { e.preventDefault(); this.open(); }
        if (e.target.closest('[data-cart-close]')) this.close();
        const line = e.target.closest('.drawer-line');
        if (!line) return;
        if (e.target.closest('[data-remove]')) this.change(line.dataset.key, 0);
        const step = e.target.closest('[data-step]');
        if (step) {
          const input = line.querySelector('[data-line-qty]');
          this.change(line.dataset.key, Math.max(0, Number(input.value) + Number(step.dataset.step)));
        }
      });
      document.addEventListener('change', (e) => {
        const input = e.target.closest('[data-line-qty]');
        if (input) this.change(input.closest('.drawer-line').dataset.key, Math.max(0, Number(input.value) || 0));
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.drawer?.classList.contains('is-open')) this.close(); });

      // Every add-to-cart form (product page + quick add on cards) goes through the drawer.
      document.addEventListener('submit', (e) => {
        const form = e.target.closest('form[action*="/cart/add"]');
        if (!form || !window.fetch) return;
        e.preventDefault();
        this.add(form, form.querySelector('[type="submit"]'));
      });

      if (!onCartPage) this.refresh();
    },
  };
  window.WLCart = Cart;

  /* ------------------------------------------- product page: variant picking */
  class ProductForm {
    constructor(root) {
      this.root = root;
      const json = root.querySelector('[data-product-json]');
      this.product = json ? JSON.parse(json.textContent) : null;
      this.moneyFormat = root.dataset.moneyFormat;
      this.idInput = root.querySelector('input[name="id"]');
      this.submit = root.querySelector('[data-add-to-cart]');
      root.addEventListener('change', (e) => { if (e.target.matches('[data-option]')) this.onOptionChange(); });
      root.querySelectorAll('[data-qty]').forEach((btn) => btn.addEventListener('click', () => this.stepQty(Number(btn.dataset.qty))));
    }

    selectedOptions() {
      return [...this.root.querySelectorAll('[data-option-index]')].map((group) => group.querySelector('[data-option]:checked')?.value ?? null);
    }

    onOptionChange() {
      if (!this.product) return;
      const options = this.selectedOptions();
      const variant = this.product.variants.find((v) => v.options.every((o, i) => o === options[i]));
      if (!variant) { this.setAvailability(false, true); return; }
      this.idInput.value = variant.id;
      this.setAvailability(variant.available);
      const price = this.root.querySelector('[data-price]');
      if (price) {
        price.innerHTML = variant.compare_at_price > variant.price
          ? `<s>${formatMoney(variant.compare_at_price, this.moneyFormat)}</s>${formatMoney(variant.price, this.moneyFormat)}`
          : formatMoney(variant.price, this.moneyFormat);
      }
      const url = new URL(window.location.href);
      url.searchParams.set('variant', variant.id);
      window.history.replaceState({}, '', url.toString());
      if (variant.featured_media) {
        document.querySelector(`[data-media-id="${variant.featured_media.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    }

    setAvailability(available, unavailable = false) {
      if (!this.submit) return;
      this.submit.disabled = !available;
      this.submit.querySelector('span').textContent = unavailable ? this.submit.dataset.unavailable : available ? this.submit.dataset.add : this.submit.dataset.soldOut;
    }

    stepQty(step) {
      const input = this.root.querySelector('input[name="quantity"]');
      const min = Number(input.min) || 1;
      const inc = Number(input.step) || 1;
      input.value = Math.max(min, (Number(input.value) || min) + step * inc);
    }
  }

  /* ---------------------------------------- cart page: auto-submit quantities */
  const initCartPage = () => {
    const form = document.querySelector('[data-cart-form]');
    if (!form) return;
    let timer;
    form.addEventListener('change', (e) => {
      if (!e.target.matches('input[name="updates[]"]')) return;
      clearTimeout(timer);
      timer = setTimeout(() => form.submit(), 350);
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    initHeader();
    Cart.init();
    document.querySelectorAll('[data-product-form]').forEach((el) => new ProductForm(el));
    initCartPage();
  });

  // Keep Theme Editor previews interactive when sections are re-rendered.
  document.addEventListener('shopify:section:load', (e) => {
    e.target.querySelectorAll('[data-product-form]').forEach((el) => new ProductForm(el));
    if (e.target.querySelector('[data-header]')) initHeader();
  });
})();
