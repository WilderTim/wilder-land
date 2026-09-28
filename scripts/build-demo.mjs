#!/usr/bin/env node
/**
 * Renders the Shopify theme in this repo to a static demo site (dist/) for Vercel.
 *
 * It is NOT a Shopify replacement: it runs the same Liquid files with the open-source
 * `liquidjs` engine and a small set of stand-ins for Shopify's objects and filters, using
 * the snapshot in demo/data.json. demo/storefront.js then makes the one demo product live
 * (price, cart, checkout) through Shopify's public Storefront API.
 *
 *   npm run build:demo   → dist/
 */
import { Liquid } from 'liquidjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'dist');
const read = (p) => fs.readFile(path.join(ROOT, p), 'utf8');
const readJSON = async (p) => JSON.parse(await read(p));

const data = await readJSON('demo/data.json');
const locale = await readJSON('locales/nl.default.json');
const settingsSchema = await readJSON('config/settings_schema.json');
const settingsData = await readJSON('config/settings_data.json');

/* ---------------------------------------------------------------- helpers */

const splitArgs = (args) => {
  const named = {};
  const positional = [];
  for (const a of args) {
    if (Array.isArray(a) && a.length === 2 && typeof a[0] === 'string') named[a[0]] = a[1];
    else positional.push(a);
  }
  return { named, positional };
};
const escapeAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const handleize = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const withWidth = (src, width) => (width ? `${src}${src.includes('?') ? '&' : '?'}width=${width}` : src);
const imageSrc = (img) => (typeof img === 'string' ? img : img?.src || img?.preview_image?.src || '');

const formatMoney = (cents) => {
  const [whole, dec] = (Number(cents || 0) / 100).toFixed(2).split('.');
  return data.shop.money_format.replace(/\{\{\s*\w+\s*\}\}/, `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`);
};

const lookup = (obj, key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/* ------------------------------------------------------------ demo models */

const makeImage = (src, width = 1200, height = 1200, alt = '') => ({ src, width, height, alt, aspect_ratio: width / height });
const assetImage = (file) => makeImage(`/assets/${file}`);

const makeProduct = (p) => {
  const media = p.media.map((m, i) => ({ ...makeImage(m.src, m.width, m.height, p.title), id: m.id, media_type: 'image', position: i + 1 }));
  const variants = p.variants.map((v) => ({
    ...v,
    url: `/products/${p.handle}?variant=${v.id}`,
    featured_media: null,
    quantity_rule: { min: 1, increment: 1 },
    unit_price_measurement: null,
  }));
  const first = variants.find((v) => v.available) || variants[0];
  return {
    ...p,
    url: `/products/${p.handle}`,
    media,
    images: media,
    featured_media: media[0],
    featured_image: media[0],
    variants,
    selected_or_first_available_variant: first,
    price: first.price,
    available: variants.some((v) => v.available),
    has_only_default_variant: p.options.length === 1 && p.options[0].name === 'Title',
    options_with_values: p.options.map((o, i) => ({ ...o, position: i + 1, selected_value: first.options[i] })),
    metafields: { custom: { subtitle: { value: p.subtitle } } },
  };
};

const products = Object.fromEntries(data.products.map((p) => [p.handle, makeProduct(p)]));
const linklists = Object.fromEntries(Object.entries(data.menus).map(([handle, m]) => [handle, { handle, ...m }]));
const blog = {
  ...data.blog,
  url: `/blogs/${data.blog.handle}`,
  articles_count: data.blog.articles.length,
  all_tags: [...new Set(data.blog.articles.flatMap((a) => a.tags))],
  articles: data.blog.articles.map((a) => ({ ...a, url: `/blogs/${data.blog.handle}/${a.handle}`, image: assetImage(a.image) })),
};
const allCollection = {
  title: 'Shop',
  handle: 'all',
  url: '/collections/all',
  description: '<p>Demo-collectie. In Shopify vul je collecties handmatig of automatisch op basis van product-tags.</p>',
  products: Object.values(products),
  products_count: Object.keys(products).length,
  filters: [],
};

const resolveSetting = (type, value) => {
  if (value === undefined || value === null || value === '') return value;
  switch (type) {
    case 'product':
      return products[value] ?? null;
    case 'collection':
      return value === 'all' ? allCollection : null;
    case 'blog':
      return value === blog.handle ? blog : null;
    case 'link_list':
      return linklists[value] ?? { links: [] };
    case 'image_picker': {
      const file = String(value).replace('shopify://shop_images/', '');
      const img = data.shopImages[file];
      return img ? makeImage(img.src, img.width, img.height) : null;
    }
    case 'url':
      return String(value)
        .replace('shopify://collections/', '/collections/')
        .replace('shopify://products/', '/products/')
        .replace('shopify://pages/', '/pages/')
        .replace('shopify://blogs/', '/blogs/');
    default:
      return value;
  }
};

const globalSettings = (() => {
  const s = {};
  for (const group of settingsSchema) for (const def of group.settings ?? []) if ('default' in def) s[def.id] = def.default;
  const preset = settingsData.presets?.[settingsData.current] ?? settingsData.current ?? {};
  return { ...s, ...preset };
})();

/* ---------------------------------------------------------- liquid engine */

const engine = new Liquid({
  root: [path.join(ROOT, 'snippets')],
  partials: [path.join(ROOT, 'snippets')],
  extname: '.liquid',
  jsTruthy: false,
  strictFilters: false,
  strictVariables: false,
});

// Shopify syntax liquidjs does not know about. Only applied for the demo build.
const preprocess = (src) =>
  src
    .replace(/\{%-?\s*schema\s*-?%\}[\s\S]*?\{%-?\s*endschema\s*-?%\}/g, '')
    .replace(/posted_successfully\?/g, 'posted_successfully')
    .replace(/forloop\.parentloop\.index/g, 'forloop.index');

const schemaOf = (src) => {
  const m = src.match(/\{%-?\s*schema\s*-?%\}([\s\S]*?)\{%-?\s*endschema\s*-?%\}/);
  return m ? JSON.parse(m[1]) : {};
};

// {% style %} … {% endstyle %}
engine.registerTag('style', {
  parse(_token, remain) {
    this.tpls = [];
    const stream = this.liquid.parser.parseStream(remain);
    stream.on('tag:endstyle', () => stream.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('style not closed'); });
    stream.start();
  },
  *render(ctx, emitter) {
    emitter.write('<style>');
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    emitter.write('</style>');
  },
});

// {% form 'type', object, class: '…' %} … {% endform %}
engine.registerTag('form', {
  parse(token, remain) {
    this.args = token.args;
    this.tpls = [];
    const stream = this.liquid.parser.parseStream(remain);
    stream.on('tag:endform', () => stream.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('form not closed'); });
    stream.start();
  },
  *render(ctx, emitter) {
    const type = (this.args.match(/^\s*'([^']+)'/) || [])[1];
    const cls = (this.args.match(/class:\s*'([^']*)'/) || [])[1];
    const id = (this.args.match(/id:\s*'([^']*)'/) || [])[1];
    const actions = { product: '/cart/add', customer: '#', storefront_password: '#' };
    emitter.write(
      `<form method="post" action="${actions[type] ?? '#'}" accept-charset="UTF-8"${cls ? ` class="${cls}"` : ''}${id ? ` id="${id}"` : ''}` +
        `${type === 'product' ? ' enctype="multipart/form-data" novalidate' : ''}><input type="hidden" name="form_type" value="${type}">`
    );
    ctx.push({ form: { errors: null, posted_successfully: false } });
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
    emitter.write('</form>');
  },
});

// {% paginate x by n %} … {% endpaginate %}  (the demo never has more than one page)
engine.registerTag('paginate', {
  parse(_token, remain) {
    this.tpls = [];
    const stream = this.liquid.parser.parseStream(remain);
    stream.on('tag:endpaginate', () => stream.stop()).on('template', (t) => this.tpls.push(t)).on('end', () => { throw new Error('paginate not closed'); });
    stream.start();
  },
  *render(ctx, emitter) {
    ctx.push({ paginate: { pages: 1, current_page: 1 } });
    yield this.liquid.renderer.renderTemplates(this.tpls, ctx, emitter);
    ctx.pop();
  },
});

// {% sections 'header-group' %}
engine.registerTag('sections', {
  parse(token) {
    this.group = token.args.replace(/['"\s]/g, '');
  },
  *render(ctx, emitter) {
    const group = yield readJSON(`sections/${this.group}.json`);
    const html = yield renderSectionList(group, ctx.getAll());
    emitter.write(html);
  },
});

const filters = {
  t(key, ...args) {
    const { named } = splitArgs(args);
    const str = lookup(locale, key);
    if (typeof str !== 'string') return key;
    return str.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => named[k] ?? '');
  },
  asset_url: (file) => `/assets/${file}`,
  stylesheet_tag: (url) => `<link href="${url}" rel="stylesheet" type="text/css" media="all" />`,
  preload_tag(url, ...args) {
    const { named } = splitArgs(args);
    return `<link href="${url}" rel="preload" as="${named.as}"${named.type ? ` type="${named.type}"` : ''}${named.crossorigin ? ' crossorigin' : ''}>`;
  },
  image_url(img, ...args) {
    const { named } = splitArgs(args);
    const src = imageSrc(img);
    return src.startsWith('/assets/') ? src : withWidth(src, named.width);
  },
  image_tag(url, ...args) {
    const { named } = splitArgs(args);
    const base = String(url).replace(/[?&]width=\d+/, '');
    const local = base.startsWith('/assets/');
    const widths = local ? [] : String(named.widths || '').split(',').map((w) => w.trim()).filter(Boolean);
    const srcset = widths.map((w) => `${withWidth(base, w)} ${w}w`).join(', ');
    const attrs = [
      `src="${local ? base : withWidth(base, widths.at(-1) || 1600)}"`,
      srcset && `srcset="${srcset}"`,
      named.sizes && `sizes="${escapeAttr(named.sizes)}"`,
      `alt="${escapeAttr(named.alt)}"`,
      'width="1200" height="1200"',
      named.loading && `loading="${named.loading}"`,
      named.fetchpriority && `fetchpriority="${named.fetchpriority}"`,
      named.class && `class="${escapeAttr(named.class)}"`,
      named.style && `style="${escapeAttr(named.style)}"`,
    ].filter(Boolean);
    return `<img ${attrs.join(' ')}>`;
  },
  money: (cents) => formatMoney(cents),
  money_without_currency: (cents) => formatMoney(cents).replace(/[^\d.,]/g, ''),
  color_modify(hex, prop, value) {
    const h = String(hex).replace('#', '');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    return prop === 'alpha' ? `rgba(${r}, ${g}, ${b}, ${value})` : hex;
  },
  placeholder_svg_tag: (_n, cls) => `<svg class="${cls || ''}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="#e6e5e3"/></svg>`,
  handle: handleize,
  handleize,
  metafield_tag: (v) => (typeof v === 'object' ? v?.value ?? '' : v),
  media_tag: () => '',
  payment_button: () => '',
  default_errors: () => '',
  format_address: () => '',
  date(value, ...args) {
    const { named, positional } = splitArgs(args);
    const d = value === 'now' || value === 'today' ? new Date() : new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const fmt = named.format === 'date' ? '%d-%m-%Y' : positional[0] || '%d-%m-%Y';
    const pad = (n) => String(n).padStart(2, '0');
    return fmt
      .replace('%Y', d.getFullYear())
      .replace('%m', pad(d.getMonth() + 1))
      .replace('%d', pad(d.getDate()))
      .replace('%H', pad(d.getHours()))
      .replace('%M', pad(d.getMinutes()))
      .replace('%S', pad(d.getSeconds()));
  },
};
for (const [name, fn] of Object.entries(filters)) engine.registerFilter(name, fn);

/* ------------------------------------------------------- section rendering */

const sectionCache = new Map();
const loadSection = async (type) => {
  if (!sectionCache.has(type)) {
    const src = await read(`sections/${type}.liquid`);
    sectionCache.set(type, { schema: schemaOf(src), tpl: engine.parse(preprocess(src)) });
  }
  return sectionCache.get(type);
};

const buildSettings = (defs = [], values = {}) => {
  const out = {};
  for (const def of defs) {
    if (!def.id) continue;
    const raw = def.id in values ? values[def.id] : def.default;
    out[def.id] = resolveSetting(def.type, raw);
  }
  return out;
};

async function renderSection(id, entry, scope) {
  const { schema, tpl } = await loadSection(entry.type);
  const blockDefs = Object.fromEntries((schema.blocks ?? []).map((b) => [b.type, b]));
  const blocks = (entry.block_order ?? Object.keys(entry.blocks ?? {})).map((bid) => {
    const b = entry.blocks[bid];
    return { id: bid, type: b.type, shopify_attributes: '', settings: buildSettings(blockDefs[b.type]?.settings, b.settings) };
  });
  const section = { id, settings: buildSettings(schema.settings, entry.settings), blocks, shopify_attributes: '' };
  // Shopify lets {% render %} snippets read global objects (settings, shop, routes …).
  const html = await engine.render(tpl, { ...scope, section }, { globals: scope });
  const tag = schema.tag || 'div';
  const cls = ['shopify-section', schema.class].filter(Boolean).join(' ');
  return `<${tag} id="shopify-section-${id}" class="${cls}">${html}</${tag}>`;
}

async function renderSectionList(template, scope) {
  const parts = [];
  for (const id of template.order) {
    if (template.sections[id].disabled) continue;
    parts.push(await renderSection(id, template.sections[id], scope));
  }
  return parts.join('\n');
}

/* ------------------------------------------------------------- page build */

const layoutTpl = engine.parse(preprocess(await read('layout/theme.liquid')));

const routes = {
  root_url: '/',
  cart_url: '/cart',
  cart_add_url: '/cart/add',
  cart_change_url: '/cart/change',
  all_products_collection_url: '/collections/all',
  collections_url: '/collections/all',
  search_url: '/collections/all',
  account_url: '#',
  account_login_url: '#',
  account_register_url: '#',
  account_addresses_url: '#',
  account_logout_url: '#',
};

const demoHead = `
<script>window.WL_DEMO = ${JSON.stringify(data.store)};</script>
<script src="/demo/storefront.js" defer></script>
<style>
  .demo-flag{position:fixed;left:12px;bottom:12px;z-index:60;background:#04A151;color:#fff;font:500 10px/1.3 var(--font-mono);letter-spacing:.04em;text-transform:uppercase;padding:7px 9px;max-width:calc(100vw - 24px)}
  .demo-flag a{color:inherit}
</style>`;
const demoFlag = `<div class="demo-flag">Demo · 1 product live uit Shopify · <a href="/products/${data.products[0].handle}">test checkout</a></div>`;

async function renderPage({ file, template, title, pageType, extra = {} }) {
  const tplJSON = typeof template === 'string' ? await readJSON(`templates/${template}.json`) : template;
  const templateName = typeof template === 'string' ? template : pageType;
  const scope = {
    settings: globalSettings,
    shop: { ...data.shop, url: '/', money_format: data.shop.money_format },
    routes,
    cart: { item_count: 0, items: [], total_price: 0, currency: { iso_code: 'EUR' }, note: '' },
    customer: null,
    linklists,
    request: { locale: { iso_code: 'nl' }, page_type: pageType, origin: '' },
    template: { name: templateName, suffix: null },
    canonical_url: file.replace(/index\.html$/, '').replace(/\.html$/, ''),
    page_title: title,
    page_description: data.shop.description,
    current_page: 1,
    ...extra,
  };
  const content = await renderSectionList(tplJSON, scope);
  let html = await engine.render(layoutTpl, { ...scope, content_for_header: demoHead, content_for_layout: content }, { globals: scope });
  html = html.replace('</body>', `${demoFlag}\n</body>`);
  const out = path.join(OUT, file);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, html);
  console.log('  ✓', file);
}

async function copyDir(from, to) {
  await fs.mkdir(to, { recursive: true });
  for (const f of await fs.readdir(from)) await fs.copyFile(path.join(from, f), path.join(to, f));
}

await fs.rm(OUT, { recursive: true, force: true });
await copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));
await fs.mkdir(path.join(OUT, 'demo'), { recursive: true });
await fs.copyFile(path.join(ROOT, 'demo/storefront.js'), path.join(OUT, 'demo/storefront.js'));

console.log('Rendering theme → dist/');
await renderPage({ file: 'index.html', template: 'index', title: 'Wilder Land', pageType: 'index' });
for (const product of Object.values(products)) {
  await renderPage({ file: `products/${product.handle}.html`, template: 'product', title: product.title, pageType: 'product', extra: { product } });
}
await renderPage({ file: 'collections/all.html', template: 'collection', title: 'Shop', pageType: 'collection', extra: { collection: allCollection } });
await renderPage({ file: 'cart.html', template: 'cart', title: 'Winkelwagen', pageType: 'cart' });
await renderPage({ file: `blogs/${blog.handle}.html`, template: 'blog', title: blog.title, pageType: 'blog', extra: { blog } });
for (const article of blog.articles) {
  await renderPage({ file: `blogs/${blog.handle}/${article.handle}.html`, template: 'article', title: article.title, pageType: 'article', extra: { blog, article } });
}
for (const page of data.pages) {
  await renderPage({ file: `pages/${page.handle}.html`, template: 'page', title: page.title, pageType: 'page', extra: { page } });
}
await renderPage({ file: '404.html', template: '404', title: 'Niet gevonden', pageType: '404' });
console.log('Done.');
