// Idempotent startup migrations. Safe to run on every boot.
const User = require("../models/User");
const Product = require("../models/Product");

// Phone + OTP accounts have no email. The original schema created a plain
// unique index on `email`, which treats every missing email as `null` and
// would reject the second email-less account. Replace it with a partial
// unique index that only covers real email strings.
async function ensureUserEmailIndex() {
  const collection = User.collection;
  let indexes = [];
  try {
    indexes = await collection.indexes();
  } catch (error) {
    if (error.codeName === "NamespaceNotFound") return; // fresh database
    throw error;
  }

  const current = indexes.find((index) => index.name === "email_1");
  if (current && !current.partialFilterExpression) {
    await collection.dropIndex("email_1");
    console.log("[migration] dropped legacy non-partial users.email_1 index");
  }

  await collection.createIndex(
    { email: 1 },
    { name: "email_1", unique: true, partialFilterExpression: { email: { $type: "string" } } }
  );
}

// Backfill Product.finalPrice for products saved before the field existed.
async function backfillFinalPrice() {
  const cursor = Product.find({ finalPrice: { $exists: false } })
    .select("price offerPrice")
    .lean()
    .cursor();
  let ops = [];
  let total = 0;
  for await (const product of cursor) {
    ops.push({
      updateOne: {
        filter: { _id: product._id },
        update: { $set: { finalPrice: Product.computeFinalPrice(product.price, product.offerPrice) } },
      },
    });
    if (ops.length === 500) {
      await Product.bulkWrite(ops, { ordered: false });
      total += ops.length;
      ops = [];
    }
  }
  if (ops.length) {
    await Product.bulkWrite(ops, { ordered: false });
    total += ops.length;
  }
  if (total) console.log(`[migration] backfilled finalPrice on ${total} products`);
}

async function runStartupMigrations() {
  // Never block the site from starting because of a migration.
  await ensureUserEmailIndex().catch((error) => console.error("[migration] users.email index:", error.message));
  await backfillFinalPrice().catch((error) => console.error("[migration] finalPrice:", error.message));
}

module.exports = { runStartupMigrations };
