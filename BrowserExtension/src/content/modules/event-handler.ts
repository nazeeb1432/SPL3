/**
 * Event Handler Module
 * 
 * Provides functionality for handling events between content and injected scripts.
 */

import { logger } from '@/utils/logger';
import { InterceptedRequest } from '@/shared/types';
import { getCurrentPlatform } from './platform-detector';
import { processInterceptedRequest } from './api-connector';

/**
 * Set up event listeners for communication with injected script
 */
export function setupEventListeners(): void {
  console.log('[DIY-MOD] Setting up event listeners for SaveBatch events');
  
  // Listen for SaveBatch events from the injected script
  window.addEventListener('SaveBatch', function(event: CustomEvent<InterceptedRequest>) {
    console.log('[DIY-MOD] Received SaveBatch event:', event.detail);
    logger.content.debug('Received SaveBatch event:', { 
      id: event.detail?.id,
      type: event.detail?.type
    });
    
    // Process the intercepted request
    handleInterceptedRequest(event.detail);
  });
  
  // Also listen for message events as a fallback
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    
    // Forward settings requests to background
    if (event.data?.type === 'getSettings') {
      chrome.runtime.sendMessage({ type: 'getSettings' }, response => {
        if (chrome.runtime.lastError) {
          logger.content.warn('Settings request failed:', chrome.runtime.lastError);
          return;
        }
        
        window.postMessage({ 
          type: 'settingsResponse',
          settings: response?.settings || {
            blurHoverEffect: true,
            blurIntensity: 8
          }
        }, '*');
      });
    }
  });
}

/**
 * Handle an intercepted request
 */
async function handleInterceptedRequest(data: InterceptedRequest): Promise<void> {
  try {
    if (!data) {
      logger.content.error('Invalid data received from injected script');
      return;
    }
    
    logger.content.info(`Processing intercepted ${data.type} request`, { 
      id: data.id,
      url: data.url
    });
    
    // Make sure we have response data
    if (!data.response) {
      logger.content.error('No response data in intercepted request');
      sendOriginalResponse(data);
      return;
    }
    
    // Get the platform
    const platform = getCurrentPlatform();
    if (!platform) {
      logger.content.error('Could not determine platform for request');
      sendOriginalResponse(data);
      return;
    }
    
    try {
      console.log('[DIY-MOD] Processing request for platform:', platform);
      
      // Process the feed using the API connector
      const result = await processInterceptedRequest(data, platform);
      
      console.log('[DIY-MOD] Received result from API:', result);
      
      // Validate response format
      if (!result || !result.feed || !result.feed.response) {
        throw new Error('Invalid response format from server');
      }
      
      // Extract the processed content
      let processedResponse = result.feed.response;
      
      // Ensure processedResponse is a string
      if (typeof processedResponse !== 'string') {
        logger.content.warn('Processed response is not a string, converting:', typeof processedResponse);
        // If it's an object, stringify it
        if (typeof processedResponse === 'object') {
          processedResponse = JSON.stringify(processedResponse);
        } else {
          processedResponse = String(processedResponse);
        }
      }
      
      // Send the processed response back to the injected script
      window.dispatchEvent(new CustomEvent('CustomFeedReady', {
        detail: {
          id: data.id,
          url: data.url,
          response: processedResponse
        }
      }));      
    } catch (error) {
      logger.content.error('Error processing content through server:', error);
      console.error('DIY-MOD: Server communication error:', error);
      
      // Send the original response back to avoid blocking the page
      sendOriginalResponse(data);
    }
  } catch (error) {
    logger.content.error('Error handling intercepted request:', error);
    
    // Send the original response back to avoid blocking the page
    sendOriginalResponse(data);
  }
}

/**
 * Send the original response back when processing fails
 */
function sendOriginalResponse(data: InterceptedRequest): void {
  window.dispatchEvent(new CustomEvent('CustomFeedReady', {
    detail: {
      id: data.id,
      url: data.url,
      response: data.response
    }
  }));
} 