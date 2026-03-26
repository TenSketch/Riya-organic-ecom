const express = require('express');
const router = express.Router();
const { getDB } = require('../models/db');
const { ObjectId } = require('mongodb');

// Get all categories
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const categories = await db.collection('categories').find({}).sort({ name: 1 }).toArray();
    res.json({
      success: true,
      categories
    });
  } catch (err) {
    console.error('Categories fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
});

// Get single category
router.get('/:id', async (req, res) => {
  try {
    const db = getDB();
    const category = await db.collection('categories').findOne({ _id: new ObjectId(req.params.id) });
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    res.json({
      success: true,
      category
    });
  } catch (err) {
    console.error('Category fetch error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch category'
    });
  }
});

// Create category
router.post('/', async (req, res) => {
  try {
    const db = getDB();
    const { name, description = '', image_url = '', is_active = true, sort_order = 0, parent_category = null } = req.body;
    // Check if category already exists
    const existingCategory = await db.collection('categories').findOne({ name });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category already exists'
      });
    }
    const newCategory = {
      name,
      description,
      image_url,
      is_active,
      sort_order,
      parent_category: parent_category ? new ObjectId(parent_category) : null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const result = await db.collection('categories').insertOne(newCategory);
    newCategory._id = result.insertedId;
    res.json({
      success: true,
      category: newCategory
    });
  } catch (err) {
    console.error('Category creation error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create category'
    });
  }
});

// Update category
router.put('/:id', async (req, res) => {
  try {
    const db = getDB();
    const { name, description, image_url, is_active, sort_order, parent_category } = req.body;
    let objectId;
    try {
      objectId = new ObjectId(req.params.id);
    } catch (parseErr) {
      console.error('Failed to parse ObjectId:', req.params.id, parseErr);
      return res.status(400).json({ success: false, message: 'Invalid category ID format' });
    }
    // Check if category name already exists (excluding current category)
    const existingCategory = await db.collection('categories').findOne({ name, _id: { $ne: objectId } });
    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category name already exists'
      });
    }
    const updateData = {
      updatedAt: new Date()
    };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (image_url !== undefined) updateData.image_url = image_url;
    if (is_active !== undefined) updateData.is_active = is_active;
    if (sort_order !== undefined) updateData.sort_order = sort_order;
    if (parent_category !== undefined) updateData.parent_category = parent_category ? new ObjectId(parent_category) : null;
    const result = await db.collection('categories').findOneAndUpdate(
      { _id: objectId },
      { $set: updateData },
      { returnDocument: 'after' }
    );
    if (!result) {
      return res.status(404).json({
        success: false,
        message: 'Category not found',
        debug: { id: req.params.id, objectId: objectId, updateData }
      });
    }
    res.json({
      success: true,
      category: result
    });
  } catch (err) {
    console.error('Category update error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update category',
      error: err.message
    });
  }
});

// Delete category
router.delete('/:id', async (req, res) => {
  try {
    const db = getDB();
    // Check if category is being used by any products
    const productsUsingCategory = await db.collection('products').findOne({ category_id: new ObjectId(req.params.id) });
    if (productsUsingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete category: products are using this category'
      });
    }
    const result = await db.collection('categories').deleteOne({ _id: new ObjectId(req.params.id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (err) {
    console.error('Category deletion error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete category'
    });
  }
});

module.exports = router; 