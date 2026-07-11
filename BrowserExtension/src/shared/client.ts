/**
 * HTTP client for DIY-MOD extension
 * 
 * Enhanced with batching and parallel LLM call support
 */

import { config } from './config';

// Define interfaces for request batching
interface BatchRequest {
  id: string;
  path: string;
  params: any;
}

interface BatchResponse {
  id: string;
  data: any;
  success: boolean;
  error?: string;
}

export class MainHttpClient {
  private host: string;
  private version: string;
  private pendingBatches: Map<string, BatchRequest[]>;
  private batchCallbacks: Map<string, (responses: BatchResponse[]) => void>;
  private batchTimers: Map<string, number>;

  constructor(host: string) {
    this.host = host;
    // Check if chrome.runtime is available (not in injected scripts)
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      this.version = chrome.runtime.getManifest().version;
    } else {
      // Fallback version for injected scripts
      this.version = '1.0.0';
    }
    this.pendingBatches = new Map();
    this.batchCallbacks = new Map();
    this.batchTimers = new Map();
  }

  getUrl(path: string): string {
    return this.host + path;
  }

  makeRequestBody(params: any): any {
    // Safe way to get URL that works in both content scripts and background
    const getUrl = () => {
      try {
        // Check if document is available (content script)
        if (typeof document !== 'undefined' && document.URL) {
          return document.URL;
        }
        // Background script fallback
        return '';
      } catch (e) {
        return '';
      }
    };

    return {
      tab_id: (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) ? chrome.runtime.id : 'injected-context', // Using runtime ID as tab ID
      user_id: config.userId,
      url: getUrl(),
      extension_version: this.version,
      data: JSON.stringify(params)
    };
  }

  /**
   * Standard post request (backward compatible with original implementation)
   */
  postRequest(
    path: string, 
    params: any = {}, 
    callback: (data: any) => void = () => {}, 
    callbackError: (error: string) => void = () => {}
  ): void {
    const body = this.makeRequestBody(params);
    
    // Only log if debug level is enabled - strictly enforce
    if (config.logging.level === 'debug') {
      console.log("DIY-MOD: Sending request to:", this.getUrl(path));
      console.log("DIY-MOD: Request params:", params);
      console.log("DIY-MOD: Formatted body:", body);
    } else if (config.logging.level === 'info') {
      // For info level, just log the endpoint but not the details
      console.log("DIY-MOD: Sending request to:", this.getUrl(path));
    }
    
    fetch(this.getUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })
      .then(response => {
        // Debug logging only if explicitly set to debug level
        if (config.logging.level === 'debug') {
          console.log("DIY-MOD: Response status:", response.status);
        }
        
        if (response.ok) {
          return response.json();
        } else {
          throw new Error('Network response was not ok: ' + response.statusText);
        }
      })
      .then(data => {
        callback(data);
      })
      .catch(error => {
        // Always log errors
        console.error(`DIY-MOD: ${path} failed with error:`, error.message);
        callbackError(error.message);
      });
  }

  /**
   * Post request that returns a Promise for easier async/await usage
   */
  postRequestPromise(path: string, params: any = {}): Promise<any> {
    return new Promise((resolve, reject) => {
      this.postRequest(
        path, 
        params, 
        (data) => resolve(data), 
        (error) => reject(new Error(error))
      );
    });
  }

  /**
   * Add a request to a batch for parallel execution
   * @param batchId Identifier for the batch
   * @param path API endpoint path
   * @param params Request parameters
   * @returns The request ID within the batch
   */
  addToBatch(batchId: string, path: string, params: any = {}): string {
    // Create a unique ID for this request within the batch
    const requestId = `${batchId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Initialize batch if it doesn't exist
    if (!this.pendingBatches.has(batchId)) {
      this.pendingBatches.set(batchId, []);
      
      // Set a timeout to execute the batch if not manually executed
      const timerId = window.setTimeout(() => {
        this.executeBatch(batchId);
      }, config.api.batchTimeoutMs || 100);
      
      this.batchTimers.set(batchId, timerId);
    }
    
    // Add to pending batch
    const batch = this.pendingBatches.get(batchId) || [];
    batch.push({
      id: requestId,
      path,
      params
    });
    this.pendingBatches.set(batchId, batch);
    
    return requestId;
  }

  /**
   * Execute all requests in a batch in parallel
   * @param batchId Identifier for the batch
   * @returns Promise that resolves with array of results
   */
  executeBatch(batchId: string): Promise<BatchResponse[]> {
    return new Promise((resolve) => {
      // Clear any pending timeout
      if (this.batchTimers.has(batchId)) {
        window.clearTimeout(this.batchTimers.get(batchId));
        this.batchTimers.delete(batchId);
      }
      
      // Get batch requests
      const requests = this.pendingBatches.get(batchId) || [];
      
      // If batch is empty, resolve immediately
      if (requests.length === 0) {
        resolve([]);
        return;
      }
      
      // Store callback for batch completion
      this.batchCallbacks.set(batchId, resolve);
      
      // Log batch execution
      if (config.logging.level === 'debug') {
        console.log(`DIY-MOD: Executing batch '${batchId}' with ${requests.length} requests`);
      }
      
      // Clear the pending batch
      this.pendingBatches.delete(batchId);
      
      // Execute all requests in parallel
      const startTime = performance.now();
      const promises = requests.map(request => {
        return this.postRequestPromise(request.path, request.params)
          .then(data => ({
            id: request.id,
            data,
            success: true
          }))
          .catch(error => ({
            id: request.id,
            data: null,
            success: false,
            error: error.message
          }));
      });
      
      // Process all results
      Promise.all(promises).then(results => {
        const endTime = performance.now();
        
        if (config.logging.level === 'debug' || config.logging.level === 'info') {
          console.log(`DIY-MOD: Batch '${batchId}' completed in ${(endTime - startTime).toFixed(2)}ms`);
        }
        
        // Call the stored callback
        const callback = this.batchCallbacks.get(batchId);
        if (callback) {
          callback(results);
          this.batchCallbacks.delete(batchId);
        }
      });
    });
  }
  
  /**
   * Execute requests in parallel
   * @param requests Array of {path, params} objects
   * @returns Promise with array of results in same order
   */
  executeParallel(requests: {path: string, params: any}[]): Promise<any[]> {
    // Create a temporary batch ID
    const batchId = `parallel-${Date.now()}`;
    
    // Add all requests to the batch
    const requestIds = requests.map(req => 
      this.addToBatch(batchId, req.path, req.params)
    );
    
    // Execute the batch
    return this.executeBatch(batchId).then(results => {
      // Map results back to original order
      return requestIds.map(id => {
        const result = results.find(r => r.id === id);
        if (!result || !result.success) {
          throw new Error(result?.error || 'Unknown error in parallel request');
        }
        return result.data;
      });
    });
  }
  
  logEvent(eventType: string, params: any = {}): void {
    params['event_type'] = eventType;
    
    // Check if logging is enabled (unlike the original implementation where it was commented out)
    if (config.logging.enabled) {
      // Only log the event details at debug level
      if (config.logging.level === 'debug') {
        console.log("DIY-MOD: Logging event:", eventType, params);
      } else if (config.logging.level === 'info') {
        console.log("DIY-MOD: Logging event:", eventType);
      }
      
      // this.postRequest("/event", params);
    }
  }
}

// Export a singleton instance that can be imported throughout the app
export const client = new MainHttpClient(config.api.baseUrl);