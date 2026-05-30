const express = require('express');
const router = express.Router();
const Product = require('../models/Product');
const { protect, adminOnly } = require('../middleware/auth');

// GET /api/products — list with filters
router.get('/', async (req, res) => {
  try {
    const { featured, flash, isNew, minPrice, maxPrice, sort, search, limit = 50, page = 1 } = req.query;
    const filter = { isActive: true };

    if (featured === 'true') filter['tags.featured'] = true;
    if (flash === 'true')    filter['tags.flash'] = true;
    if (isNew === 'true')    filter['tags.isNew'] = true;
    if (maxPrice) filter.price = { ...filter.price, $lte: Number(maxPrice) };
    if (minPrice) filter.price = { ...filter.price, $gte: Number(minPrice) };
    if (search)   filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { brand: { $regex: search, $options: 'i' } }
    ];

    let sortObj = {};
    if (sort === 'price_asc')  sortObj = { price: 1 };
    else if (sort === 'price_desc') sortObj = { price: -1 };
    else if (sort === 'rating') sortObj = { rating: -1 };
    else if (sort === 'newest') sortObj = { createdAt: -1 };
    else sortObj = { soldCount: -1, createdAt: -1 };

    const skip = (Number(page) - 1) * Number(limit);
    const [products, total] = await Promise.all([
      Product.find(filter).sort(sortObj).skip(skip).limit(Number(limit)),
      Product.countDocuments(filter)
    ]);

    res.json({ success: true, total, products });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/products/:id
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    res.json({ success: true, product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/products — admin only
router.post('/', protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.create(req.body);
    res.status(201).json({ success: true, message: 'Product created.', product });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH /api/products/:id — admin only
router.patch('/:id', protect, adminOnly, async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!product) return res.status(404).json({ success: false, message: 'Product not found.' });
    res.json({ success: true, message: 'Product updated.', product });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/products/:id — admin only (soft delete)
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    await Product.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: 'Product deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/products/seed — admin only (seed default products)
router.post('/seed/defaults', protect, adminOnly, async (req, res) => {
  try {
    const count = await Product.countDocuments();
    if (count > 0) return res.json({ success: false, message: 'Products already exist. Delete them first.' });

    const defaults = [
      { name: 'BistalPower 20000mAh Pro', brand: 'BistalPower™', price: 25000, oldPrice: 38000, rating: 4.7, img: 'https://images.unsplash.com/photo-1609599006353-6290c5ae42d9?w=500&q=80', tags: { featured: true, flash: true, isNew: false }, specs: { capacity: '20000mAh', ports: 'USB-A × 2, USB-C', fastCharge: '22.5W', weight: '420g' } },
      { name: 'BistalPower 10000mAh Slim', brand: 'BistalPower™', price: 15000, oldPrice: 22000, rating: 4.5, img: 'https://images.unsplash.com/photo-1605792657236-c85d1bbaae6b?w=500&q=80', tags: { featured: true, flash: false, isNew: true }, specs: { capacity: '10000mAh', ports: 'USB-A, USB-C', fastCharge: '18W', weight: '220g' } },
      { name: 'BistalPower 50000mAh Heavy Duty', brand: 'BistalPower™', price: 55000, oldPrice: 75000, rating: 4.9, img: 'https://images.unsplash.com/photo-1599329395147-4b4a13f33b5f?w=500&q=80', tags: { featured: true, flash: true, isNew: false }, specs: { capacity: '50000mAh', ports: 'USB-A × 3, USB-C', fastCharge: '65W', weight: '980g' } },
      { name: 'BistalPower Magnetic Wireless', brand: 'BistalPower™', price: 32000, oldPrice: 45000, rating: 4.6, img: 'https://images.unsplash.com/photo-1585338107529-13afc5f02586?w=500&q=80', tags: { featured: true, flash: false, isNew: true }, specs: { capacity: '10000mAh', ports: 'Wireless + USB-C', fastCharge: '15W Wireless', weight: '185g' } },
      { name: 'BistalPower Solar 20000mAh', brand: 'BistalPower™', price: 35000, oldPrice: 50000, rating: 4.8, img: 'https://images.unsplash.com/photo-1620389479910-277b30a1d3bf?w=500&q=80', tags: { featured: false, flash: true, isNew: false }, specs: { capacity: '20000mAh', ports: 'USB-A × 2, USB-C, Solar', fastCharge: '18W', weight: '380g' } },
      { name: 'BistalPower 30000mAh Ultra', brand: 'BistalPower™', price: 42000, oldPrice: 62000, rating: 4.7, img: 'https://images.unsplash.com/photo-1609599006353-6290c5ae42d9?w=500&q=80', tags: { featured: false, flash: false, isNew: true }, specs: { capacity: '30000mAh', ports: 'USB-A × 2, USB-C × 2', fastCharge: '45W', weight: '620g' } }
    ];

    await Product.insertMany(defaults);
    res.json({ success: true, message: `${defaults.length} products seeded.` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
