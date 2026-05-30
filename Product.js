const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true
  },
  brand: {
    type: String,
    default: 'BistalPower™',
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: 0
  },
  oldPrice: {
    type: Number,
    default: null
  },
  rating: {
    type: Number,
    default: 4.5,
    min: 1,
    max: 5
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  stock: {
    type: Number,
    default: 100,
    min: 0
  },
  img: {
    type: String,
    default: ''
  },
  images: [String],
  category: {
    type: String,
    default: 'powerbank'
  },
  tags: {
    featured: { type: Boolean, default: false },
    flash:    { type: Boolean, default: false },
    isNew:    { type: Boolean, default: false }
  },
  specs: {
    capacity: String,
    ports: String,
    fastCharge: String,
    weight: String
  },
  isActive: { type: Boolean, default: true },
  soldCount: { type: Number, default: 0 }
}, { timestamps: true });

// Virtual for discount percentage
productSchema.virtual('discountPct').get(function() {
  if (!this.oldPrice || this.oldPrice <= this.price) return 0;
  return Math.round((1 - this.price / this.oldPrice) * 100);
});

productSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Product', productSchema);
