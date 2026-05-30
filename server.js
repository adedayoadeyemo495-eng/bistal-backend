require('dotenv').config();
var express = require('express');
var mongoose = require('mongoose');
var cors = require('cors');
var path = require('path');

var app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', require('./auth'));
app.use('/api/products', require('./products'));
app.use('/api/orders', require('./orders'));

app.get('/api/health', function(req, res) {
  res.json({ success: true, message: 'Bistal API is running' });
});

app.use(express.static(__dirname));

app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'index.html'));
});

var PORT = process.env.PORT || 5000;

mongoose.connect(process.env.MONGODB_URI).then(function() {
  console.log('MongoDB connected');
  app.listen(PORT, function() {
    console.log('Running on port ' + PORT);
  });
}).catch(function(err) {
  console.error('MongoDB failed: ' + err.message);
  process.exit(1);
});
