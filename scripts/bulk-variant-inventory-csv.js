#!/usr/bin/env node
'use strict';
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Bulk = require('../lib/bulkVariantInventoryCsv');

const argv = process.argv.slice(2);
const action = argv[0];
const flag = (name) => argv.includes(name);
const arg = (name, fallback = '') => {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? String(argv[index + 1]) : fallback;
};
const database = arg('--database');
const allowTotalChanges = flag('--allow-total-changes');
const usage = 'Usage: node scripts/bulk-variant-inventory-csv.js export --database DB --expect-published COUNT | check --database DB --file CSV --manifest JSON [--allow-total-changes] | apply --database DB --file CSV --manifest JSON --confirm DB --plan-sha SHA --expect-products COUNT --expect-total-delta INTEGER --expect-changed-totals COUNT --allow-production [--allow-total-changes]';
const shaRx = /^[0-9a-f]{64}$/;

const projection = {
  _id: 1, name: 1, isPublished: 1, colors: 1, sizes: 1,
  variantInventoryConfigured: 1, variantStocks: 1, countInStock: 1,
  isOutOfStock: 1, stockRevision: 1, updatedAt: 1, price: 1,
  offerPrice: 1, slug: 1, images: 1,
};

const folder = (prefix) => {
  const dir = path.join(process.cwd(), '.private-backups', `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
};
const writePrivate = (file, body) => fs.writeFileSync(file, body, { flag: 'wx', mode: 0o600 });

async function lockedProductIds(db, ids) {
  if (!ids.length) return [];
  const orders = await db.collection('orders').find({
    'products.product': { $in: ids },
    inventoryReserved: true,
    inventoryRestored: { $ne: true },
    status: { $nin: ['لغو شده', 'تحویل داده شد'] },
  }, { projection: { 'products.product': 1 } }).toArray();
  const selected = new Set(ids.map(String));
  const locked = new Set();
  for (const order of orders) {
    for (const item of order.products || []) {
      const id = String(item.product || '');
      if (selected.has(id)) locked.add(id);
    }
  }
  return [...locked];
}

(async () => {
  if (!['export', 'check', 'apply'].includes(action) || !database) throw new Error(usage);
  if (action === 'export' && !/^\d+$/.test(arg('--expect-published'))) throw new Error(usage);
  if (action !== 'export' && (!arg('--file') || !arg('--manifest'))) throw new Error(usage);
  if (action === 'apply') {
    if (arg('--confirm') !== database || !shaRx.test(arg('--plan-sha')) || !flag('--allow-production') ||
      !/^\d+$/.test(arg('--expect-products')) || !/^[+-]?\d+$/.test(arg('--expect-total-delta')) ||
      !/^\d+$/.test(arg('--expect-changed-totals'))) throw new Error(`Apply safety flags missing. ${usage}`);
  }

  const uri = process.env.DB_URL || 'mongodb://localhost:27017/odour';
  await mongoose.connect(uri, { dbName: database, serverSelectionTimeoutMS: 8000 });
  const db = mongoose.connection.db;
  if (db.databaseName !== database) throw new Error(`WRONG DATABASE: connected to ${db.databaseName}; expected ${database}.`);

  if (action === 'export') {
    const docs = await Product.find({ isPublished: true }).select(projection).sort({ _id: 1 }).lean();
    const expected = Number(arg('--expect-published'));
    if (docs.length !== expected) throw new Error(`Published count changed: expected ${expected}; got ${docs.length}.`);
    const out = Bulk.createExport(docs, database);
    const dir = folder('odour-bulk-variant-csv');
    const csvFile = path.join(dir, 'inventory-input.csv');
    const manifestFile = path.join(dir, 'inventory-manifest.json');
    writePrivate(csvFile, out.table);
    writePrivate(manifestFile, `${JSON.stringify(out.manifest, null, 2)}\n`);
    const skipReasons = {};
    out.skipped.forEach((item) => { skipReasons[item.reason] = (skipReasons[item.reason] || 0) + 1; });
    console.log(JSON.stringify({
      mode: 'EXPORT / NO DB WRITES',
      database,
      published: docs.length,
      exportedProducts: out.eligible,
      editableRows: out.manifest.products.reduce((sum, p) => sum + p.pairs.length, 0),
      skippedProducts: out.skipped.length,
      skipReasons,
      skippedExamples: out.skipped.slice(0, 8),
      csvFile,
      manifestFile,
      instructions: 'Edit ONLY offer_YES_NO and new_stock. YES = real combination (zero stock allowed). NO = nonexistent combination and new_stock must be 0. Complete every row of any product you edit. Save UTF-8 CSV.',
    }, null, 2));
    return;
  }

  const csvFile = path.resolve(arg('--file'));
  const manifestFile = path.resolve(arg('--manifest'));
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.database !== database) throw new Error('Manifest database does not match --database.');
  const csvRows = Bulk.parseCsv(fs.readFileSync(csvFile, 'utf8'));
  const ids = manifest.products.map((p) => new mongoose.Types.ObjectId(p.id));
  const docs = await Product.find({ _id: { $in: ids } }).select(projection).lean();
  const result = Bulk.preview(manifest, csvRows, docs, { allowTotalChanges });
  const locked = await lockedProductIds(db, result.selectedProducts.map((x) => new mongoose.Types.ObjectId(x.id)));
  const valid = Boolean(result.planSha) && !locked.length;
  const report = {
    mode: action.toUpperCase(),
    database,
    allowTotalChanges,
    exportedProducts: result.exportedProducts,
    selected: result.selected,
    untouched: result.untouched,
    partial: result.partial,
    stale: result.stale,
    invalid: result.invalid,
    totalBefore: result.totalBefore,
    totalAfter: result.totalAfter,
    totalDelta: result.totalDelta,
    changedTotals: result.changedTotals,
    combinationsBefore: result.combinationsBefore,
    combinationsAfter: result.combinationsAfter,
    lockedActiveOrders: locked,
    sampleSelected: result.sampleSelected,
    partialSamples: result.partialSamples,
    staleSamples: result.staleSamples,
    errorSamples: result.errorSamples,
    planSha: valid ? result.planSha : null,
    readyToApply: valid,
    notice: 'No shared stock is copied to every combination. Only explicit YES rows become real matrix combinations. Apply backs up full affected product documents before writes.',
  };

  if (action === 'check') {
    const dir = folder('odour-bulk-variant-check');
    const reportFile = path.join(dir, 'report.json');
    writePrivate(reportFile, `${JSON.stringify(report, null, 2)}\n`);
    report.reportFile = reportFile;
    console.log(JSON.stringify(report, null, 2));
    if (!valid) process.exitCode = 2;
    return;
  }

  if (!valid || result.planSha !== arg('--plan-sha') || result.selected !== Number(arg('--expect-products')) ||
    result.totalDelta !== Number(arg('--expect-total-delta')) || result.changedTotals !== Number(arg('--expect-changed-totals'))) {
    throw new Error(`Preflight does NOT match confirmed check. NO WRITES. ${JSON.stringify(report)}`);
  }

  const dir = folder('odour-bulk-variant-apply');
  const selectedIds = new Set(result.selectedProducts.map((x) => x.id));
  const backupDocs = docs.filter((p) => selectedIds.has(String(p._id)));
  const backupFile = path.join(dir, 'BEFORE-APPLY.json');
  writePrivate(backupFile, `${JSON.stringify({ database, date: new Date().toISOString(), planSha: result.planSha, records: backupDocs }, null, 2)}\n`);
  console.log(`Backup written BEFORE DB writes: ${backupFile}`);

  let changed = 0;
  for (const proposal of result.selectedProducts) {
    const id = new mongoose.Types.ObjectId(proposal.id);
    const live = await Product.findById(id).select(projection).lean();
    if (!live || Bulk.snapshotHash(live) !== proposal.snapshot) throw new Error(`Concurrent change detected for ${proposal.id}. STOP after ${changed} product(s). Backup: ${backupFile}`);
    const active = await lockedProductIds(db, [id]);
    if (active.length) throw new Error(`Active reserved order found for ${proposal.id}. STOP after ${changed} product(s). Backup: ${backupFile}`);
    const oldRevision = Number(live.stockRevision || 0);
    const revisionGuard = oldRevision === 0
      ? { $or: [{ stockRevision: 0 }, { stockRevision: { $exists: false } }] }
      : { stockRevision: oldRevision };
    const resultWrite = await Product.updateOne({
      _id: id,
      isPublished: true,
      variantInventoryConfigured: { $ne: true },
      ...revisionGuard,
    }, {
      $set: {
        variantInventoryConfigured: true,
        variantStocks: proposal.variantStocks,
        countInStock: proposal.newTotal,
        isOutOfStock: proposal.newTotal === 0,
      },
      $inc: { stockRevision: 1 },
    });
    if (resultWrite.matchedCount !== 1 || resultWrite.modifiedCount !== 1) {
      throw new Error(`Concurrent write for ${proposal.id}. STOP after ${changed} product(s). Backup: ${backupFile}`);
    }
    changed += 1;
  }
  console.log(`APPLY SUCCESS: ${changed} product(s) converted to exact color × size inventory. BACKUP: ${backupFile}. Prices, media, slugs and orders untouched.`);
})().catch((error) => {
  console.error('[Odour bulk variant CSV] ERROR:', error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
});
