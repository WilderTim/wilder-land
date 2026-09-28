/* Wilder Land — small progressive enhancements.
   Every form also works without JavaScript (it posts to Shopify's /cart routes). */
(() => {
  const routes = () => (window.theme && window.theme.routes) || { cart: '/cart', cartAdd: '/cart/add', cartChange: '/cart/change' };
  const strings = () => (window.theme && window.theme.strings) || {};

  const formatMoney = (cents, format) => {
    const value = (cents / 100).toFixed(2);
    const [whole, decimals] = value.split('.');
    const withSeparators = (sep, dec) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, sep) + dec + decimals;
    const placeholder = /\{\{\s*(\w+)\s*\}\}/;
    const match = (format || '€{{amount_with_comma_separator}}').match(placeholder);
    let formatted;
    switch (match && match[1]) {
      case 'amount_with_comma_separator': formatted = withSeparators('.', ','); break;
      case 'amount_no_decimals': formatted = whole; break;
      case 'amount_no_decimals_with_comma_separator': formatted = whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.'); break;
      default: formatted = withSeparators(',', '.');
    }
    return (format || '€{{amount_with_comma_separator}}').replace(placeholder, formatted);
  };

  const updateCartCount = (count) => {
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = count;
      el.closest('.cart-count')?.setAttribute('data-count', count);
    });
  };

  const toast = (text) => {
    const el = document.getElementById('CartToast');
    if (!el) return;
    el.querySelector('[data-cart-toast-text]').textContent = text;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { el.hidden = true; }, 5000);
  };

  /* ---- Product form: variant picking ---------------------------------- */
  class ProductForm {
    constructor(root) {
      this.root = root;
      this.form = root.querySelector('form[action*="/cart/add"]');
      const json = root.querySelector('[data-product-json]');
      this.product = json ? JSON.parse(json.textContent) : null;
      this.moneyFormat = root.dataset.moneyFormat;
      this.idInput = root.querySelector('input[name="id"]');
      this.submit = root.querySelector('[data-add-to-cart]');
      root.addEventListener('change', (e) => { if (e.target.matches('[data-option]')) this.onOptionChange(); });
      root.querySelectorAll('[data-qty]').forEach((btn) => btn.addEventListener('click', () => this.stepQty(Number(btn.dataset.qty))));
      if (this.form) this.form.addEventListener('submit', (e) => this.onSubmit(e));
    }

    selectedOptions() {
      return [...this.root.querySelectorAll('[data-option-index]')].map((group) => {
        const checked = group.querySelector('[data-option]:checked') || group.querySelector('select[data-option]');
        return checked ? checked.value : null;
      });
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
        const media = this.root.closest('.product')?.querySelector(`[data-media-id="${variant.featured_media.id}"]`);
        media?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    setAvailability(available, unavailable = false) {
      if (!this.submit) return;
      this.submit.disabled = !available;
      this.submit.querySelector('span').textContent = unavailable
        ? this.submit.dataset.unavailable
        : available ? this.submit.dataset.add : this.submit.dataset.soldOut;
    }

    stepQty(step) {
      const input = this.root.querySelector('input[name="quantity"]');
      const min = Number(input.min) || 1;
      const inc = Number(input.step) || 1;
      input.value = Math.max(min, (Number(input.value) || min) + step * inc);
    }

    async onSubmit(event) {
      if (!window.fetch) return;
      event.preventDefault();
      this.submit?.setAttribute('aria-busy', 'true');
      try {
        const res = await fetch(`${routes().cartAdd}.js`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          body: new FormData(this.form),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.description || data.message || strings().error);
        const cart = await (await fetch(`${routes().cart}.js`)).json();
        updateCartCount(cart.item_count);
        toast(`${data.product_title} — ${strings().added || 'toegevoegd'}`);
      } catch (err) {
        toast(err.message || strings().error || 'Er ging iets mis');
      } finally {
        this.submit?.removeAttribute('aria-busy');
      }
    }
  }

  /* ---- Cart page: quantity change auto-submits ------------------------ */
  const initCart = () => {
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
    document.querySelectorAll('[data-product-form]').forEach((el) => new ProductForm(el));
    initCart();
  });

  // Keep Theme Editor previews interactive when sections are re-rendered.
  document.addEventListener('shopify:section:load', (e) => {
    e.target.querySelectorAll('[data-product-form]').forEach((el) => new ProductForm(el));
  });
})();
