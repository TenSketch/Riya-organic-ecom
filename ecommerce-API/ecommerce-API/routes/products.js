const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const { getDB } = require('../models/db');
const multer = require('multer');
const path = require('path');

// Multer setup for product images
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../uploads/products'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, base.replace(/\s+/g, '_') + '-' + unique + ext);
  }
});
const upload = multer({ storage });

// Serve uploads statically
const expressApp = require('express');
router.use('/uploads', expressApp.static(path.join(__dirname, '../uploads')));

// Get all products with search and filter
router.get('/', async (req, res) => {
  try {
    const { search, category, product_type, visible, sort = 'name', order = 'asc', low_stock } = req.query;
    const db = getDB();

    let query = {};

    // Search by name or description
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Filter by category
    if (category) {
      query.category_id = new ObjectId(category);
    }

    // Filter by product type
    if (product_type) {
      query.product_type = product_type;
    }

    // Filter by visibility - only apply if explicitly set
    if (visible !== undefined) {
      query.visible = visible === 'true';
    }

    // Filter low stock items
    if (low_stock === 'true') {
      query.$expr = {
        $lte: ['$stock_quantity', '$low_stock_threshold']
      };
    }

    // Sort options
    let sortObj = {};
    sortObj[sort] = order === 'desc' ? -1 : 1;

    // Get products directly without aggregation for now
    const products = await db.collection('products')
      .find(query)
      .sort(sortObj)
      .toArray();

    // Add category names manually
    const productsWithCategories = await Promise.all(products.map(async (product) => {
      if (product.category_id) {
        const category = await db.collection('categories').findOne({ _id: product.category_id });
        return {
          ...product,
          category_name: category ? category.name : 'Unknown'
        };
      }
      return {
        ...product,
        category_name: 'Unknown'
      };
    }));

    res.json({
      success: true,
      products: productsWithCategories,
      total: productsWithCategories.length
    });
  } catch (err) {
    console.error('Products fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch products'
    });
  }
});

// Get low stock products
router.get('/low-stock', async (req, res) => {
  try {
    const db = getDB();
    const products = await db.collection('products')
      .aggregate([
        {
          $match: {
            $expr: {
              $lte: ['$stock_quantity', '$low_stock_threshold']
            }
          }
        },
        {
          $lookup: {
            from: 'categories',
            localField: 'category_id',
            foreignField: '_id',
            as: 'category'
          }
        },
        { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            name: 1,
            category_name: '$category.name',
            stock_quantity: 1,
            low_stock_threshold: 1,
            price: 1
          }
        }
      ]).toArray();

    res.json({
      success: true,
      products: products,
      total: products.length
    });
  } catch (err) {
    console.error('Low stock products fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch low stock products'
    });
  }
});

// Get single product
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const product = await db.collection('products')
      .aggregate([
        { $match: { _id: new ObjectId(req.params.id) } },
        {
          $lookup: {
            from: 'categories',
            localField: 'category_id',
            foreignField: '_id',
            as: 'category'
          }
        },
        { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            name: 1,
            image_url: 1,
            category_id: 1,
            category_name: '$category.name',
            description: 1,
            price: 1,
            discount_price: 1,
            stock_quantity: 1,
            product_type: 1,
            visible: 1,
            health_benefits: 1,
            ingredients: 1,
            weight: 1,
            expiry_date: 1,
            low_stock_threshold: 1,
            stockAdjustments: 1,
            createdAt: 1,
            updatedAt: 1,
            hsn_number: 1
          }
        }
      ]).toArray();

    if (!product || product.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      product: product[0]
    });
  } catch (err) {
    console.error('Product fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch product'
    });
  }
});

// Helper function to convert weight to grams
function convertWeightToGrams(weightStr) {
  if (!weightStr) return 0;

  const weight = weightStr.toString().toLowerCase().trim();

  // Extract number and unit
  const match = weight.match(/^(\d+(?:\.\d+)?)\s*(g|gram|grams|kg|kilo|kilos|kilogram|kilograms|gm|gr)?$/);

  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2] || 'g';

  // Convert to grams
  if (unit.includes('kg') || unit.includes('kilo')) {
    return Math.round(value * 1000);
  } else {
    return Math.round(value);
  }
}

// Create product
router.post('/', upload.single('image'), async (req, res) => {
  try {
    const db = getDB();
    const {
      name, category_id, description, price, discount_price, stock_quantity,
      product_type, visible, health_benefits, ingredients, weight,
      expiry_date, low_stock_threshold, hsn_number
    } = req.body;
    let image_url = '';
    if (req.file) {
      image_url = `/uploads/products/${req.file.filename}`;
    }

    // Convert weight to grams
    const weightInGrams = convertWeightToGrams(weight);

    const newProduct = {
      name,
      image_url,
      category_id: new ObjectId(category_id),
      description,
      price: parseFloat(price) || 0,
      discount_price: parseFloat(discount_price) || 0,
      stock_quantity: parseInt(stock_quantity) || 0,
      product_type: product_type || 'Online',
      visible: visible === 'true' || visible === true,
      health_benefits: health_benefits || '',
      ingredients: ingredients || '',
      weight: weightInGrams, // Store as number (grams)
      expiry_date: expiry_date ? new Date(expiry_date) : null,
      low_stock_threshold: parseInt(low_stock_threshold) || 10,
      stockAdjustments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      hsn_number: hsn_number || ''
    };
    const result = await db.collection('products').insertOne(newProduct);
    newProduct._id = result.insertedId;
    // Get category name for response
    const category = await db.collection('categories').findOne({ _id: new ObjectId(category_id) });
    newProduct.category_name = category ? category.name : 'Unknown';
    res.json({
      success: true,
      product: newProduct
    });
  } catch (err) {
    console.error('Product creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create product'
    });
  }
});

// Update product
router.put('/:id', upload.single('image'), async (req, res) => {
  try {
    const db = getDB();
    const updateData = {
      ...req.body,
      updatedAt: new Date()
    };

    // Convert numeric fields
    if (req.body.price !== undefined) {
      updateData.price = parseFloat(req.body.price) || 0;
    }
    if (req.body.discount_price !== undefined) {
      updateData.discount_price = parseFloat(req.body.discount_price) || 0;
    }
    if (req.body.stock_quantity !== undefined) {
      updateData.stock_quantity = parseInt(req.body.stock_quantity) || 0;
    }
    if (req.body.weight !== undefined) {
      updateData.weight = convertWeightToGrams(req.body.weight);
    }

    if (req.body.hsn_number !== undefined) {
      updateData.hsn_number = req.body.hsn_number;
    }

    if (req.body.category_id) {
      updateData.category_id = new ObjectId(req.body.category_id);
    }
    if (req.body.expiry_date) {
      updateData.expiry_date = new Date(req.body.expiry_date);
    }
    if (req.file) {
      updateData.image_url = `/uploads/products/${req.file.filename}`;
    } else {
      // Keep existing image_url if no new image is uploaded
      const existing = await db.collection('products').findOne({ _id: new ObjectId(req.params.id) });
      if (existing && existing.image_url) {
        updateData.image_url = existing.image_url;
      }
    }
    if ('visible' in updateData) {
      updateData.visible = updateData.visible === 'true' || updateData.visible === true;
    }
    const query = { _id: new ObjectId(req.params.id) };
    const result = await db.collection('products').findOneAndUpdate(
      query,
      { $set: updateData },
      { returnDocument: 'after' }
    );
    const updatedProduct = result.document || result.value || result;
    if (!updatedProduct || !updatedProduct._id) {
      return res.status(404).json({
        success: false,
        message: 'Product not found',
        debug: { id: req.params.id, query, updateData }
      });
    }
    // Get category name for response
    const category = await db.collection('categories').findOne({ _id: updatedProduct.category_id });
    updatedProduct.category_name = category ? category.name : 'Unknown';
    res.json({
      success: true,
      product: updatedProduct
    });
  } catch (err) {
    console.error('Product update error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update product',
      error: err.message
    });
  }
});

// Update stock quantity
router.patch('/:id/stock', async (req, res) => {
  try {
    const { quantity, note } = req.body;
    const db = getDB();

    const product = await db.collection('products').findOne({ _id: new ObjectId(req.params.id) });
    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    const newQuantity = parseInt(quantity);
    const stockAdjustment = {
      quantity: newQuantity - product.stock_quantity,
      note: note || 'Manual stock adjustment',
      date: new Date(),
      adjusted_by: req.user.id
    };

    const result = await db.collection('products').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          stock_quantity: newQuantity,
          updatedAt: new Date()
        },
        $push: { stockAdjustments: stockAdjustment }
      },
      { returnDocument: 'after' }
    );

    res.json({
      success: true,
      product: result.value,
      adjustment: stockAdjustment
    });
  } catch (err) {
    console.error('Stock update error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update stock'
    });
  }
});

// Toggle product visibility
router.patch('/:id/visibility', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('products').findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          visible: req.body.visible,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );

    if (!result.value) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      product: result.value
    });
  } catch (err) {
    console.error('Visibility toggle error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to toggle visibility'
    });
  }
});

// Delete product
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    const result = await db.collection('products').deleteOne({ _id: new ObjectId(req.params.id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Product not found'
      });
    }

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (err) {
    console.error('Product deletion error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete product'
    });
  }
});

// Reduce stock for order (internal function)
async function reduceStockForOrder(items) {
  const db = getDB();
  for (const item of items) {
    await db.collection('products').updateOne(
      { _id: new ObjectId(item.product_id) },
      {
        $inc: { stock_quantity: -item.quantity },
        $set: { updatedAt: new Date() }
      }
    );
  }
}

module.exports = router; 