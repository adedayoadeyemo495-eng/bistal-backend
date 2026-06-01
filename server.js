require('dotenv').config();
const express = require('express');
const path = require('path');
const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── CORS ──
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// ── SERVE FRONTEND ──
app.use(express.static(path.join(__dirname, 'public')));

// ── HEALTH CHECK ──
app.get('/api/health', function(req, res) {
  res.json({ success: true, message: '🟢 Bistal API is running', version: '1.0.0', time: new Date().toISOString() });
});

// ── CHECK IF MONGODB IS CONFIGURED ──
const MONGO_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'bistal_default_secret';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'bistal2025';
const WA_NUMBER = process.env.WHATSAPP_NUMBER || '2348084942859';

if (!MONGO_URI) {
  console.log('⚠️  No MONGODB_URI set — running in standalone mode (no database)');
  // Still serve the frontend
  app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, function() {
    console.log('🚀 Bistal server running on port ' + PORT + ' (no database)');
  });
} else {
  // ── MONGODB MODE ──
  const mongoose = require('mongoose');
  const bcrypt = require('bcryptjs');
  const jwt = require('jsonwebtoken');

  // ── SCHEMAS ──
  const UserSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    phone: { type: String, unique: true, sparse: true, trim: true },
    password: { type: String, required: true, minlength: 6, select: false },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    isActive: { type: Boolean, default: true },
    lastLogin: Date
  }, { timestamps: true });

  UserSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    this.password = await bcrypt.hash(this.password, 12);
    next();
  });
  UserSchema.methods.comparePassword = async function(pw) {
    return await bcrypt.compare(pw, this.password);
  };
  UserSchema.methods.toJSON = function() {
    const obj = this.toObject();
    delete obj.password;
    return obj;
  };

  const ProductSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    brand: { type: String, default: 'BistalPower™' },
    description: { type: String, default: '' },
    price: { type: Number, required: true, min: 0 },
    oldPrice: { type: Number, default: null },
    rating: { type: Number, default: 4.5, min: 1, max: 5 },
    stock: { type: Number, default: 100 },
    img: { type: String, default: '' },
    category: { type: String, default: 'general' },
    tags: {
      featured: { type: Boolean, default: false },
      flash: { type: Boolean, default: false },
      isNew: { type: Boolean, default: false }
    },
    isActive: { type: Boolean, default: true },
    soldCount: { type: Number, default: 0 }
  }, { timestamps: true });

  const OrderSchema = new mongoose.Schema({
    orderId: { type: String, unique: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customerInfo: { name: String, email: String, phone: String },
    items: [{
      product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' },
      name: String, img: String,
      price: { type: Number, required: true },
      qty: { type: Number, required: true, min: 1 }
    }],
    address: { street: String, city: String, state: String },
    subtotal: { type: Number, required: true },
    deliveryFee: { type: Number, default: 1500 },
    total: { type: Number, required: true },
    paymentMethod: { type: String, default: 'bank' },
    paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    orderStatus: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
    notes: String
  }, { timestamps: true });

  OrderSchema.pre('save', function(next) {
    if (!this.orderId) {
      this.orderId = 'BST-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
    }
    next();
  });

  const User = mongoose.model('User', UserSchema);
  const Product = mongoose.model('Product', ProductSchema);
  const Order = mongoose.model('Order', OrderSchema);

  // ── AUTH MIDDLEWARE ──
  function signToken(id) {
    return jwt.sign({ id: id }, JWT_SECRET, { expiresIn: '7d' });
  }

  async function protect(req, res, next) {
    try {
      let token;
      if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
      }
      if (!token) return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
      const decoded = jwt.verify(token, JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return res.status(401).json({ success: false, message: 'User not found.' });
      req.user = user;
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
    }
  }

  function adminOnly(req, res, next) {
    if (req.user && req.user.role === 'admin') return next();
    return res.status(403).json({ success: false, message: 'Admin access required.' });
  }

  // ═══════════════════════════════
  // AUTH ROUTES
  // ═══════════════════════════════

  // Register
  app.post('/api/auth/register', async function(req, res) {
    try {
      const { name, email, phone, password } = req.body;
      if (!name || !password) return res.status(400).json({ success: false, message: 'Name and password are required.' });
      if (!email && !phone) return res.status(400).json({ success: false, message: 'Email or phone is required.' });
      const query = email ? { email: email.toLowerCase() } : { phone: phone };
      const existing = await User.findOne(query);
      if (existing) return res.status(409).json({ success: false, message: 'Account already exists. Please login.' });
      const user = await User.create({ name, email, phone, password });
      const token = signToken(user._id);
      res.status(201).json({ success: true, message: 'Welcome to Bistal, ' + name.split(' ')[0] + '! 🎉', token, user });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Login
  app.post('/api/auth/login', async function(req, res) {
    try {
      const { identity, password } = req.body;
      if (!identity || !password) return res.status(400).json({ success: false, message: 'Email/phone and password are required.' });
      const isEmail = identity.includes('@');
      const query = isEmail ? { email: identity.toLowerCase() } : { phone: identity };
      const user = await User.findOne(query).select('+password');
      if (!user || !(await user.comparePassword(password))) {
        return res.status(401).json({ success: false, message: 'Incorrect email/phone or password.' });
      }
      user.lastLogin = Date.now();
      await user.save({ validateBeforeSave: false });
      const token = signToken(user._id);
      res.json({ success: true, message: 'Welcome back, ' + user.name.split(' ')[0] + '! 👋', token, user });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Admin login
  app.post('/api/auth/admin-login', async function(req, res) {
    try {
      const { password } = req.body;
      if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ success: false, message: 'Wrong admin password.' });
      }
      let admin = await User.findOne({ role: 'admin' });
      if (!admin) {
        admin = await User.create({ name: 'Bistal Admin', email: 'admin@bistal.com', password: ADMIN_PASSWORD, role: 'admin' });
      }
      const token = signToken(admin._id);
      res.json({ success: true, token, user: admin });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Get current user
  app.get('/api/auth/me', protect, async function(req, res) {
    try {
      const user = await User.findById(req.user._id).populate('wishlist', 'name price img');
      res.json({ success: true, user });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Toggle wishlist
  app.post('/api/auth/wishlist/:productId', protect, async function(req, res) {
    try {
      const user = await User.findById(req.user._id);
      const pid = req.params.productId;
      const idx = user.wishlist.indexOf(pid);
      let action;
      if (idx === -1) { user.wishlist.push(pid); action = 'added'; }
      else { user.wishlist.splice(idx, 1); action = 'removed'; }
      await user.save();
      res.json({ success: true, action, wishlist: user.wishlist });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ═══════════════════════════════
  // PRODUCT ROUTES
  // ═══════════════════════════════

  // Get all products
  app.get('/api/products', async function(req, res) {
    try {
      const { featured, flash, isNew, maxPrice, minPrice, sort, search, limit, page } = req.query;
      const filter = { isActive: true };
      if (featured === 'true') filter['tags.featured'] = true;
      if (flash === 'true') filter['tags.flash'] = true;
      if (isNew === 'true') filter['tags.isNew'] = true;
      if (maxPrice) filter.price = { $lte: Number(maxPrice) };
      if (minPrice) filter.price = Object.assign(filter.price || {}, { $gte: Number(minPrice) });
      if (search) filter.$or = [{ name: { $regex: search, $options: 'i' } }, { brand: { $regex: search, $options: 'i' } }];
      let sortObj = { soldCount: -1, createdAt: -1 };
      if (sort === 'price_asc') sortObj = { price: 1 };
      else if (sort === 'price_desc') sortObj = { price: -1 };
      else if (sort === 'rating') sortObj = { rating: -1 };
      const lim = Number(limit) || 100;
      const skip = (Number(page || 1) - 1) * lim;
      const products = await Product.find(filter).sort(sortObj).skip(skip).limit(lim);
      const total = await Product.countDocuments(filter);
      res.json({ success: true, total, products });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Get one product
  app.get('/api/products/:id', async function(req, res) {
    try {
      const product = await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
      res.json({ success: true, product });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Create product (admin)
  app.post('/api/products', protect, adminOnly, async function(req, res) {
    try {
      const product = await Product.create(req.body);
      res.status(201).json({ success: true, message: 'Product created.', product });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  // Update product (admin)
  app.patch('/api/products/:id', protect, adminOnly, async function(req, res) {
    try {
      const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
      if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
      res.json({ success: true, message: 'Product updated.', product });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  // Delete product (admin)
  app.delete('/api/products/:id', protect, adminOnly, async function(req, res) {
    try {
      await Product.findByIdAndUpdate(req.params.id, { isActive: false });
      res.json({ success: true, message: 'Product deleted.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Seed default products (admin)
  app.post('/api/products/seed/defaults', protect, adminOnly, async function(req, res) {
    try {
      const count = await Product.countDocuments();
      if (count > 0) return res.json({ success: false, message: 'Products already exist.' });
      const defaults = [
        { name: 'BistalPower 20000mAh Pro', brand: 'BistalPower™', price: 25000, oldPrice: 38000, rating: 4.7, img: 'https://images.unsplash.com/photo-1609599006353-6290c5ae42d9?w=500&q=80', tags: { featured: true, flash: true, isNew: false } },
        { name: 'BistalPower 10000mAh Slim', brand: 'BistalPower™', price: 15000, oldPrice: 22000, rating: 4.5, img: 'https://images.unsplash.com/photo-1605792657236-c85d1bbaae6b?w=500&q=80', tags: { featured: true, flash: false, isNew: true } },
        { name: 'BistalPower 50000mAh Heavy Duty', brand: 'BistalPower™', price: 55000, oldPrice: 75000, rating: 4.9, img: 'https://images.unsplash.com/photo-1599329395147-4b4a13f33b5f?w=500&q=80', tags: { featured: true, flash: true, isNew: false } },
        { name: 'BistalPower Magnetic Wireless', brand: 'BistalPower™', price: 32000, oldPrice: 45000, rating: 4.6, img: 'https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=500&q=80', tags: { featured: true, flash: false, isNew: true } },
        { name: 'BistalPower Solar 20000mAh', brand: 'BistalPower™', price: 35000, oldPrice: 50000, rating: 4.8, img: 'https://images.unsplash.com/photo-1620389479910-277b30a1d3bf?w=500&q=80', tags: { featured: false, flash: true, isNew: false } },
        { name: 'BistalPower 30000mAh Ultra', brand: 'BistalPower™', price: 42000, oldPrice: 62000, rating: 4.7, img: 'https://images.unsplash.com/photo-1609599006353-6290c5ae42d9?w=500&q=80', tags: { featured: false, flash: false, isNew: true } }
      ];
      await Product.insertMany(defaults);
      res.json({ success: true, message: defaults.length + ' products seeded successfully.' });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ═══════════════════════════════
  // ORDER ROUTES
  // ═══════════════════════════════

  // Place order
  app.post('/api/orders', protect, async function(req, res) {
    try {
      const { items, address, paymentMethod, notes } = req.body;
      if (!items || !items.length) return res.status(400).json({ success: false, message: 'No items in order.' });
      if (!address || !address.street || !address.city || !address.state) {
        return res.status(400).json({ success: false, message: 'Complete delivery address is required.' });
      }
      let subtotal = 0;
      const orderItems = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const product = await Product.findById(item.productId);
        if (!product || !product.isActive) {
          return res.status(400).json({ success: false, message: 'Product not found: ' + item.productId });
        }
        subtotal += product.price * item.qty;
        orderItems.push({ product: product._id, name: product.name, img: product.img, price: product.price, qty: item.qty });
        await Product.findByIdAndUpdate(product._id, { $inc: { soldCount: item.qty } });
      }
      const deliveryFee = 1500;
      const total = subtotal + deliveryFee;
      const order = await Order.create({
        customer: req.user._id,
        customerInfo: { name: req.user.name, email: req.user.email, phone: req.user.phone },
        items: orderItems, address, subtotal, deliveryFee, total,
        paymentMethod: paymentMethod || 'bank', notes
      });
      const itemsList = orderItems.map(function(i) { return i.name + ' \xd7' + i.qty + ' = \u20a6' + (i.price * i.qty).toLocaleString(); }).join('\n');
      const waMsg = '*\uD83D\uDED2 New Bistal Order \u2014 ' + order.orderId + '*\n\n*Customer:* ' + req.user.name + '\n*Phone:* ' + (req.user.phone || 'N/A') + '\n*Email:* ' + (req.user.email || 'N/A') + '\n*Address:* ' + address.street + ', ' + address.city + ', ' + address.state + '\n\n*Items:*\n' + itemsList + '\n\n*Subtotal:* \u20a6' + subtotal.toLocaleString() + '\n*Delivery:* \u20a6' + deliveryFee.toLocaleString() + '\n*Total:* \u20a6' + total.toLocaleString() + '\n*Payment:* ' + (paymentMethod || 'bank') + '\n\n_Quality Sourced. Quality Delivered._';
      const waUrl = 'https://wa.me/' + WA_NUMBER + '?text=' + encodeURIComponent(waMsg);
      res.status(201).json({ success: true, message: 'Order placed successfully!', order, whatsappUrl: waUrl });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Track order (public)
  app.get('/api/orders/track/:orderId', async function(req, res) {
    try {
      const order = await Order.findOne({ orderId: req.params.orderId })
        .select('orderId orderStatus paymentStatus paymentMethod total deliveryFee customerInfo createdAt address items');
      if (!order) return res.status(404).json({ success: false, message: 'Order not found. Please check your Order ID.' });
      res.json({ success: true, order });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // My orders
  app.get('/api/orders/my', protect, async function(req, res) {
    try {
      const orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 }).limit(20);
      res.json({ success: true, orders });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // All orders (admin)
  app.get('/api/orders', protect, adminOnly, async function(req, res) {
    try {
      const { status, page, limit } = req.query;
      const filter = {};
      if (status) filter.orderStatus = status;
      const lim = Number(limit) || 50;
      const skip = (Number(page || 1) - 1) * lim;
      const orders = await Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(lim).populate('customer', 'name email phone');
      const total = await Order.countDocuments(filter);
      res.json({ success: true, total, orders });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // Update order status (admin)
  app.patch('/api/orders/:id/status', protect, adminOnly, async function(req, res) {
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

  // Admin dashboard stats
  app.get('/api/orders/admin/stats', protect, adminOnly, async function(req, res) {
    try {
      const totalOrders = await Order.countDocuments();
      const revenueData = await Order.aggregate([{ $group: { _id: null, total: { $sum: '$total' } } }]);
      const totalRevenue = revenueData[0] ? revenueData[0].total : 0;
      const pendingOrders = await Order.countDocuments({ orderStatus: 'pending' });
      const paidOrders = await Order.countDocuments({ paymentStatus: 'paid' });
      const recentOrders = await Order.find().sort({ createdAt: -1 }).limit(6).populate('customer', 'name');
      res.json({ success: true, stats: { totalOrders, totalRevenue, pendingOrders, paidOrders, recentOrders } });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // ── SERVE FRONTEND FOR ALL OTHER ROUTES ──
  app.get('*', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  // ── CONNECT TO MONGODB AND START ──
  const PORT = process.env.PORT || 5000;
  mongoose.connect(MONGO_URI)
    .then(function() {
      console.log('✅ MongoDB connected successfully');
      app.listen(PORT, function() {
        console.log('🚀 Bistal server running on port ' + PORT);
        console.log('🌐 Visit: https://bistal.onrender.com');
        console.log('🔗 API Health: https://bistal.onrender.com/api/health');
      });
    })
    .catch(function(err) {
      console.error('❌ MongoDB connection failed:', err.message);
      // Start anyway so the frontend still works
      app.listen(PORT, function() {
        console.log('🚀 Bistal server running on port ' + PORT + ' (DB connection failed)');
      });
    });
}
  brand: { type: String, default: 'BistalPower' },
  description: { type: String, default: '' },
  price: { type: Number, required: true, min: 0 },
  oldPrice: { type: Number, default: null },
  rating: { type: Number, default: 4.5 },
  stock: { type: Number, default: 100 },
  img: { type: String, default: '' },
  images: [String],
  category: { type: String, default: 'powerbank' },
  tags: { featured: { type: Boolean, default: false }, flash: { type: Boolean, default: false }, isNew: { type: Boolean, default: false } },
  specs: { capacity: String, ports: String, fastCharge: String, weight: String },
  isActive: { type: Boolean, default: true },
  soldCount: { type: Number, default: 0 }
}, { timestamps: true });
var Product = mongoose.model('Product', productSchema);

var orderSchema = new mongoose.Schema({
  orderId: { type: String, unique: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerInfo: { name: String, email: String, phone: String },
  items: [{ product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product' }, name: String, img: String, price: Number, qty: Number }],
  address: { street: String, city: String, state: String },
  subtotal: { type: Number, required: true },
  deliveryFee: { type: Number, default: 1500 },
  total: { type: Number, required: true },
  paymentMethod: { type: String, default: 'bank' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
  orderStatus: { type: String, enum: ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'], default: 'pending' },
  notes: String
}, { timestamps: true });
orderSchema.pre('save', function(next) {
  if (!this.orderId) this.orderId = 'BST-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase();
  next();
});
var Order = mongoose.model('Order', orderSchema);

// ── MIDDLEWARE ──
function protect(req, res, next) {
  try {
    var token = req.headers.authorization && req.headers.authorization.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null;
    if (!token) return res.status(401).json({ success: false, message: 'Not authenticated.' });
    var decoded = jwt.verify(token, process.env.JWT_SECRET);
    User.findById(decoded.id).select('-password').then(function(user) {
      if (!user) return res.status(401).json({ success: false, message: 'User not found.' });
      req.user = user;
      next();
    });
  } catch(err) {
    return res.status(401).json({ success: false, message: 'Invalid token.' });
  }
}

function adminOnly(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ success: false, message: 'Admin only.' });
}

function signToken(id) { return jwt.sign({ id: id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }); }

// ── AUTH ROUTES ──
var authRouter = express.Router();
authRouter.post('/register', async function(req, res) {
  try {
    var _a = req.body, name = _a.name, email = _a.email, phone = _a.phone, password = _a.password;
    if (!name || !password) return res.status(400).json({ success: false, message: 'Name and password required.' });
    if (!email && !phone) return res.status(400).json({ success: false, message: 'Email or phone required.' });
    var existing = await User.findOne(email ? { email: email } : { phone: phone });
    if (existing) return res.status(409).json({ success: false, message: 'Account exists. Please login.' });
    var user = await User.create({ name: name, email: email, phone: phone, password: password });
    res.status(201).json({ success: true, message: 'Account created!', token: signToken(user._id), user: user });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
authRouter.post('/login', async function(req, res) {
  try {
    var _a = req.body, identity = _a.identity, password = _a.password;
    if (!identity || !password) return res.status(400).json({ success: false, message: 'Identity and password required.' });
    var query = identity.includes('@') ? { email: identity.toLowerCase() } : { phone: identity };
    var user = await User.findOne(query).select('+password');
    if (!user || !(await user.comparePassword(password))) return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, message: 'Welcome back!', token: signToken(user._id), user: user });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
authRouter.post('/admin-login', async function(req, res) {
  try {
    if (req.body.password !== process.env.ADMIN_PASSWORD) return res.status(401).json({ success: false, message: 'Wrong admin password.' });
    var admin = await User.findOne({ role: 'admin' });
    if (!admin) admin = await User.create({ name: 'Bistal Admin', email: 'admin@bistal.com', password: process.env.ADMIN_PASSWORD, role: 'admin' });
    res.json({ success: true, token: signToken(admin._id), user: admin });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
authRouter.get('/me', protect, async function(req, res) {
  try {
    var user = await User.findById(req.user._id);
    res.json({ success: true, user: user });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── PRODUCT ROUTES ──
var productRouter = express.Router();
productRouter.get('/', async function(req, res) {
  try {
    var filter = { isActive: true };
    if (req.query.featured === 'true') filter['tags.featured'] = true;
    if (req.query.flash === 'true') filter['tags.flash'] = true;
    if (req.query.isNew === 'true') filter['tags.isNew'] = true;
    if (req.query.search) filter['$or'] = [{ name: { $regex: req.query.search, $options: 'i' } }];
    var products = await Product.find(filter).sort({ soldCount: -1 }).limit(50);
    res.json({ success: true, total: products.length, products: products });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
productRouter.get('/:id', async function(req, res) {
  try {
    var product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true, product: product });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
productRouter.post('/', protect, adminOnly, async function(req, res) {
  try {
    var product = await Product.create(req.body);
    res.status(201).json({ success: true, product: product });
  } catch(err) { res.status(400).json({ success: false, message: err.message }); }
});
productRouter.patch('/:id', protect, adminOnly, async function(req, res) {
  try {
    var product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, product: product });
  } catch(err) { res.status(400).json({ success: false, message: err.message }); }
});
productRouter.delete('/:id', protect, adminOnly, async function(req, res) {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Deleted.' });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── ORDER ROUTES ──
var orderRouter = express.Router();
orderRouter.post('/', protect, async function(req, res) {
  try {
    var _a = req.body, items = _a.items, address = _a.address, paymentMethod = _a.paymentMethod, notes = _a.notes;
    if (!items || !items.length) return res.status(400).json({ success: false, message: 'No items.' });
    var subtotal = 0; var orderItems = [];
    for (var i = 0; i < items.length; i++) {
      var p = await Product.findById(items[i].productId);
      if (!p) return res.status(400).json({ success: false, message: 'Product not found.' });
      subtotal += p.price * items[i].qty;
      orderItems.push({ product: p._id, name: p.name, img: p.img, price: p.price, qty: items[i].qty });
    }
    var order = await Order.create({ customer: req.user._id, customerInfo: { name: req.user.name, email: req.user.email, phone: req.user.phone }, items: orderItems, address: address, subtotal: subtotal, deliveryFee: 1500, total: subtotal + 1500, paymentMethod: paymentMethod || 'bank', notes: notes });
    res.status(201).json({ success: true, message: 'Order placed!', order: order });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
orderRouter.get('/my', protect, async function(req, res) {
  try {
    var orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, orders: orders });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});
orderRouter.get('/', protect, adminOnly, async function(req, res) {
  try {
    var orders = await Order.find().sort({ createdAt: -1 }).limit(50);
    res.json({ success: true, orders: orders });
  } catch(err) { res.status(500).json({ success: false, message: err.message }); }
});

// ── REGISTER ROUTES ──
app.use('/api/auth', authRouter);
app.use('/api/products', productRouter);
app.use('/api/orders', orderRouter);

app.get('/api/health', function(req, res) {
  res.json({ success: true, message: 'Bistal API is running' });
});

app.use(express.static(__dirname));
app.get("/{*path}", function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ── START ──
var PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGODB_URI).then(function() {
  console.log('MongoDB connected');
  app.listen(PORT, function() { console.log('Running on port ' + PORT); });
}).catch(function(err) {
  console.error('MongoDB failed: ' + err.message);
  process.exit(1);
});
