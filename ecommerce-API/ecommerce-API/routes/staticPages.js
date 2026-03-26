const express = require('express');
const router = express.Router();
// contact emails are not sent; enquiries are stored in DB
const { getDB } = require('../models/db');
const authMiddleware = require('../middleware/authMiddleware');
const { ObjectId } = require('mongodb');

// Static content (can be replaced with DB/file content later)
const pages = {
  about: {
    title: 'About Us',
    content: 'RTQ Foods is dedicated to providing healthy, high-quality food products...'
  },
  contact: {
    title: 'Contact Us',
    content: 'For inquiries, email us at support@rtqfoods.com or WhatsApp us at +91-XXXXXXXXXX.'
  },
  privacy: {
    title: 'Privacy Policy',
    content: 'We value your privacy. Read our full privacy policy here...'
  },
  terms: {
    title: 'Terms & Conditions',
    content: 'By using our platform, you agree to the following terms...'
  }
};

// POST /contact - receive contact form and store enquiry in DB (no email)
router.post('/contact', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ success: false, message: 'Missing required fields' });
  }

  try {
    const db = getDB();
    const contactDoc = {
      name,
      email,
      phone: phone || null,
      subject,
      message,
      status: 'open', // open | inprogress | onhold | closed
      admin_description: '',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection('contacts').insertOne(contactDoc);
    // return inserted id as string for frontend
    return res.json({ success: true, message: 'Enquiry saved', id: result.insertedId.toString() });
  } catch (err) {
    console.error('Error saving contact enquiry', err);
    return res.status(500).json({ success: false, message: 'Failed to save enquiry' });
  }
});

// Admin: list enquiries
router.get('/contacts', authMiddleware(['admin', 'staff']), async (req, res) => {
  try {
    const db = getDB();
    let contacts = await db.collection('contacts').find().sort({ createdAt: -1 }).toArray();
    contacts = contacts.map(c => ({ ...c, _id: c._id.toString() }));
    return res.json({ success: true, contacts });
  } catch (err) {
    console.error('Error fetching contacts', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch enquiries' });
  }
});

// Admin: update status and add admin description
router.patch('/contacts/:id', authMiddleware(['admin', 'staff']), async (req, res) => {
  const { id } = req.params;
  const { status, admin_description } = req.body;
  const allowed = ['open', 'inprogress', 'onhold', 'closed'];
  if (status && !allowed.includes(status)) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }
  try {
    const db = getDB();
    const update = { $set: { updatedAt: new Date() } };
    if (status) update.$set.status = status;
    if (admin_description !== undefined) update.$set.admin_description = admin_description;

    const result = await db.collection('contacts').updateOne({ _id: new ObjectId(id) }, update);
    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }
    let updated = await db.collection('contacts').findOne({ _id: new ObjectId(id) });
    if (updated) updated._id = updated._id.toString();
    return res.json({ success: true, contact: updated });
  } catch (err) {
    console.error('Error updating contact', err);
    return res.status(500).json({ success: false, message: 'Failed to update enquiry' });
  }
});

// Catch-all route for static pages (must come AFTER specific routes)
router.get('/:page', (req, res) => {
  const { page } = req.params;
  if (pages[page]) {
    res.json({ success: true, page: pages[page] });
  } else {
    res.status(404).json({ success: false, message: 'Page not found' });
  }
});

module.exports = router; 