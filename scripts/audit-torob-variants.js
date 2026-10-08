#!/usr/bin/env node
'use strict';
require('dotenv').config();
const mongoose = require('mongoose');
const Product = require('../models/Product');
const torob = require('../controllers/torobController')._private;
const matrix = require('../services/variantMatrix');

const arg = (name, fallback = '') => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

(async () => {
  const database = arg('--database');
  const uri = process.env.DB_URL || 'mongodb://localhost:27017/odour';
  await mongoose.connect(uri, database ? { dbName: database } : undefined);
  const products = await Product.find({ isPublished: true }).lean();
  const formatted = [];
  const exactFormatted = [];
  const feedErrors = [];
  let configuredProducts = 0;
  let ambiguousProducts = 0;

  for (const product of products) {
    if (matrix.configured(product)) configuredProducts++;
    if (!matrix.configured(product) && matrix.validColors(product).length > 1 && matrix.validSizes(product).length > 1) ambiguousProducts++;
    try {
      for (const descriptor of torob.getProductVariants(product)) {
        formatted.push(torob.formatProductForTorob(product, descriptor));
      }
      for (const descriptor of torob.getExactProductVariants(product)) {
        // Build exact-mode availability independent of the rollout flag.
        const item = torob.formatProductForTorob(product, descriptor);
        const stock = matrix.availableQuantity(product, descriptor.color || null, descriptor.size || null);
        const regular = Number(product.price || 0);
        const offer = Number(product.offerPrice || 0);
        const discounted = offer > 0 && offer < regular;
        item.availability = stock > 0;
        item.current_price = item.availability ? Math.trunc(discounted ? offer : regular) : 0;
        item.old_price = item.availability && discounted ? Math.trunc(regular) : null;
        exactFormatted.push(item);
      }
    } catch (error) {
      feedErrors.push({ id: String(product._id), name: product.name, error: error.message });
    }
  }

  const ids = formatted.map(x => x.page_unique).filter(Boolean);
  const urls = formatted.map(x => x.page_url).filter(Boolean);

  // Reproduce Torob's single-product lookup contract without changing data:
  // every value emitted by the feed must resolve back to the exact same variant.
  const productsById = new Map(products.map((product) => [String(product._id), product]));
  const productsBySlug = new Map();
  for (const product of products) {
    if (product.slug) productsBySlug.set(String(product.slug), product);
    for (const oldSlug of Array.isArray(product.oldSlugs) ? product.oldSlugs : []) {
      if (oldSlug) productsBySlug.set(String(oldSlug), product);
    }
    productsBySlug.set(String(product._id), product);
  }

  let pageUniqueLookupFailures = 0;
  let pageUrlLookupFailures = 0;
  let trackedPageUrlLookupFailures = 0;
  const lookupFailureSamples = [];

  for (const item of formatted) {
    const uniqueRequest = torob.parsePageUnique(item.page_unique);
    const uniqueProduct = uniqueRequest ? productsById.get(uniqueRequest.productId) : null;
    const uniqueVariant = uniqueProduct && uniqueRequest
      ? torob.findVariantByKey(uniqueProduct, uniqueRequest.variantKey)
      : null;
    const uniqueRoundTrip = uniqueVariant ? torob.formatProductForTorob(uniqueProduct, uniqueVariant) : null;
    if (!uniqueRoundTrip || uniqueRoundTrip.page_unique !== item.page_unique) {
      pageUniqueLookupFailures++;
      if (lookupFailureSamples.length < 5) lookupFailureSamples.push({ type: 'page_unique', value: item.page_unique });
    }

    const urlRequest = torob.parseProductPageUrl(item.page_url);
    const urlProduct = urlRequest ? productsBySlug.get(String(urlRequest.slugOrId)) : null;
    const urlVariant = urlProduct && urlRequest ? torob.resolveVariantRequest(urlProduct, urlRequest) : null;
    const urlRoundTrip = urlVariant ? torob.formatProductForTorob(urlProduct, urlVariant) : null;
    if (!urlRoundTrip || urlRoundTrip.page_unique !== item.page_unique) {
      pageUrlLookupFailures++;
      if (lookupFailureSamples.length < 5) lookupFailureSamples.push({ type: 'page_url', value: item.page_url });
    }

    try {
      const tracked = new URL(item.page_url);
      tracked.searchParams.set('utm_source', 'torob');
      tracked.searchParams.set('utm_medium', 'product_sync');
      const trackedRequest = torob.parseProductPageUrl(tracked.toString());
      const trackedProduct = trackedRequest ? productsBySlug.get(String(trackedRequest.slugOrId)) : null;
      const trackedVariant = trackedProduct && trackedRequest ? torob.resolveVariantRequest(trackedProduct, trackedRequest) : null;
      const trackedRoundTrip = trackedVariant ? torob.formatProductForTorob(trackedProduct, trackedVariant) : null;
      if (!trackedRoundTrip || trackedRoundTrip.page_unique !== item.page_unique) trackedPageUrlLookupFailures++;
    } catch (_) {
      trackedPageUrlLookupFailures++;
    }
  }

  const result = {
    mode: 'READ ONLY',
    database: mongoose.connection.name,
    publishedProducts: products.length,
    configuredProducts,
    unconfiguredProducts: products.length - configuredProducts,
    ambiguousUnconfiguredProducts: ambiguousProducts,
    exactVariantsEnabled: torob.EXACT_VARIANTS_ENABLED,
    currentFeedVariants: formatted.length,
    exactFeedVariants: exactFormatted.length,
    totalVariants: formatted.length,
    availableVariants: formatted.filter(x => x.availability === true).length,
    unavailableVariants: formatted.filter(x => x.availability === false).length,
    duplicatePageUniques: ids.length - new Set(ids).size,
    duplicatePageUrls: urls.length - new Set(urls).size,
    variantUrlsMissingCombinationKey: formatted.filter((item) => {
      try {
        const url = new URL(item.page_url);
        const variantKey = url.searchParams.get('variant') || 'base';
        return !String(item.page_unique || '').endsWith(`_${variantKey}`);
      } catch (_) {
        return true;
      }
    }).length,
    availableWithZeroPrice: formatted.filter(x => x.availability === true && !(Number(x.current_price) > 0)).length,
    unavailableWithNonZeroPrice: formatted.filter(x => x.availability === false && Number(x.current_price) !== 0).length,
    missingPageUrl: formatted.filter(x => !x.page_url).length,
    missingPageUnique: formatted.filter(x => !x.page_unique).length,
    pageUniqueLookupFailures,
    pageUrlLookupFailures,
    trackedPageUrlLookupFailures,
    singleProductLookupContractOk: pageUniqueLookupFailures === 0 && pageUrlLookupFailures === 0 && trackedPageUrlLookupFailures === 0,
    lookupFailureSamples,
    exactAvailableVariants: exactFormatted.filter(x => x.availability === true).length,
    exactUnavailableVariants: exactFormatted.filter(x => x.availability === false).length,
    exactAvailableWithZeroPrice: exactFormatted.filter(x => x.availability === true && !(Number(x.current_price) > 0)).length,
    feedErrors,
    sampleVariants: formatted.slice(0, 8).map(x => ({ page_unique: x.page_unique, title: x.title, availability: x.availability, current_price: x.current_price, page_url: x.page_url })),
    rule: 'Configured products use exact color × size rows. Unreviewed multi-color + multi-size products are not invented for Torob.',
  };
  console.log(JSON.stringify(result, null, 2));
  await mongoose.disconnect();
})().catch(async (error) => {
  console.error(error.stack || error.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exitCode = 1;
});
