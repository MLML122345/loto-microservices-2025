const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

const app = express();
app.use(express.json());

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const LOTTERY_SERVICE_URL = process.env.LOTTERY_SERVICE_URL || 'http://localhost:3002';
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100
});
app.use(limiter);

// JWT Verification Middleware
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Admin check middleware
const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Auth routes
app.post('/api/auth/register', async (req, res) => {
  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/register`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const response = await axios.post(`${AUTH_SERVICE_URL}/login`, req.body);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

// Lottery routes (public)
app.get('/api/lottery/draws', async (req, res) => {
  try {
    const response = await axios.get(`${LOTTERY_SERVICE_URL}/draws`);
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

// Lottery routes (admin)
app.post('/api/lottery/draws', verifyToken, isAdmin, async (req, res) => {
  try {
    const response = await axios.post(`${LOTTERY_SERVICE_URL}/draws`, req.body, {
      headers: { 'user-id': req.user.id, 'user-role': req.user.role }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

app.put('/api/lottery/draws/:id/status', verifyToken, isAdmin, async (req, res) => {
  try {
    const response = await axios.put(`${LOTTERY_SERVICE_URL}/draws/${req.params.id}/status`, req.body, {
      headers: { 'user-id': req.user.id, 'user-role': req.user.role }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

app.post('/api/lottery/draws/:id/generate', verifyToken, isAdmin, async (req, res) => {
  try {
    const response = await axios.post(`${LOTTERY_SERVICE_URL}/draws/${req.params.id}/generate`, {}, {
      headers: { 'user-id': req.user.id, 'user-role': req.user.role }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

// Bet routes (authenticated)
app.post('/api/lottery/bets', verifyToken, async (req, res) => {
  try {
    const response = await axios.post(`${LOTTERY_SERVICE_URL}/bets`, req.body, {
      headers: { 'user-id': req.user.id, 'user-role': req.user.role }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

app.get('/api/lottery/bets', verifyToken, async (req, res) => {
  try {
    const response = await axios.get(`${LOTTERY_SERVICE_URL}/bets`, {
      headers: { 'user-id': req.user.id, 'user-role': req.user.role }
    });
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json(error.response?.data || { error: 'Service unavailable' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Gateway running on port ${PORT}`);
});
