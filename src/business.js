function calculateOrderSummary(items = [], deliveryFee = 0) {
  const subtotal = (items || []).reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0);
  const total = subtotal + Number(deliveryFee || 0);

  return {
    subtotal,
    deliveryFee: Number(deliveryFee || 0),
    total,
  };
}

function computeDashboardMetrics(orders = []) {
  const completedOrders = (orders || []).filter((order) => order.status === 'Sold/Completed');
  const totalSales = completedOrders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
  const pendingOrders = (orders || []).filter((order) => order.status === 'Pending').length;

  return {
    totalSales,
    productsSold: completedOrders.reduce((sum, order) => sum + Number(order.productsSold || 0), 0),
    orders: completedOrders.length,
    completedOrders: completedOrders.length,
    pendingOrders,
  };
}

function canManageStore(role) {
  return role === 'admin' || role === 'staff';
}

function isAssignableStoreRole(role) {
  return role === 'customer' || role === 'staff';
}

module.exports = {
  calculateOrderSummary,
  computeDashboardMetrics,
  canManageStore,
  isAssignableStoreRole,
};
