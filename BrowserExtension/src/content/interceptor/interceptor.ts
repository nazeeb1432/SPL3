/**
 * Request Interceptor
 * 
 * Intercepts and modifies network requests and responses in the browser
 * 
 * This is compiled by TypeScript and bundled by Vite, then injected into the page
 * for more reliable network interception than the content script can provide.
 */

console.log('[DIY-MOD] Interceptor script loaded!');

// import { MARKERS, CSS_CLASSES, CSS_VARIABLES } from '../../shared/constants';
import { FetchInterceptor } from './network/fetch-interceptor';
import { XhrInterceptor } from './network/xhr-interceptor';
import { DomProcessor } from './ui/dom-processor';
import { StyleManager } from './ui/style-manager';

/**
 * Interceptor module with all functionality needed for request monitoring
 */
export class RequestInterceptor {
  // Configuration
  private config = {
    // Debug settings
    debug: {
      enabled: true,
      logNetworkRequests: false,
      logResponseDetails: true
    },
    
    // API endpoints to intercept
    subscribedEndpoints: [
      // Twitter feeds
      "HomeTimeline", 
      "HomeLatestTimeline",
      // Reddit feeds 
      "home-feed", 
      "popular-feed",
      "all-feed", 
      "best", 
      "hot", 
      "new", 
      "rising", 
      "controversial", 
      "top", 
      "gilded", 
      "promoted", 
      "ads",
      // Reddit pagination endpoints
      "partial",
      "more_posts",
      "partial-more-posts",
      "morecomments",
      "svc/shreddit"
    ]
  };
  
  // Components
  private fetchInterceptor: FetchInterceptor;
  private xhrInterceptor: XhrInterceptor;
  private domProcessor: DomProcessor;
  private styleManager: StyleManager;
  
  // State
  private initialized = false;
  
  /**
   * Initialize interceptor with given options
   */
  constructor() {
    this.log('Initializing network interceptor','debug');
    
    // Create component instances
    this.fetchInterceptor = new FetchInterceptor(this.config.subscribedEndpoints);
    this.xhrInterceptor = new XhrInterceptor(this.config.subscribedEndpoints);
    this.domProcessor = new DomProcessor();
    
    // Initialize style manager
    this.styleManager = new StyleManager();
    
    // Wait for DOM to be ready before initializing
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.init());
    } else {
      this.init();
    }
    
    // Set up messaging for image polling
    this.setupExtensionMessaging();
  }
  
  /**
   * Initialize the interceptor functionality
   */
  private init(): void {
    if (this.initialized) return;
    
    this.log('Setting up network request interceptor');
    
    // Initialize network interceptors
    this.fetchInterceptor.initialize();
    this.xhrInterceptor.initialize();
    
    // Initialize DOM processor
    this.domProcessor.initialize();
    
    // Set up URL change tracking
    this.setupUrlChangeTracking();
    
    // Apply any pending style updates
    this.styleManager.applyPendingUpdates();
    
    this.initialized = true;
    this.log('Network interceptor started');
  }
  
  /**
   * Set up URL change tracking
   */
  private setupUrlChangeTracking(): void {
    // Override history API methods
    const originalPushState = history.pushState;
    history.pushState = function(data: any, unused: string, url?: string | URL | null) {
      const result = originalPushState.apply(this, [data, unused, url]);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
    
    const originalReplaceState = history.replaceState;
    history.replaceState = function(data: any, unused: string, url?: string | URL | null) {
      const result = originalReplaceState.apply(this, [data, unused, url]);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
    
    // Listen for popstate
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('locationchange'));
    });
    
    // Listen for URL changes
    window.addEventListener('locationchange', () => {
      console.log("DIY-MOD: URL changed to", window.location.href);
    });
  }
  
  /**
   * Set up message passing to help with CSP-restricted operations
   */
  private setupExtensionMessaging(): void {
    // Listen for image polling responses from the content script bridge
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      if (event.data.type !== 'diymod_poll_image_response') return;
      
      // Simply forward the message back to any listeners in the same context
      // This ensures the message is available in the web page context
      window.postMessage(event.data, '*');
    });
  }
  
  /**
   * Log a message
   */
  private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'debug'): void {
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
  
  /**
   * Start method - maintained for backward compatibility
   * Initialization is already handled in the constructor
   */
  public start(): void {
    // No-op since initialization is now handled in the constructor
    this.log('start() called, but initialization already handled in constructor');
  }
}

// Initialize and start the interceptor
const interceptor = new RequestInterceptor();
interceptor.start();

// Export for debugging
(window as any).DIY_MOD_INTERCEPTOR = interceptor;