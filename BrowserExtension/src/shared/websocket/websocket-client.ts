import { config } from '../config';
import { safeUrlLog, debugLog, logInfo } from '../../utils/logging';

type MessageHandler = (data: any) => void;
type ConnectionHandler = () => void;

interface WebSocketMessage {
  type: string;
  data: any;
  id?: string;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private disconnectionHandlers: Set<ConnectionHandler> = new Set();
  // private reconnectInterval: number = 2000;
  private maxReconnectAttempts: number = 20;

  private getReconnectDelay(): number {
    const baseDelay = 1000;
    const maxDelay = 15000;
    return Math.min(baseDelay * Math.pow(1.5, this.reconnectAttempts), maxDelay);
  }

  private reconnectAttempts: number = 0;
  private userId: string;
  private isIntentionalDisconnect: boolean = false;
  private messageQueue: WebSocketMessage[] = [];
  private pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();
  private heartbeatInterval: number = 30000; // 30 seconds
  private heartbeatTimer: number | null = null;
  private lastPongReceived: Date | null = null;
  private pongTimeout: number = 270000; // 270 seconds to receive pong
  private connectionCount: number = 0; // Track total connections to detect reconnections

  constructor(userId: string) {
    this.userId = userId;
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    this.isIntentionalDisconnect = false;
    const wsUrl = `${config.api.websocketUrl}/${this.userId}`;
    
    try {
      this.ws = new WebSocket(wsUrl);
      
      this.ws.onopen = () => {
        logInfo('WebSocket Client', `Connected to ${safeUrlLog(wsUrl)}`);
        debugLog(`[WebSocket Client] Connection timestamp: ${new Date().toISOString()}`);
        
        // Check if this is a reconnection
        this.connectionCount++;
        const isReconnection = this.reconnectAttempts > 0 || this.connectionCount > 1;
        this.reconnectAttempts = 0;
        
        this.connectionHandlers.forEach(handler => handler());
        
        // Emit reconnected event if this is a reconnection
        if (isReconnection) {
          console.log('[WebSocket Client] This is a reconnection, emitting reconnected event');
          const reconnectHandlers = this.messageHandlers.get('reconnected');
          if (reconnectHandlers) {
            reconnectHandlers.forEach(handler => handler({ type: 'reconnected', data: {} }));
          }
        }
        
        this.flushMessageQueue();
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type !== 'ping' && message.type !== 'pong') {
            debugLog(`[WebSocket Client] Received: ${message.type}`);
          }
          this.handleMessage(message);
        } catch (error) {
          console.error('[WebSocket Client] Failed to parse WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.stopHeartbeat();
        this.disconnectionHandlers.forEach(handler => handler());
        
        if (!this.isIntentionalDisconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => this.connect(), this.getReconnectDelay());
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket connection:', error);
    }
  }

  disconnect(): void {
    this.isIntentionalDisconnect = true;
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type: string, data: any, requestId?: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const message: WebSocketMessage = { type, data, id: requestId || this.generateId() };
      
      if (type !== 'ping' && type !== 'pong') {
        debugLog(`[WebSocket Client] Sending: ${type}`);
      }
      
      if (requestId) {
        this.pendingRequests.set(message.id!, { resolve, reject });
      }

      if (this.ws?.readyState === WebSocket.OPEN) {
        const jsonMessage = JSON.stringify(message);
        
        try {
          this.ws.send(jsonMessage);
          if (!requestId) resolve(undefined);
        } catch (error) {
          console.error(`[WebSocket Client] Failed to send message:`, error);
          reject(error);
        }
      } else {
        console.log(`[WebSocket Client] ⏳ WebSocket not ready (state: ${this.ws?.readyState}), queueing message`);
        this.messageQueue.push(message);
        if (!requestId) resolve(undefined);
      }
    });
  }

  on(eventType: string, handler: MessageHandler): void {
    if (!this.messageHandlers.has(eventType)) {
      this.messageHandlers.set(eventType, new Set());
    }
    this.messageHandlers.get(eventType)!.add(handler);
  }

  off(eventType: string, handler: MessageHandler): void {
    const handlers = this.messageHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  onConnect(handler: ConnectionHandler): void {
    this.connectionHandlers.add(handler);
  }

  onDisconnect(handler: ConnectionHandler): void {
    this.disconnectionHandlers.add(handler);
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleMessage(message: WebSocketMessage): void {
    // Handle ping/pong messages
    if (message.type === 'ping') {
      debugLog('[WebSocket Client] Received ping from server, sending pong');
      this.send('pong', { timestamp: new Date().toISOString() });
      return;
    } else if (message.type === 'pong') {
      debugLog('[WebSocket Client] Received pong from server');
      this.lastPongReceived = new Date();
      return;
    }

    // Handle response to a request
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      resolve(message.data);
      return;
    }

    // Handle broadcast messages
    const handlers = this.messageHandlers.get(message.type);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(message.data);
        } catch (error) {
          console.error(`Error in handler for ${message.type}:`, error);
        }
      });
    }
  }

  private flushMessageQueue(): void {
    console.log(`[WebSocket Client] 📬 Flushing message queue (${this.messageQueue.length} messages)`);
    while (this.messageQueue.length > 0 && this.ws?.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift()!;
      const jsonMessage = JSON.stringify(message);
      
      try {
        this.ws.send(jsonMessage);
        debugLog(`[WebSocket Client] Sent queued message: ${message.type}`);
      } catch (error) {
        console.error(`[WebSocket Client] Failed to send queued message:`, error);
      }
    }
    
    if (this.messageQueue.length > 0) {
      console.log(`[WebSocket Client] ⚠️ ${this.messageQueue.length} messages still in queue after flush`);
    }
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private startHeartbeat(): void {
    console.log('[WebSocket Client] 💓 Starting heartbeat');
    this.stopHeartbeat(); // Clear any existing heartbeat
    this.lastPongReceived = new Date(); // Initialize last pong time
    
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.isConnected()) {
        console.log('[WebSocket Client] ❌ Connection lost during heartbeat check');
        this.stopHeartbeat();
        return;
      }
      
      // Check if we received a pong recently
      if (this.lastPongReceived) {
        const timeSinceLastPong = Date.now() - this.lastPongReceived.getTime();
        if (timeSinceLastPong > this.pongTimeout) {
          console.error(`[WebSocket Client] ⚠️ No pong received for ${timeSinceLastPong}ms, connection may be stale`);
          // Force reconnection
          console.log('[WebSocket Client] 🔄 Forcing reconnection due to stale connection');
          this.ws?.close();
          return;
        }
      }
      
      // Send ping
      debugLog('[WebSocket Client] Sending ping');
      this.send('ping', { timestamp: new Date().toISOString() });
    }, this.heartbeatInterval);
  }
  
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      console.log('[WebSocket Client] 💔 Stopping heartbeat');
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}

// Singleton instance
let wsClient: WebSocketClient | null = null;

export function getWebSocketClient(userId: string): WebSocketClient {
  if (!wsClient || wsClient['userId'] !== userId) {
    wsClient?.disconnect();
    wsClient = new WebSocketClient(userId);
  }
  return wsClient;
}