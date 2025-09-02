# PowerShell Setup Script for Lottery Microservices Project
# Run this script in the loto-project folder

Write-Host "Creating Lottery Microservices Project..." -ForegroundColor Green

# Create docker-compose.yml
@'
version: '3.8'

services:
  gateway:
    build: ./gateway
    ports:
      - "3000:3000"
    environment:
      - AUTH_SERVICE_URL=http://auth-service:3001
      - LOTTERY_SERVICE_URL=http://lottery-service:3002
      - JWT_SECRET=your-secret-key-change-this
    depends_on:
      - auth-service
      - lottery-service
    networks:
      - loto-network

  auth-service:
    build: ./auth-service
    environment:
      - PORT=3001
      - DB_HOST=auth-db
      - DB_PORT=5432
      - DB_NAME=auth_db
      - DB_USER=postgres
      - DB_PASSWORD=postgres
      - JWT_SECRET=your-secret-key-change-this
      - RABBITMQ_URL=amqp://rabbitmq:5672
    depends_on:
      - auth-db
      - rabbitmq
    networks:
      - loto-network

  lottery-service:
    build: ./lottery-service
    environment:
      - PORT=3002
      - DB_HOST=lottery-db
      - DB_PORT=5432
      - DB_NAME=lottery_db
      - DB_USER=postgres
      - DB_PASSWORD=postgres
      - JWT_SECRET=your-secret-key-change-this
      - RABBITMQ_URL=amqp://rabbitmq:5672
    depends_on:
      - lottery-db
      - rabbitmq
    networks:
      - loto-network

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - "5672:5672"
      - "15672:15672"
    environment:
      - RABBITMQ_DEFAULT_USER=admin
      - RABBITMQ_DEFAULT_PASS=admin
    networks:
      - loto-network

  auth-db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_DB=auth_db
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - auth-db-data:/var/lib/postgresql/data
    networks:
      - loto-network

  lottery-db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_DB=lottery_db
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=postgres
    volumes:
      - lottery-db-data:/var/lib/postgresql/data
    networks:
      - loto-network

networks:
  loto-network:
    driver: bridge

volumes:
  auth-db-data:
  lottery-db-data:
'@ | Out-File -FilePath "docker-compose.yml" -Encoding UTF8

# Create Gateway files
Write-Host "Creating Gateway Service..." -ForegroundColor Yellow

@'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
'@ | Out-File -FilePath "gateway\Dockerfile" -Encoding UTF8

@'
{
  "name": "gateway",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "jsonwebtoken": "^9.0.2",
    "express-rate-limit": "^7.1.5"
  }
}
'@ | Out-File -FilePath "gateway\package.json" -Encoding UTF8

@'
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
'@ | Out-File -FilePath "gateway\server.js" -Encoding UTF8

# Create Auth Service files
Write-Host "Creating Auth Service..." -ForegroundColor Yellow

@'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3001
CMD ["npm", "start"]
'@ | Out-File -FilePath "auth-service\Dockerfile" -Encoding UTF8

@'
{
  "name": "auth-service",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "bcrypt": "^5.1.1",
    "jsonwebtoken": "^9.0.2",
    "amqplib": "^0.10.3"
  }
}
'@ | Out-File -FilePath "auth-service\package.json" -Encoding UTF8

@'
const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'auth_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// RabbitMQ connection
let rabbitChannel;
async function connectRabbit() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    rabbitChannel = await connection.createChannel();
    await rabbitChannel.assertExchange('user_events', 'topic', { durable: true });
    console.log('Connected to RabbitMQ');
  } catch (error) {
    console.error('RabbitMQ connection error:', error);
    setTimeout(connectRabbit, 5000);
  }
}

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
  await connectRabbit();
  
  app.listen(PORT, () => {
    console.log(`Auth service running on port ${PORT}`);
  });
}

start();
'@ | Out-File -FilePath "auth-service\server.js" -Encoding UTF8

# Create Lottery Service files
Write-Host "Creating Lottery Service..." -ForegroundColor Yellow

@'
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3002
CMD ["npm", "start"]
'@ | Out-File -FilePath "lottery-service\Dockerfile" -Encoding UTF8

@'
{
  "name": "lottery-service",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.3",
    "amqplib": "^0.10.3"
  }
}
'@ | Out-File -FilePath "lottery-service\package.json" -Encoding UTF8

@'
const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
app.use(express.json());

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost:5672';

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'lottery_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

// RabbitMQ connection
let rabbitChannel;
async function connectRabbit() {
  try {
    const connection = await amqp.connect(RABBITMQ_URL);
    rabbitChannel = await connection.createChannel();
    await rabbitChannel.assertExchange('lottery_events', 'topic', { durable: true });
    console.log('Connected to RabbitMQ');
  } catch (error) {
    console.error('RabbitMQ connection error:', error);
    setTimeout(connectRabbit, 5000);
  }
}

// Initialize database
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lottery_draws (
        id SERIAL PRIMARY KEY,
        draw_date DATE NOT NULL,
        prize_amount DECIMAL(10, 2) NOT NULL,
        status VARCHAR(50) DEFAULT 'open',
        numbers INTEGER[],
        complementary_number INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(draw_date)
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bets (
        id SERIAL PRIMARY KEY,
        draw_id INTEGER REFERENCES lottery_draws(id),
        user_id INTEGER NOT NULL,
        numbers INTEGER[] NOT NULL,
        complementary_number INTEGER NOT NULL,
        is_winner BOOLEAN DEFAULT FALSE,
        prize_won DECIMAL(10, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(draw_id, user_id)
      )
    `);
    
    console.log('Database initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (req.headers['user-role'] !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get all draws
app.get('/draws', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ld.*, 
        COUNT(DISTINCT b.user_id) as total_bettors,
        COUNT(DISTINCT CASE WHEN b.is_winner THEN b.user_id END) as winners
      FROM lottery_draws ld
      LEFT JOIN bets b ON ld.id = b.draw_id
      GROUP BY ld.id
      ORDER BY ld.draw_date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch draws' });
  }
});

// Create draw (admin only)
app.post('/draws', requireAdmin, async (req, res) => {
  const { draw_date, prize_amount } = req.body;
  
  if (!draw_date || !prize_amount) {
    return res.status(400).json({ error: 'Draw date and prize amount required' });
  }
  
  try {
    const result = await pool.query(
      'INSERT INTO lottery_draws (draw_date, prize_amount) VALUES ($1, $2) RETURNING *',
      [draw_date, prize_amount]
    );
    
    const draw = result.rows[0];
    
    if (rabbitChannel) {
      rabbitChannel.publish('lottery_events', 'draw.created', Buffer.from(JSON.stringify(draw)));
    }
    
    res.status(201).json(draw);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Draw already exists for this date' });
    }
    res.status(500).json({ error: 'Failed to create draw' });
  }
});

// Update draw status (admin only)
app.put('/draws/:id/status', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  if (!['open', 'closed', 'completed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  
  try {
    const result = await pool.query(
      'UPDATE lottery_draws SET status = $1 WHERE id = $2 RETURNING *',
      [status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Draw not found' });
    }
    
    if (rabbitChannel) {
      rabbitChannel.publish('lottery_events', 'draw.status_changed', Buffer.from(JSON.stringify(result.rows[0])));
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Generate draw results (admin only)
app.post('/draws/:id/generate', requireAdmin, async (req, res) => {
  const { id } = req.params;
  
  try {
    // Check if draw exists and is closed
    const drawResult = await pool.query('SELECT * FROM lottery_draws WHERE id = $1', [id]);
    
    if (drawResult.rows.length === 0) {
      return res.status(404).json({ error: 'Draw not found' });
    }
    
    const draw = drawResult.rows[0];
    
    if (draw.status !== 'closed') {
      return res.status(400).json({ error: 'Draw must be closed before generating results' });
    }
    
    if (draw.numbers) {
      return res.status(400).json({ error: 'Results already generated' });
    }
    
    // Generate random numbers
    const numbers = [];
    while (numbers.length < 5) {
      const num = Math.floor(Math.random() * 49) + 1;
      if (!numbers.includes(num)) {
        numbers.push(num);
      }
    }
    numbers.sort((a, b) => a - b);
    
    const complementary_number = Math.floor(Math.random() * 10) + 1;
    
    // Update draw with results
    const updateResult = await pool.query(
      'UPDATE lottery_draws SET numbers = $1, complementary_number = $2, status = $3 WHERE id = $4 RETURNING *',
      [numbers, complementary_number, 'completed', id]
    );
    
    // Check for winners
    const betsResult = await pool.query('SELECT * FROM bets WHERE draw_id = $1', [id]);
    const winnerIds = [];
    
    for (const bet of betsResult.rows) {
      const isWinner = 
        JSON.stringify(bet.numbers.sort()) === JSON.stringify(numbers) &&
        bet.complementary_number === complementary_number;
      
      if (isWinner) {
        winnerIds.push(bet.id);
      }
    }
    
    // Update winners
    if (winnerIds.length > 0) {
      const prizePerWinner = draw.prize_amount / winnerIds.length;
      await pool.query(
        'UPDATE bets SET is_winner = true, prize_won = $1 WHERE id = ANY($2)',
        [prizePerWinner, winnerIds]
      );
    }
    
    const finalDraw = updateResult.rows[0];
    finalDraw.winners_count = winnerIds.length;
    
    if (rabbitChannel) {
      rabbitChannel.publish('lottery_events', 'draw.completed', Buffer.from(JSON.stringify(finalDraw)));
    }
    
    res.json(finalDraw);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate results' });
  }
});

// Place bet
app.post('/bets', async (req, res) => {
  const userId = req.headers['user-id'];
  const { draw_id, numbers, complementary_number } = req.body;
  
  if (!draw_id || !numbers || !complementary_number) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (!Array.isArray(numbers) || numbers.length !== 5) {
    return res.status(400).json({ error: 'Must provide exactly 5 numbers' });
  }
  
  if (!numbers.every(n => n >= 1 && n <= 49)) {
    return res.status(400).json({ error: 'Numbers must be between 1 and 49' });
  }
  
  if (complementary_number < 1 || complementary_number > 10) {
    return res.status(400).json({ error: 'Complementary number must be between 1 and 10' });
  }
  
  try {
    // Check if draw exists and is open
    const drawResult = await pool.query('SELECT * FROM lottery_draws WHERE id = $1', [draw_id]);
    
    if (drawResult.rows.length === 0) {
      return res.status(404).json({ error: 'Draw not found' });
    }
    
    if (drawResult.rows[0].status !== 'open') {
      return res.status(400).json({ error: 'Draw is not open for bets' });
    }
    
    // Place bet
    const result = await pool.query(
      'INSERT INTO bets (draw_id, user_id, numbers, complementary_number) VALUES ($1, $2, $3, $4) RETURNING *',
      [draw_id, userId, numbers.sort((a, b) => a - b), complementary_number]
    );
    
    if (rabbitChannel) {
      rabbitChannel.publish('lottery_events', 'bet.placed', Buffer.from(JSON.stringify(result.rows[0])));
    }
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'You already have a bet for this draw' });
    }
    res.status(500).json({ error: 'Failed to place bet' });
  }
});

// Get user bets
app.get('/bets', async (req, res) => {
  const userId = req.headers['user-id'];
  
  try {
    const result = await pool.query(`
      SELECT b.*, ld.draw_date, ld.prize_amount, ld.status, ld.numbers as winning_numbers, ld.complementary_number as winning_complementary
      FROM bets b
      JOIN lottery_draws ld ON b.draw_id = ld.id
      WHERE b.user_id = $1
      ORDER BY ld.draw_date DESC
    `, [userId]);
    
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch bets' });
  }
});

const PORT = process.env.PORT || 3002;

async function start() {
  await initDB();
  await connectRabbit();
  
  app.listen(PORT, () => {
    console.log(`Lottery service running on port ${PORT}`);
  });
}

start();
'@ | Out-File -FilePath "lottery-service\server.js" -Encoding UTF8

Write-Host "All files created successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "Now run the following command to start the services:" -ForegroundColor Cyan
Write-Host "docker-compose up --build" -ForegroundColor Yellow
Write-Host ""
Write-Host "Services will be available at:" -ForegroundColor Cyan
Write-Host "- API Gateway: http://localhost:3000" -ForegroundColor White
Write-Host "- RabbitMQ Management: http://localhost:15672 (admin/admin)" -ForegroundColor White
Write-Host ""
Write-Host "Default admin credentials:" -ForegroundColor Cyan
Write-Host "- Email: admin@loto.com" -ForegroundColor White
Write-Host "- Password: admin123" -ForegroundColor White