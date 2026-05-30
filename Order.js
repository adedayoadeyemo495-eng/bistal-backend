const express = require('express');
const router = express.Router();
const Order = require('./Order');
const Product = require('./Product');
const { protect, adminOnly } = require('./auth');

// POST /api/orders — create order (customer must be logged in)
router.post('/', protect, async (req, res) => {
  try {
    const { items, address, paymentMethod, notes } = req.body;

    if (!items || !items.length) return res.status(400).json({ success: false, message: 'No items in order.' });
    if (!address || !address.street || !address.city || !address.state) {
      return res.status(400).json({ success: false, message: 'Delivery address is required.' });
    }

    // Validate items and calculate subtotal
    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = await Product.findById(item.productId);
      if (!product || !product.isActive) {
        return res.status(400).json({ success: false, message: `Product not found: ${item.productId}` });
      }
      subtotal += product.price * item.qty;
      orderItems.push({
        product: product._id,
        name: product.name,
        img: product.img,
        price: product.price,
        qty: item.qty
      });
      // Increment sold count
      await Product.findByIdAndUpdate(product._id, { $inc: { soldCount: item.qty } });
    }

    const deliveryFee = 1500;
    const total = subtotal + deliveryFee;

    const order = await Order.create({
      customer: req.user._id,
      customerInfo: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone
      },
      items: orderItems,
      address,
      subtotal,
      deliveryFee,
      total,
      paymentMethod: paymentMethod || 'bank',
      notes
    });

    // Build WhatsApp message
    const itemsList = orderItems.map(i => `${i.name} ×${i.qty} = ₦${(i.price * i.qty).toLocaleString()}`).join('\n');
    const waMsg = `*🛍️ New Bistal Order — ${order.orderId}*\n\n*Customer:* ${req.user.name}\n*Phone:* ${req.user.phone || 'N/A'}\n*Email:* ${req.user.email || 'N/A'}\n*Address:* ${address.street}, ${address.city}, ${address.state}\n\n*Items:*\n${itemsList}\n\n*Subtotal:* ₦${subtotal.toLocaleString()}\n*Delivery:* ₦${deliveryFee.toLocaleString()}\n*Total:* ₦${total.toLocaleString()}\n*Payment:* ${paymentMethod || 'bank'}\n\n_Quality Sourced. Quality Delivered._`;

    const waUrl = `https://wa.me/${process.env.WHATSAPP_NUMBER}?text=${encodeURIComponent(waMsg)}`;

    res.status(201).json({
      success: true,
      message: 'Order placed successfully!',
      order,
      whatsappUrl: waUrl
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/orders/my — customer's own orders
router.get('/my', protect, async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 }).limit(20);
    res.json({ success: true, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/orders/track/:orderId — public order tracking
router.get('/track/:orderId', async (req, res) => {
  try {
    const order = await Order.findOne({ orderId: req.params.orderId })
      .select('orderId orderStatus paymentStatus total customerInfo createdAt address');
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    res.json({ success: true, order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── ADMIN ROUTES ──

// GET /api/orders — all orders (admin)
router.get('/', protect, adminOnly, async (req, res) => {
  try {
    const { status, page = 1, limit = 30 } = req.query;
    const filter = {};
    if (status) filter.orderStatus = status;

    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)).populate('customer', 'name email phone'),
      Order.countDocuments(filter)
    ]);

    res.json({ success: true, total, orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/orders/:id/status — update order status (admin)
router.patch('/:id/status', protect, adminOnly, async (req, res) => {
  try {
    const { orderStatus, paymentStatus } = req.body;
    const update = {};
    if (orderStatus) update.orderStatus = orderStatus;
    if (paymentStatus) update.paymentStatus = paymentStatus;

    const order = await Order.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });

    res.json({ success: true, message: 'Order updated.', order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/orders/stats — dashboard stats (admin)
router.get('/admin/stats', protect, adminOnly, async (req, res) => {
  try {
    const [
      totalOrders,
      totalRevenue,
      pendingOrders,
      paidOrders,
      recentOrders
    ] = await Promise.all([
      Order.countDocuments(),
      Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]),
      Order.countDocuments({ orderStatus: 'pending' }),
      Order.countDocuments({ paymentStatus: 'paid' }),
      Order.find().sort({ createdAt: -1 }).limit(5).populate('customer', 'name')
    ]);

    res.json({
      success: true,
      stats: {
        totalOrders,
        totalRevenue: totalRevenue[0]?.total || 0,
        pendingOrders,
        paidOrders,
        recentOrders
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;  deliveryFee: { type: Number, default: 1500 },
  total: { type: Number, required: true },
  paymentMethod: {
    type: String,
    enum: ['bank', 'remita', 'paystack'],
    default: 'bank'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'failed'],
    default: 'pending'
  },
  orderStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'],
    default: 'pending'
  },
  notes: String,
  whatsappSent: { type: Boolean, default: false }
}, { timestamps: true });

// Auto-generate order ID before save
orderSchema.pre('save', function(next) {
  if (!this.orderId) {
    this.orderId = 'BST-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Order', orderSchema);
