/**
 * Content Script for DIY-MOD Extension
 * 
 * This script runs in the context of web pages and handles:
 * - Injecting the TS-compiled interceptor for request interception
 * - Communication between the injected script and background script
 * - Processing intercepted content with the backend API
 */

import { logger } from '@/utils/logger';
import { config, loadConfig } from '@/shared/config';
import { safeUrlLog, debugLog, logError } from '@/utils/logging';
// import { apiService } from '@/shared/api/api-service';
// import { InterceptedRequest } from '@/shared/types';

// Import modules
import { injectInterceptorScript } from './modules/script-injector';
import { testApiConnection } from './modules/api-connector';
import { setupMessageListeners } from './modules/message-handler';
import { setupEventListeners } from './modules/event-handler';
import { getCurrentPlatform } from './modules/platform-detector';

// Track if we're in debug mode
let isDebugMode = false;

/**
 * Set up a communication bridge between the page context and the extension context
 * This allows us to handle cases where Chrome APIs might not be directly available
 */
function setupExtensionBridge(): void {
  // Listen for API polling requests from the page context
  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    
    // Handle extension ID requests
    if (event.data.type === 'diymod_get_extension_id') {
      window.postMessage({
        type: 'diymod_extension_id',
        extensionId: chrome.runtime.id
      }, '*');
      return;
    }
    
    // Handle WebSocket-based image waiting
    if (event.data.type === 'diymod_wait_for_image') {
      const { requestId, imageUrl, filters } = event.data;

      debugLog('[DIY-MOD Content] Registering for image updates:', safeUrlLog(imageUrl));

      // Import apiService dynamically to access WebSocket functionality
      import('../shared/api/api-service').then(({ apiService }) => {
        
        apiService.waitForImageProcessing(imageUrl, filters, 160000)
          .then(result => {
            debugLog(`[DIY-MOD Content] Image processed: ${safeUrlLog(result)}`);
            // Send the result back to the page context
            window.postMessage({
              type: 'diymod_image_processed',
              requestId,
              result
            }, '*');
          })
          .catch(error => {
            logError('DIY-MOD Content', 'Image processing error:', error.message);
            window.postMessage({
              type: 'diymod_image_processed',
              requestId,
              error: error.message
            }, '*');
          });
      }).catch(error => {
        console.error('[DIY-MOD Content] Failed to import API service:', error);
        window.postMessage({
          type: 'diymod_image_processed',
          requestId,
          error: 'Failed to import API service'
        }, '*');
      });
      return;
    }
    
    // Legacy polling fallback
    if (event.data.type !== 'diymod_poll_image_request') return;
    
    try {
      const { requestId, imageUrl, filters } = event.data;
      
      console.log('[DIY-MOD Content] Received poll request from page:', {
        requestId,
        imageUrl,
        filters
      });
      
      // Forward the request to the background script using Chrome APIs
      chrome.runtime.sendMessage({
        type: 'pollImageResult',
        imageUrl,
        filters
      }, (response) => {
        console.log('[DIY-MOD Content] Received poll response from background:', {
          requestId,
          response
        });
        
        // Send the response back to the page context
        window.postMessage({
          type: 'diymod_poll_image_response',
          requestId,
          response
        }, '*');
      });
    } catch (error) {
      console.error('DIY-MOD: Failed to process image polling request:', error);
      // Send error response back to the page
      window.postMessage({
        type: 'diymod_poll_image_response',
        requestId: event.data.requestId,
        response: { success: false, error: 'Extension communication error' }
      }, '*');
    }
  });
}

/**
 * Initialize the content script
 */
async function initialize(): Promise<void> {
  try {
    // Load configuration
    await loadConfig();
    
    // Enable debug logging in development mode
    if (config.logging.level === 'debug') {
      isDebugMode = true;
      logger.content.info('Debug mode enabled');
    }
    
    // Pass isDebugMode to modules that need it
    const context = {
      isDebugMode,
      getCurrentPlatform
    };
    
    // Ensure background script is ready
    await ensureBackgroundScriptReady();
    
    // Inject the TS-compiled interceptor script
    injectInterceptorScript();
    
    // Set up message listeners for communication with background/popup
    setupMessageListeners(context);
    
    // Set up event listeners for communication with injected script
    setupEventListeners();
    
    // Set up the extension bridge for communication between page and extension contexts
    setupExtensionBridge();
    
    // Log success
    logger.content.info('DIY-MOD Content Script initialized successfully');
    
    // Test the API connection
    testApiConnection();
  } catch (error) {
    logger.content.error('Failed to initialize content script:', error);
  }
}

/**
 * Ensure background script is ready before proceeding
 */
async function ensureBackgroundScriptReady(): Promise<void> {
  return new Promise((resolve) => {
    const checkBackground = () => {
      chrome.runtime.sendMessage({ type: 'getStatus' }, (response) => {
        if (chrome.runtime.lastError) {
          // Background script not ready, retry
          setTimeout(checkBackground, 100);
        } else if (response && response.status === 'active') {
          logger.content.debug('Background script is ready');
          resolve();
        } else {
          // Background script not ready, retry
          setTimeout(checkBackground, 100);
        }
      });
    };
    
    checkBackground();
  });
}



// Initialize the content script
initialize().catch(error => {
  logger.content.error('Content script initialization error:', error);
});