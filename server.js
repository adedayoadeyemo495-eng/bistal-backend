require('dotenv').config();
var express = require('express');
var mongoose = require('mongoose');
var cors = require('cors');
var bcrypt = require('bcryptjs');
var jwt = require('jsonwebtoken');
var path = require('path');

var app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── MODELS ──
var userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  phone: { type: String, unique: true, sparse: true, trim: true },
  password: { type: String, required: true, minlength: 6, select: false },
  role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
  wishlist: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
  isActive: { type: Boolean, default: true },
  lastLogin: Date
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});
userSchema.methods.comparePassword = async function(p) { return bcrypt.compare(p, this.password); };
userSchema.methods.toJSON = function() { var o = this.toObject(); delete o.password; return o; };
var User = mongoose.model('User', userSchema);

var productSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
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
    var _a = req.body, items = _a.items, address = _a.address, paymentMethod = _a.paymentMethod, notes = _a.notes, deliveryFee = _a.deliveryFee, deliveryZone = _a.deliveryZone;
    if (!items || !items.length) return res.status(400).json({ success: false, message: 'No items.' });
    var subtotal = 0; var orderItems = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var itPrice = it.price || 0;
      var itQty = it.qty || 1;
      subtotal += itPrice * itQty;
      orderItems.push({ name: it.name || 'Product', img: it.img || '', price: itPrice, qty: itQty });
    }
    var dFee = deliveryFee !== undefined ? Number(deliveryFee) : 0;
    var order = await Order.create({ customer: req.user._id, customerInfo: { name: req.user.name, email: req.user.email, phone: req.user.phone }, items: orderItems, address: address, subtotal: subtotal, deliveryFee: dFee, deliveryZone: deliveryZone || '', total: subtotal + dFee, paymentMethod: paymentMethod || 'bank', notes: notes });
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

app.use(express.static(__dirname, {
  etag: false,
  lastModified: false,
  setHeaders: function(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));
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
