const express = require('express');
const { Pool } = require('pg');
const RabbitMQConnection = require('./rabbitmq-connection');

const app = express();
app.use(express.json());

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'lottery_db',
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

// Health check endpoint
app.get('/health', (req, res) => {
  const isHealthy = rabbitmq.getChannel() !== null;
  if (isHealthy) {
    res.status(200).json({ status: 'healthy', service: 'lottery-service' });
  } else {
    res.status(503).json({ status: 'unhealthy', service: 'lottery-service', reason: 'RabbitMQ not connected' });
  }
});

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
    
    rabbitChannel = rabbitmq.getChannel();
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
    
    rabbitChannel = rabbitmq.getChannel();
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
    
    rabbitChannel = rabbitmq.getChannel();
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
    
    rabbitChannel = rabbitmq.getChannel();
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
  
  // Start server immediately
  app.listen(PORT, () => {
    console.log(`Lottery service running on port ${PORT}`);
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