const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const RabbitMQConnection = require('./rabbitmq-connection');

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'auth_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// RabbitMQ connection
const rabbitmq = new RabbitMQConnection();
let rabbitChannel = null;

// Initialize database
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'bettor',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create admin user if not exists
    const adminEmail = 'admin@loto.com';
    const adminExists = await pool.query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    
    if (adminExists.rows.length === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await pool.query(
        'INSERT INTO users (email, password, role) VALUES ($1, $2, $3)',
        [adminEmail, hashedPassword, 'admin']
      );
      console.log('Admin user created: admin@loto.com / admin123');
    }
    
    console.log('Database initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  const isHealthy = rabbitmq.getChannel() !== null;
  if (isHealthy) {
    res.status(200).json({ status: 'healthy', service: 'auth-service' });
  } else {
    res.status(503).json({ status: 'unhealthy', service: 'auth-service', reason: 'RabbitMQ not connected' });
  }
});

// Register endpoint
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, role',
      [email, hashedPassword]
    );
    
    const user = result.rows[0];
    
    // Publish user created event
    rabbitChannel = rabbitmq.getChannel();
    if (rabbitChannel) {
      rabbitChannel.publish('user_events', 'user.created', Buffer.from(JSON.stringify(user)));
    }
    
    res.status(201).json({ message: 'User created', user: { id: user.id, email: user.email, role: user.role } });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login endpoint
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    res.json({ 
      token, 
      user: { id: user.id, email: user.email, role: user.role } 
    });
  } catch (error) {
    res.status(500).json({ error: 'Login failed' });
  }
});

const PORT = process.env.PORT || 3001;

async function start() {
  await initDB();
  
  // Start server immediately
  app.listen(PORT, () => {
    console.log(`Auth service running on port ${PORT}`);
  });
  
  // Connect to RabbitMQ after server starts
  rabbitChannel = await rabbitmq.connect();
}

start();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing connections...');
  await rabbitmq.close();
  await pool.end();
  process.exit(0);
});