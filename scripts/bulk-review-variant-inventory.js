#!/usr/bin/env node
'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const matrix = require('../services/variantMatrix');

const argv = process.argv.slice(2);
const has = x => argv.includes(x);
const arg = (name, fallback = '') => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const mode = has('--apply') ? 'APPLY' : 'DRY RUN';
const database = arg('--database');
const expectedPublished = Number(arg('--expect-published', '0')) || null;
const confirm = arg('--confirm');
const allowProduction = has('--allow-production');
const requestedSha = arg('--plan-sha');
const qty = v => Math.max(0, Number(v) || 0);

function exactPlan(product) {
  if (matrix.configured(product)) return { status: 'confirmed' };
  const colors = matrix.validColors(product);
  const sizes = matrix.validSizes(product);
  const descriptors = matrix.allDescriptors(product);
  let rows = null;
  let reason = '';

  if (!colors.length && !sizes.length) {
    rows = [{ colorId: '', sizeId: '', countInStock: qty(product.countInStock) }];
    reason = 'base-product';
  } else if (colors.length <= 1 && sizes.length <= 1) {
    rows = descriptors.map(d => ({ colorId: d.colorId, sizeId: d.sizeId, countInStock: matrix.legacyAvailableQuantity(product, d.color, d.size) }));
    reason = 'single-combination';
  } else if (colors.length > 1 && sizes.length <= 1 && colors.every(c => c.countInStock !== undefined && c.countInStock !== null)) {
    rows = descriptors.map(d => ({ colorId: d.colorId, sizeId: d.sizeId, countInStock: qty(d.color?.countInStock) }));
    reason = 'exact-color-stock';
  } else if (sizes.length > 1 && colors.length <= 1 && sizes.every(s => s.countInStock !== undefined && s.countInStock !== null)) {
    rows = descriptors.map(d => ({ colorId: d.colorId, sizeId: d.sizeId, countInStock: qty(d.size?.countInStock) }));
    reason = 'exact-size-stock';
  } else {
    return { status: 'review', reason: colors.length > 1 && sizes.length > 1 ? 'color-size-intersection-unknown' : 'shared-stock-cannot-be-split' };
  }

  const before = qty(product.countInStock);
  const after = matrix.totalMatrixStock(rows);
  if (before !== after) return { status: 'review', reason: 'aggregate-stock-mismatch', before, after };
  return { status: 'safe', reason, rows, before, after };
}

(async () => {
  if (mode === 'APPLY' && (!database || confirm !== database || !allowProduction || !requestedSha)) {
    throw new Error('Apply requires --database NAME --confirm NAME --plan-sha SHA --allow-production');
  }
  const uri = process.env.DB_URL || 'mongodb://localhost:27017/odour';
  await mongoose.connect(uri, database ? { dbName: database } : undefined);
  const products = await Product.find({ isPublished: true }).lean();
  if (expectedPublished !== null && products.length !== expectedPublished) throw new Error(`Expected ${expectedPublished} published products, found ${products.length}`);

  const plans = products.map(p => ({ product: p, plan: exactPlan(p) }));
  const safe = plans.filter(x => x.plan.status === 'safe');
  const review = plans.filter(x => x.plan.status === 'review');
  const confirmed = plans.filter(x => x.plan.status === 'confirmed');
  const shaInput = safe.map(x => ({ id: String(x.product._id), revision: Number(x.product.stockRevision || 0), rows: x.plan.rows })).sort((a,b) => a.id.localeCompare(b.id));
  const planSha = crypto.createHash('sha256').update(JSON.stringify(shaInput)).digest('hex');
  const reasonCounts = {};
  review.forEach(x => { reasonCounts[x.plan.reason] = (reasonCounts[x.plan.reason] || 0) + 1; });

  const summary = {
    mode,
    database: mongoose.connection.name,
    published: products.length,
    alreadyConfigured: confirmed.length,
    safeToAutoConfigure: safe.length,
    requiresReview: review.length,
    reasonCounts,
    planSha,
    sampleSafe: safe.slice(0, 8).map(x => ({ id: String(x.product._id), name: x.product.name, reason: x.plan.reason, variants: x.plan.rows.length })),
    sampleNeedsReview: review.slice(0, 8).map(x => ({ id: String(x.product._id), name: x.product.name, reason: x.plan.reason, stock: x.plan.before ?? qty(x.product.countInStock), calculated: x.plan.after })),
    notice: 'The script never guesses a multi-color × multi-size intersection and never changes aggregate inventory.',
  };
  console.log(JSON.stringify(summary, null, 2));

  if (mode === 'APPLY') {
    if (requestedSha !== planSha) throw new Error('Plan SHA changed. Run a new dry-run and use its planSha.');
    const dir = path.join(process.cwd(), '.private-backups', `odour-variant-matrix-${new Date().toISOString().replace(/[:.]/g,'-')}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'BEFORE-APPLY.json'), JSON.stringify(safe.map(x => x.product), null, 2));
    console.log(`Backup written BEFORE DB writes: ${path.join(dir, 'BEFORE-APPLY.json')}`);
    for (const item of safe) {
      const oldRevision = Number(item.product.stockRevision || 0);
      const revisionGuard = oldRevision === 0
        ? { $or: [{ stockRevision: 0 }, { stockRevision: { $exists: false } }] }
        : { stockRevision: oldRevision };
      const result = await Product.updateOne(
        { _id: item.product._id, variantInventoryConfigured: { $ne: true }, ...revisionGuard },
        { $set: { variantInventoryConfigured: true, variantStocks: item.plan.rows }, $inc: { stockRevision: 1 } }
      );
      if (result.modifiedCount !== 1) throw new Error(`Product changed during apply: ${item.product._id}`);
    }
    console.log(`APPLY SUCCESS: configured ${safe.length} strictly inferable products. No quantity, price, image, slug, or order was changed.`);
  } else {
    console.log('DRY RUN COMPLETE: no MongoDB writes.');
  }
  await mongoose.disconnect();
})().catch(async error => {
  console.error(error.stack || error.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exitCode = 1;
});
