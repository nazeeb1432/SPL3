/**
 * Fetch API Interceptor
 * 
 * Intercepts and modifies fetch API requests
 */

import { BaseInterceptor } from './base-interceptor';
import { InterceptedRequest } from '../../../shared/types';
import { hasAnyMarkers } from '../../../utils/markers';
import {config} from '@/shared/config';
/**
 * Interceptor for the Fetch API
 */
export class FetchInterceptor extends BaseInterceptor {
  private originalFetch: typeof window.fetch;
  private subscribedEndpoints: string[];
  
  /**
   * Create a new fetch interceptor
   */
  constructor(subscribedEndpoints: string[]) {
    super();
    this.subscribedEndpoints = subscribedEndpoints;
    this.originalFetch = window.fetch;
  }
  
  /**
   * Initialize the fetch interceptor
   */
  public initialize(): void {
    this.log('Initializing fetch interceptor');
    this.overrideFetch();
  }
  
  /**
   * Override the fetch API
   */
  private overrideFetch(): void {
    const self = this;
    
    window.fetch = async function(input: RequestInfo | URL, init?: RequestInit) {
      // Get URL from input
      const url = typeof input === 'string' ? input : 
        input instanceof Request ? input.url : 
        input.toString();
        
      // Skip processing if we don't care about this URL
      if (!self.shouldInterceptUrl(url, self.subscribedEndpoints)) {
        return self.originalFetch.apply(this, [input, init]);
      }
      
      try {
        // Call original fetch
        const response = await self.originalFetch.apply(this, [input, init]);
        
        // Skip processing for error responses
        if (!response.ok) {
          return response;
        }
        
        // Clone responses so we can use them multiple times
        const cloneForPage = response.clone();
        const cloneForProcessing = response.clone();
        
        try {
          // Extract the action name for logging
          const urlObj = new URL(url);
          const segments = urlObj.pathname.split('?')[0].split('/').filter(Boolean);
          const actionName = segments.pop() || 'unknown';
          
          // Get response data - handle different content types
          let responseData: string;
          const contentType = response.headers.get('content-type') || '';
          
          if (contentType.includes('application/json')) {
            // For JSON responses, get the JSON and stringify it
            const jsonData = await cloneForProcessing.json();
            responseData = JSON.stringify(jsonData);
          } else {
            // For HTML/text responses
            responseData = await cloneForProcessing.text();
          }
          
          // Generate a unique request ID
          const requestId = (self.requestIdCounter++).toString();
          
          self.log(`Intercepted Endpoint: ${actionName} response, size: ${responseData.length}, type: ${contentType}`, 'info');
          
          // Log response preview for debugging
          if (self.config.debug.logResponseDetails && typeof responseData === 'string') {
            const preview = responseData.substring(0, 200) + (responseData.length > 200 ? '...' : '');
            self.log(`Response preview: ${preview}`, 'debug');
          }
          
          // Create intercepted request data
          const interceptedData: InterceptedRequest = {
            id: requestId,
            url: url,
            startTime: new Date().toISOString(),
            type: actionName,
            response: responseData
          };
          
          // Dispatch event for content script to handle
          self.dispatchSaveBatchEvent(interceptedData);
          
          // Wait for processed response
          return new Promise<Response>((resolve) => {
            // Set timeout to avoid blocking the page indefinitely
            const timeoutId = setTimeout(() => {
              self.log(`Timeout waiting for processed response for ${requestId}`, 'warn');
              window.removeEventListener('CustomFeedReady', listener);
              resolve(cloneForPage);
            }, config.api.requestTimeoutMs); // 60 second timeout
            
            // Set up listener for processed response
            const listener = function(event: CustomEvent<{id: string, response: string}>) {
              if (event.detail.id === requestId) {
                clearTimeout(timeoutId);
                window.removeEventListener('CustomFeedReady', listener);
                
                self.log(`Received processed response for ${requestId}`, 'info');
                
                // Check for markers
                let finalResponse = event.detail.response;
                const containsMarkers = hasAnyMarkers(finalResponse);
                
                if (containsMarkers) {
                  self.log(`Response contains markers`, 'info');
                }
                
                // Create new response with processed data
                resolve(new Response(finalResponse, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers
                }));
              }
            };
            
            window.addEventListener('CustomFeedReady', listener as EventListener);
          });
        } catch (error) {
          self.log('Error processing response: ' + (error as Error).message, 'error');
          return cloneForPage;
        }
      } catch (error) {
        self.log('Fetch interceptor error: ' + (error as Error).message, 'error');
        return self.originalFetch.apply(this, [input, init]);
      }
    };
  }
}