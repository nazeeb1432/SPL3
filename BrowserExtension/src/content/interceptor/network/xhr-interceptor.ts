/**
 * XMLHttpRequest Interceptor
 * 
 * Intercepts and modifies XMLHttpRequest API requests
 */

import { BaseInterceptor } from './base-interceptor';
import { InterceptedRequest } from '../../../shared/types';

/**
 * Extended XHR interface with additional properties
 */
interface ExtendedXHR extends XMLHttpRequest {
  _url?: string;
  _id?: string;
  _startTime?: string;
  _requestHeaders?: Record<string, string>;
  _originalCallback?: any;
}

/**
 * Interceptor for the XMLHttpRequest API
 */
export class XhrInterceptor extends BaseInterceptor {
  private originalOpen: typeof XMLHttpRequest.prototype.open;
  private originalSend: typeof XMLHttpRequest.prototype.send;
  private originalSetRequestHeader: typeof XMLHttpRequest.prototype.setRequestHeader;
  private subscribedEndpoints: string[];
  private eventHandlers: Record<string, any> = {};
  
  /**
   * Create a new XHR interceptor
   */
  constructor(subscribedEndpoints: string[]) {
    super();
    this.subscribedEndpoints = subscribedEndpoints;
    this.originalOpen = XMLHttpRequest.prototype.open;
    this.originalSend = XMLHttpRequest.prototype.send;
    this.originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  }
  
  /**
   * Initialize the XHR interceptor
   */
  public initialize(): void {
    this.log('Initializing XHR interceptor');
    this.overrideXHR();
    this.setupResponseListener();
  }
  
  /**
   * Override XMLHttpRequest methods
   */
  private overrideXHR(): void {
    const self = this;
    
    // Override setRequestHeader to capture headers
    XMLHttpRequest.prototype.setRequestHeader = function(
      this: ExtendedXHR, 
      header: string, 
      value: string
    ) {
      if (!this._requestHeaders) {
        this._requestHeaders = {};
      }
      this._requestHeaders[header] = value;
      return self.originalSetRequestHeader.apply(this, [header, value]);
    };
    
    // Override open to capture URL
    XMLHttpRequest.prototype.open = function(
      this: ExtendedXHR,
      method: string,
      url: string,
      ...args: any[]
    ) {
      this._url = url;
      this._id = (self.requestIdCounter++).toString();
      this._startTime = new Date().toISOString();
      this._requestHeaders = {};
      return self.originalOpen.apply(this, [method, url, ...args] as any);
    };
    
    // Override send to capture response
    XMLHttpRequest.prototype.send = function(
      this: ExtendedXHR,
      body?: Document | XMLHttpRequestBodyInit
    ) {
      // Skip if no URL or not one we care about
      if (!this._url || !self.shouldInterceptUrl(this._url, self.subscribedEndpoints)) {
        return self.originalSend.apply(this, [body]);
      }
      
      // Save original callback
      this._originalCallback = this.onreadystatechange;
      
      // Override callback
      this.onreadystatechange = function(this: ExtendedXHR) {
        if (this.readyState !== XMLHttpRequest.DONE) {
          // Not done yet, call original
          if (this._originalCallback) {
            this._originalCallback.apply(this);
          }
          return;
        }
        
        try {
          // Get response
          const responseData = this.responseText;
          
          if (!responseData || responseData.length === 0) {
            // No data, just call original
            if (this._originalCallback) {
              this._originalCallback.apply(this);
            }
            return;
          }
          
          // Extract action name for logging
          const urlObj = new URL(this._url || '');
          const segments = urlObj.pathname.split('?')[0].split('/').filter(Boolean);
          const actionName = segments.pop() || 'unknown';
          
          self.log(`Intercepted XHR ${actionName} response, size: ${responseData.length}`, 'info');
          
          // Store handler for later usage
          self.eventHandlers[this._id!] = {
            xhr: this,
            callback: this._originalCallback
          };
          
          // Create intercepted request data
          const interceptedData: InterceptedRequest = {
            id: this._id!,
            url: this._url!,
            startTime: this._startTime!,
            type: actionName,
            response: responseData
          };
          
          // Dispatch event for content script to handle
          self.dispatchSaveBatchEvent(interceptedData);
          
        } catch (error) {
          self.log('XHR interceptor error: ' + (error as Error).message, 'error');
          
          // Call original callback in case of error
          if (this._originalCallback) {
            this._originalCallback.apply(this);
          }
        }
      };
      
      return self.originalSend.apply(this, [body]);
    };
  }
  
  /**
   * Set up listener for processed responses
   */
  private setupResponseListener(): void {
    const self = this;
    
    window.addEventListener('CustomFeedReady', function(event: CustomEvent<{id: string, response: string}>) {
      const handler = self.eventHandlers[event.detail.id];
      
      if (handler) {
        // Handle XHR request
        const xhr = handler.xhr as ExtendedXHR;
        
        // Check for markers
        let finalResponse = event.detail.response;
        
        // Override response properties
        Object.defineProperty(xhr, 'responseText', { 
          get: () => finalResponse
        });
        
        Object.defineProperty(xhr, 'response', { 
          get: () => finalResponse
        });
        
        self.log(`Updated XHR response for request ${event.detail.id}`, 'info');
        
        // Call the original callback
        if (handler.callback) {
          handler.callback.apply(xhr);
        }
        
        // Clean up
        delete self.eventHandlers[event.detail.id];
      }
    } as EventListener);
  }
  
  /**
   * Get all current event handlers
   */
  public getEventHandlers(): Record<string, any> {
    return this.eventHandlers;
  }
}