const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateOrderSummary, computeDashboardMetrics, canManageStore, isAssignableStoreRole } = require('../src/business.js');

test('calculateOrderSummary totals subtotal, fee and grand total correctly', () => {
  const summary = calculateOrderSummary([
    { quantity: 2, price: 80000 },
    { quantity: 1, price: 45000 }
  ], 15000);

  assert.equal(summary.subtotal, 205000);
  assert.equal(summary.deliveryFee, 15000);
  assert.equal(summary.total, 220000);
});

test('dashboard metrics exclude cancelled orders and count completed revenue only', () => {
  const metrics = computeDashboardMetrics([
    { totalAmount: 50000, status: 'Sold/Completed' },
    { totalAmount: 75000, status: 'Sold/Completed' },
    { totalAmount: 100000, status: 'Cancelled' },
    { totalAmount: 30000, status: 'Pending' }
  ]);

  assert.equal(metrics.totalSales, 125000);
  assert.equal(metrics.orders, 2);
  assert.equal(metrics.completedOrders, 2);
});

test('store operations are available to admins and staff only', () => {
  assert.equal(canManageStore('admin'), true);
  assert.equal(canManageStore('staff'), true);
  assert.equal(canManageStore('customer'), false);
  assert.equal(canManageStore(undefined), false);
});

test('only customer and staff roles can be assigned to user accounts', () => {
  assert.equal(isAssignableStoreRole('staff'), true);
  assert.equal(isAssignableStoreRole('customer'), true);
  assert.equal(isAssignableStoreRole('admin'), false);
  assert.equal(isAssignableStoreRole('unknown'), false);
});
