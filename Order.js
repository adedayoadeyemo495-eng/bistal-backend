const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  name: String,
  img: String,
  price: { type: Number, required: true },
  qty: { type: Number, required: true, min: 1 }
}, { _id: false });

const orderSchema = new mongoose.Schema({
  orderId: {
    type: String,
    unique: true
  },
  customer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  customerInfo: {
    name: String,
    email: String,
    phone: String
  },
  items: [orderItemSchema],
  address: {
    street: String,
    city: String,
    state: String
  },
  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 1500 },
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
