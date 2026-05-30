const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

const signToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name || !password) return res.status(400).json({ success: false, message: 'Name and password are required.' });
    if (!email && !phone) return res.status(400).json({ success: false, message: 'Email or phone is required.' });

    // Check existing
    const query = email ? { email } : { phone };
    const existing = await User.findOne(query);
    if (existing) return res.status(409).json({ success: false, message: 'Account already exists. Please login.' });

    const user = await User.create({ name, email, phone, password });
    const token = signToken(user._id);

    res.status(201).json({ success: true, message: 'Account created!', token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { identity, password } = req.body;
    if (!identity || !password) return res.status(400).json({ success: false, message: 'Identity and password are required.' });

    const isEmail = identity.includes('@');
    const query = isEmail ? { email: identity.toLowerCase() } : { phone: identity };
    const user = await User.findOne(query).select('+password');

    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });

    const token = signToken(user._id);
    res.json({ success: true, message: `Welcome back, ${user.name.split(' ')[0]}!`, token, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/auth/me
router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('wishlist', 'name price img');
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/auth/profile
router.patch('/profile', protect, async (req, res) => {
  try {
    const { name, phone } = req.body;
    const user = await User.findByIdAndUpdate(req.user._id, { name, phone }, { new: true, runValidators: true });
    res.json({ success: true, message: 'Profile updated.', user });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/auth/wishlist/:productId  — toggle
router.post('/wishlist/:productId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const pid = req.params.productId;
    const idx = user.wishlist.indexOf(pid);
    let action;
    if (idx === -1) { user.wishlist.push(pid); action = 'added'; }
    else            { user.wishlist.splice(idx, 1); action = 'removed'; }
    await user.save();
    res.json({ success: true, action, wishlist: user.wishlist });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin login (password only — no user account needed)
router.post('/admin-login', async (req, res) => {
  try {
    const { password } = req.body;
    if (password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, message: 'Wrong admin password.' });
    }
    // Find or create admin user
    let admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      admin = await User.create({ name: 'Bistal Admin', email: 'admin@bistal.com', password: process.env.ADMIN_PASSWORD, role: 'admin' });
    }
    const token = signToken(admin._id);
    res.json({ success: true, token, user: admin });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
