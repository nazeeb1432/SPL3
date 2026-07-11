"use client"

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

interface WebSocketMessage {
  type: string
  data?: any
}

interface ImageProcessedData {
  image_url: string
  result: string
  filters: string[]
}

interface WebSocketContextType {
  isConnected: boolean
  sendMessage: (message: WebSocketMessage) => void
  subscribeToImageUpdates: (imageUrl: string, callback: (processedUrl: string) => void, interventionType?: string, sessionId?: string) => () => void
  sessionId: string
}

const WebSocketContext = createContext<WebSocketContextType | null>(null)

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()
  const reconnectAttemptsRef = useRef(0)
  const imageSubscribersRef = useRef<Map<string, Set<(url: string) => void>>>(new Map())
  
  // Get user ID and session ID - in a real app this would come from auth context
  // Get user ID from environment variables (set in .env.local)
  const userId = process.env.NEXT_PUBLIC_DEFAULT_USER_ID || 'demo-user'
  const sessionId = `json_feed_${Date.now()}`
  const wsUrl = `ws://localhost:8010/ws/${userId}`

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    try {
      // console.log('Connecting to WebSocket:', wsUrl)
      const ws = new WebSocket(wsUrl)
      
      ws.onopen = () => {
        console.log('WebSocket connected')
        setIsConnected(true)
        reconnectAttemptsRef.current = 0
        
        // Send initial ping
        ws.send(JSON.stringify({ type: 'ping' }))
      }
      
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          console.log('WebSocket message received:', message)
          
          if (message.type === 'image_processed' && message.data) {
            const data = message.data as ImageProcessedData
            console.log('Image processed notification received:', {
              image_url: data.image_url,
              result: data.result,
              filters: data.filters
            })
            
            // Notify all subscribers for this image
            const subscribers = imageSubscribersRef.current.get(data.image_url)
            if (subscribers) {
              console.log(`Notifying ${subscribers.size} subscribers for image: ${data.image_url}`)
              subscribers.forEach(callback => callback(data.result))
            } else {
              console.log(`No subscribers found for image: ${data.image_url}`)
            }
          } else if (message.type === 'pong') {
            // Schedule next ping
            setTimeout(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'ping' }))
              }
            }, 1600000) // Ping every 30 seconds
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error)
        }
      }
      
      ws.onerror = (error) => {
        // console.error('WebSocket error:', error)
      }
      
      ws.onclose = () => {
        // console.log('WebSocket disconnected')
        setIsConnected(false)
        wsRef.current = null
        
        // Reconnect with exponential backoff
        const attempts = reconnectAttemptsRef.current
        const delay = Math.max(1000 * Math.pow(2, attempts), 3000000)
        
        console.log(`Reconnecting in ${delay}ms (attempt ${attempts + 1})`)
        
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++
          connect()
        }, delay)
      }
      
      wsRef.current = ws
    } catch (error) {
      console.error('Failed to create WebSocket:', error)
    }
  }, [wsUrl])

  const sendMessage = useCallback((message: WebSocketMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message))
    } else {
      console.warn('WebSocket not connected, cannot send message:', message)
    }
  }, [])

  const subscribeToImageUpdates = useCallback((imageUrl: string, callback: (processedUrl: string) => void, interventionType?: string, sessionIdParam?: string) => {
    // Add subscriber
    if (!imageSubscribersRef.current.has(imageUrl)) {
      imageSubscribersRef.current.set(imageUrl, new Set())
    }
    imageSubscribersRef.current.get(imageUrl)!.add(callback)
    
    // Determine filters based on intervention type and session ID
    let filters: string[] = []
    const effectiveSessionId = sessionIdParam || sessionId
    
    if (interventionType === 'cartoonish') {
      filters = [`custom_cartoonish_${effectiveSessionId}`]
    } else if (interventionType === 'edit_to_replace') {
      filters = [`custom_edit_${effectiveSessionId}`]
    }
    
    console.log(`Subscribing to image updates for ${imageUrl} with filters:`, filters)
    
    // Send wait_for_image message to backend
    sendMessage({
      type: 'wait_for_image',
      data: {
        image_url: imageUrl,
        filters: filters
      }
    })
    
    // Return unsubscribe function
    return () => {
      const subscribers = imageSubscribersRef.current.get(imageUrl)
      if (subscribers) {
        subscribers.delete(callback)
        if (subscribers.size === 0) {
          imageSubscribersRef.current.delete(imageUrl)
        }
      }
    }
  }, [sendMessage, sessionId])

  useEffect(() => {
    connect()
    
    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
      }
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [connect])

  const value: WebSocketContextType = {
    isConnected,
    sendMessage,
    subscribeToImageUpdates,
    sessionId
  }

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  )
}

export function useWebSocket() {
  const context = useContext(WebSocketContext)
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider')
  }
  return context
}