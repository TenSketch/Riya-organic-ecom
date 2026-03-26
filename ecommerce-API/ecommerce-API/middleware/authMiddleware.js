const jwt = require('jsonwebtoken');

function authMiddleware(roles = []) {
  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).json({ success: false, message: 'No token provided' });
    const token = authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'No token provided' });
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
      if (roles.length && !roles.includes(decoded.role)) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
      req.user = decoded;
      next();
    } catch (err) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }
  };
}

module.exports = authMiddleware; 