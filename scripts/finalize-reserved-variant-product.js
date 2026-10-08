#!/usr/bin/env node
'use strict';
require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Product = require('../models/Product');
const Order = require('../models/Order');
const Bulk = require('../lib/bulkVariantInventoryCsv');

const argv = process.argv.slice(2);
const action = argv[0];
const flag = (name) => argv.includes(name);
const arg = (name, fallback = '') => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? String(argv[i + 1]) : fallback;
};
const database = arg('--database');
const file = arg('--file');
const manifestFile = arg('--manifest');
const productId = arg('--product-id');
const orderNum = arg('--order-num');
const shaRx = /^[0-9a-f]{64}$/;
const usage = 'Usage: check|apply --database DB --file CSV --manifest JSON --product-id ID --order-num ORD [--allow-total-changes] [apply: --confirm DB --plan-sha SHA --expect-new-total N --expect-order-qty N --allow-production]';

const hash = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const folder = (prefix) => {
  const dir = path.join(process.cwd(), '.private-backups', `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  return dir;
};
const writePrivate = (filePath, body) => fs.writeFileSync(filePath, body, { flag: 'wx', mode: 0o600 });

const projection = {
  _id: 1, name: 1, isPublished: 1, colors: 1, sizes: 1,
  variantInventoryConfigured: 1, variantStocks: 1, countInStock: 1,
  isOutOfStock: 1, stockRevision: 1, updatedAt: 1, price: 1,
  offerPrice: 1, slug: 1, images: 1,
};

function buildMiniManifest(manifest, id) {
  const group = (manifest.products || []).find((p) => String(p.id) === String(id));
  if (!group) throw new Error(`Product ${id} is not present in the manifest.`);
  return { ...manifest, products: [group] };
}

function filterRowsForGroup(rows, group) {
  const allowed = new Set(group.pairs.map((p) => p.rowId));
  return rows.filter((row) => allowed.has(row.row_id));
}

async function inspect() {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestFile), 'utf8'));
  if (manifest.database !== database) throw new Error('Manifest database does not match --database.');
  const mini = buildMiniManifest(manifest, productId);
  const group = mini.products[0];
  const rows = filterRowsForGroup(Bulk.parseCsv(fs.readFileSync(path.resolve(file), 'utf8')), group);
  if (rows.length !== group.pairs.length) throw new Error('CSV rows for the target product are incomplete.');

  const product = await Product.findById(productId).select(projection).lean();
  if (!product) throw new Error('Target product not found.');
  const preview = Bulk.preview(mini, rows, [product], { allowTotalChanges: flag('--allow-total-changes') });
  if (preview.selected !== 1 || preview.partial || preview.stale || preview.invalid || !preview.planSha) {
    throw new Error(`Target product is not ready from CSV: ${JSON.stringify({ selected: preview.selected, partial: preview.partial, stale: preview.stale, invalid: preview.invalid, errors: preview.errorSamples })}`);
  }
  const proposal = preview.selectedProducts[0];

  const order = await Order.findOne({ OrderNum: orderNum, 'products.product': product._id }).lean();
  if (!order) throw new Error(`Order ${orderNum} containing product ${productId} not found.`);
  if (order.paymentStatus !== 'پرداخت شده') throw new Error(`Order paymentStatus is ${order.paymentStatus}; expected پرداخت شده.`);
  if (order.inventoryReserved !== true || order.inventoryRestored === true) throw new Error('Order inventory is not currently reserved.');
  if (order.status === 'لغو شده' || order.status === 'تحویل داده شد') throw new Error(`Order status ${order.status} does not need reserved-order migration.`);

  const matchingItems = (order.products || []).filter((item) => String(item.product) === String(product._id));
  if (!matchingItems.length) throw new Error('No matching order item found.');
  const validPairs = new Set(proposal.variantStocks.map((row) => `${String(row.colorId || '')}|${String(row.sizeId || '')}`));
  const invalidItems = [];
  for (const item of matchingItems) {
    const key = `${String(item.selectedVariantId || '')}|${String(item.selectedSizeId || '')}`;
    if (!validPairs.has(key)) invalidItems.push({ itemId: String(item._id), key });
  }
  if (invalidItems.length) throw new Error(`Reserved order points to pair(s) not present in the new matrix: ${JSON.stringify(invalidItems)}`);

  const orderQty = matchingItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const plan = {
    database,
    productId: String(product._id),
    productSnapshot: proposal.snapshot,
    newTotal: proposal.newTotal,
    variantStocks: proposal.variantStocks,
    orderId: String(order._id),
    orderNum: order.OrderNum,
    orderStatus: order.status,
    paymentStatus: order.paymentStatus,
    inventoryReserved: order.inventoryReserved,
    inventoryRestored: order.inventoryRestored,
    orderItems: matchingItems.map((item) => ({
      id: String(item._id),
      quantity: Number(item.quantity),
      selectedVariantId: String(item.selectedVariantId || ''),
      selectedSizeId: String(item.selectedSizeId || ''),
      variantStockTracked: item.variantStockTracked === true,
    })),
  };
  return { product, order, proposal, matchingItems, orderQty, plan, planSha: hash(plan) };
}

(async () => {
  if (!['check', 'apply'].includes(action) || !database || !file || !manifestFile || !productId || !orderNum) throw new Error(usage);
  if (!flag('--allow-total-changes')) throw new Error('This migration changes aggregate stock; --allow-total-changes is required.');
  if (action === 'apply') {
    if (arg('--confirm') !== database || !shaRx.test(arg('--plan-sha')) || !flag('--allow-production') ||
      !/^\d+$/.test(arg('--expect-new-total')) || !/^\d+$/.test(arg('--expect-order-qty'))) throw new Error(`Apply safety flags missing. ${usage}`);
  }

  const uri = process.env.DB_URL || 'mongodb://localhost:27017/odour';
  await mongoose.connect(uri, { dbName: database, serverSelectionTimeoutMS: 8000 });
  if (mongoose.connection.db.databaseName !== database) throw new Error(`WRONG DATABASE: ${mongoose.connection.db.databaseName}`);

  const state = await inspect();
  const report = {
    mode: action.toUpperCase(),
    database,
    product: {
      id: productId,
      name: state.product.name,
      oldTotal: Number(state.product.countInStock || 0),
      newTotal: state.proposal.newTotal,
      combinations: state.proposal.variantStocks.length,
    },
    order: {
      orderNum: state.order.OrderNum,
      status: state.order.status,
      paymentStatus: state.order.paymentStatus,
      inventoryReserved: state.order.inventoryReserved,
      inventoryRestored: state.order.inventoryRestored,
      quantityForProduct: state.orderQty,
      rows: state.matchingItems.map((item) => ({
        itemId: String(item._id),
        quantity: Number(item.quantity),
        selectedColor: item.selectedColor || null,
        selectedVariantId: item.selectedVariantId || null,
        selectedSize: item.selectedSize || null,
        selectedSizeId: item.selectedSizeId || null,
        variantStockTrackedBefore: item.variantStockTracked === true,
      })),
    },
    action: 'Product will be converted to exact matrix and the already-reserved order row will be marked variantStockTracked so a future cancellation restores the exact pair.',
    planSha: state.planSha,
    readyToApply: true,
  };

  if (action === 'check') {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (arg('--plan-sha') !== state.planSha || Number(arg('--expect-new-total')) !== state.proposal.newTotal || Number(arg('--expect-order-qty')) !== state.orderQty) {
    throw new Error(`Live state no longer matches confirmed check. NO WRITES. ${JSON.stringify(report)}`);
  }

  const dir = folder('odour-finalize-reserved-variant');
  const backupFile = path.join(dir, 'BEFORE-APPLY.json');
  writePrivate(backupFile, `${JSON.stringify({
    database,
    createdAt: new Date().toISOString(),
    planSha: state.planSha,
    product: state.product,
    order: state.order,
  }, null, 2)}\n`);
  console.log(`Backup written BEFORE DB writes: ${backupFile}`);

  const revision = Number(state.product.stockRevision || 0);
  const revisionGuard = revision === 0
    ? { $or: [{ stockRevision: 0 }, { stockRevision: { $exists: false } }] }
    : { stockRevision: revision };

  const productWrite = await Product.updateOne({
    _id: state.product._id,
    isPublished: true,
    variantInventoryConfigured: { $ne: true },
    ...revisionGuard,
  }, {
    $set: {
      variantInventoryConfigured: true,
      variantStocks: state.proposal.variantStocks,
      countInStock: state.proposal.newTotal,
      isOutOfStock: state.proposal.newTotal === 0,
    },
    $inc: { stockRevision: 1 },
  });
  if (productWrite.matchedCount !== 1 || productWrite.modifiedCount !== 1) throw new Error(`Product concurrent change. NO order write. Backup: ${backupFile}`);

  try {
    const itemIds = state.matchingItems.map((item) => item._id);
    const orderWrite = await Order.updateOne({
      _id: state.order._id,
      OrderNum: state.order.OrderNum,
      paymentStatus: 'پرداخت شده',
      inventoryReserved: true,
      inventoryRestored: { $ne: true },
    }, {
      $set: {
        'products.$[item].variantStockTracked': true,
        'products.$[item].colorStockTracked': false,
        'products.$[item].sizeStockTracked': false,
      },
    }, {
      arrayFilters: [{ 'item._id': { $in: itemIds } }],
    });
    if (orderWrite.matchedCount !== 1 || orderWrite.modifiedCount !== 1) throw new Error('Reserved order changed concurrently.');
  } catch (error) {
    await Product.collection.replaceOne({ _id: state.product._id }, state.product);
    throw new Error(`${error.message} Product was rolled back from in-memory backup. Full backup: ${backupFile}`);
  }

  console.log(`APPLY SUCCESS: product ${productId} converted and order ${orderNum} tracking migrated safely. Backup: ${backupFile}`);
})().catch((error) => {
  console.error('[Odour finalize reserved variant] ERROR:', error.stack || error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState) await mongoose.disconnect();
});
