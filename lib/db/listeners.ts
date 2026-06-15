import { Client } from 'pg';
import { EventEmitter } from 'events';

interface DenialEvent {
  id: string;
  user_id: string;
  resource: string;
  timestamp: string;
  outcome: string;
}

class DenialNotificationListener extends EventEmitter {
  private client: Client | null = null;
  private isConnecting = false;
  private isConnected = false;

  async connect(): Promise<void> {
    if (this.isConnected || this.isConnecting) {
      return;
    }

    this.isConnecting = true;

    try {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL environment variable is required for denial listener');
      }

      this.client = new Client({
        connectionString: process.env.DATABASE_URL,
      });

      await this.client.connect();
      await this.client.query('LISTEN denial_inserted');

      this.client.on('notification', (msg) => {
        if (msg.channel === 'denial_inserted' && msg.payload) {
          try {
            const event: DenialEvent = JSON.parse(msg.payload);
            this.emit('denial', event);
          } catch (error) {
            console.error('Failed to parse denial notification:', error);
          }
        }
      });

      this.client.on('error', (error) => {
        console.error('Denial listener client error:', error);
        this.isConnected = false;
        this.reconnect();
      });

      this.client.on('end', () => {
        console.log('Denial listener client disconnected');
        this.isConnected = false;
      });

      this.isConnected = true;
      this.isConnecting = false;
    } catch (error) {
      this.isConnecting = false;
      console.error('Failed to connect denial listener:', error);
      // Reset state so subsequent connect() calls can retry
      this.client = null;
      throw error;
    }
  }

  private async reconnect(): Promise<void> {
    if (this.isConnecting) {
      return;
    }

    // Exponential backoff with jitter, capped at 30s
    const delay = Math.min(30000, Math.random() * 5000 + 1000);
    
    setTimeout(() => {
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
        this.reconnect();
      });
    }, delay);
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.query('UNLISTEN denial_inserted');
        await this.client.end();
      } catch (error) {
        console.error('Error during denial listener disconnect:', error);
      } finally {
        this.client = null;
        this.isConnected = false;
        this.isConnecting = false;
      }
    }
  }
}

// Singleton instance
let denialListener: DenialNotificationListener | null = null;

export function getDenialListener(): DenialNotificationListener {
  if (!denialListener) {
    denialListener = new DenialNotificationListener();
  }
  return denialListener;
}