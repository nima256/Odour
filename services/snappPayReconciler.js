// Automatic SnappPay "Get Payment Status" reconciliation.
//
// SnappPay requires the merchant to call payment/v1/status automatically so the
// merchant and SnappPay never disagree about a payment (e.g. the customer paid
// but never came back to the callback, a verify/settle response was lost, or the
// server restarted mid-way). This module holds the pure decision logic and a
// small scheduler; the order mutations live in routes/order.js.

const toPositiveMs = (value, fallbackMs, unitMs = 1) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed * unitMs : fallbackMs;
};

const MINUTE = 60 * 1000;

const reconcilerConfig = {
  // How often unresolved SnappPay orders are checked.
  intervalMs: toPositiveMs(process.env.SNAPPPAY_RECONCILE_INTERVAL_MINUTES, 5 * MINUTE, MINUTE),
  // Leave fresh orders alone: the customer may still be on SnappPay's page.
  minAgeMs: toPositiveMs(process.env.SNAPPPAY_RECONCILE_MIN_AGE_MINUTES, 15 * MINUTE, MINUTE),
  // After this, an unpaid order is cancelled locally and its stock released.
  pendingExpireMs: toPositiveMs(process.env.SNAPPPAY_PENDING_EXPIRE_MINUTES, 60 * MINUTE, MINUTE),
  // A processing lock older than this is considered abandoned (crash/restart).
  staleLockMs: toPositiveMs(process.env.SNAPPPAY_STALE_LOCK_MINUTES, 10 * MINUTE, MINUTE),
  batchSize: toPositiveMs(process.env.SNAPPPAY_RECONCILE_BATCH_SIZE, 50),
};

// status → what the merchant must do next, following the documented recovery
// flow (status VERIFY ⇒ settle, PENDING ⇒ verify, SETTLE ⇒ done).
const resolveSnappPayAction = ({ status, ageMs, pendingExpireMs = reconcilerConfig.pendingExpireMs }) => {
  const normalized = String(status || "").trim().toUpperCase();
  if (normalized === "SETTLE") return "settled";
  if (normalized === "VERIFY") return "settle";
  if (normalized === "CANCEL" || normalized === "REVERT") return "cancelled";
  if (normalized === "PENDING") return ageMs >= pendingExpireMs ? "expire" : "verify";
  // Unknown status or status call failed: wait, then give up after the expiry window.
  return ageMs >= pendingExpireMs ? "expire" : "wait";
};

const startSnappPayReconciler = ({ runOnce, intervalMs = reconcilerConfig.intervalMs, logger = console }) => {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runOnce();
    } catch (error) {
      logger.error("[SnappPay][reconcile] run failed:", error.message || error);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  // First pass shortly after startup to pick up anything left by a restart.
  const initial = setTimeout(tick, 30 * 1000);
  initial.unref?.();

  return () => {
    clearInterval(timer);
    clearTimeout(initial);
  };
};

module.exports = {
  reconcilerConfig,
  resolveSnappPayAction,
  startSnappPayReconciler,
};
