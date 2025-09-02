const amqp = require('amqplib');

class RabbitMQConnection {
  constructor() {
    this.connection = null;
    this.channel = null;
  }

  async connect(retries = 10) {
    const delay = 2000;
    
    for (let i = 0; i < retries; i++) {
      try {
        console.log(`Attempting to connect to RabbitMQ... (attempt ${i + 1}/${retries})`);
        
        this.connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://localhost:5672');
        this.channel = await this.connection.createChannel();
        await this.channel.assertExchange('lottery_events', 'topic', { durable: true });
        
        this.connection.on('error', (err) => {
          console.error('RabbitMQ connection error:', err);
          this.reconnect();
        });
        
        this.connection.on('close', () => {
          console.log('RabbitMQ connection closed, reconnecting...');
          this.reconnect();
        });
        
        console.log('✅ Connected to RabbitMQ successfully');
        return this.channel;
        
      } catch (error) {
        const waitTime = delay * Math.pow(1.5, i);
        console.log(`❌ RabbitMQ connection failed: ${error.message}`);
        console.log(`⏳ Waiting ${waitTime/1000} seconds before retry...`);
        
        if (i === retries - 1) {
          console.error('Failed to connect to RabbitMQ after all retries');
          return null;
        }
        
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  async reconnect() {
    setTimeout(async () => {
      try {
        await this.connect();
      } catch (error) {
        console.error('Reconnection failed:', error);
      }
    }, 5000);
  }

  getChannel() {
    return this.channel;
  }

  async close() {
    if (this.connection) {
      await this.connection.close();
    }
  }
}

module.exports = RabbitMQConnection;