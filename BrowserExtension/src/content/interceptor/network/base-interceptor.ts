/**
 * Base Network Interceptor
 * 
 * Provides common functionality and types for network interceptors
 */

import { InterceptedRequest } from '../../../shared/types';

/**
 * Base class for network interceptors
 */
export abstract class BaseInterceptor {
  protected config = {
    debug: {
      enabled: true,
      logNetworkRequests: false,
      logResponseDetails: true
    }
  };
  
  protected requestIdCounter = 0;
  
  /**
   * Initialize the interceptor
   */
  public abstract initialize(): void;
  
  /**
   * Check if a URL should be intercepted based on endpoint patterns
   */
  protected shouldInterceptUrl(url: string, subscribedEndpoints: string[]): boolean {
    let urlObj: URL;
    
    try {
      urlObj = new URL(url);
    } catch (e) {
      return false;
    }
    
    // Check for Reddit domains
    const isReddit = urlObj.hostname.includes('reddit.com');
    
    // Extract the action/endpoint name
    const segments = urlObj.pathname.split('?')[0].split('/').filter(Boolean);
    const actionName = segments.pop();
    
    if (!actionName) return false;
    
    // Direct match
    if (subscribedEndpoints.includes(actionName)) {
      return true;
    }
    
    // For Reddit, also check for partial endpoints with query parameters
    if (isReddit) {
      // Check if this is a pagination request (contains 'after' parameter)
      if (urlObj.searchParams.has('after') || urlObj.searchParams.has('cursor')) {
        // Check if any segment contains our subscribed endpoints
        for (const segment of segments) {
          if (subscribedEndpoints.includes(segment)) {
            return true;
          }
        }
        // Also check the actionName for partial matches
        if (actionName.includes('partial') || actionName.includes('more')) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Dispatch a SaveBatch event to the content script
   */
  protected dispatchSaveBatchEvent(data: InterceptedRequest): void {
    this.log(`Dispatching SaveBatch event for ${data.id}`, 'debug');
    
    // Create and dispatch event
    const event = new CustomEvent('SaveBatch', {
      detail: data
    });
    
    window.dispatchEvent(event);
  }
  
  /**
   * Log a message with the appropriate level
   */
  protected log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = 'DIY-MOD Interceptor:';
    
    switch(level) {
      case 'debug':
        if (this.config.debug.enabled) {
          console.debug(prefix, message);
        }
        break;
      case 'info':
        console.log(prefix, message);
        break;
      case 'warn':
        console.warn(prefix, message);
        break;
      case 'error':
        console.error(prefix, message);
        break;
    }
  }
}