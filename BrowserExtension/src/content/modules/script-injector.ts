/**
 * Script Injector Module
 * 
 * Provides functionality for injecting scripts into the page.
 */

import { logger } from '@/utils/logger';

/**
 * Inject the TypeScript-compiled interceptor script into the page
 */
export function injectInterceptorScript(): void {
  try {
    // Create a script element
    const script = document.createElement('script');
    
    // Set the source to our web accessible resource (compiled by Vite)
    script.src = chrome.runtime.getURL('injected.js');
    
    // Append the script to the document
    (document.head || document.documentElement).appendChild(script);
    
    // Log injection
    logger.content.info('Interceptor script injection initiated');
    
    // Clean up after load
    script.onload = () => {
      script.remove();
      logger.content.debug('Interceptor script loaded successfully');
    };
  } catch (error) {
    logger.content.error('Failed to inject interceptor script:', error);
  }
} 