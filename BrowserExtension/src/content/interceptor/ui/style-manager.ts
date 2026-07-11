/**
 * Style Manager
 * 
 * Manages CSS styles and variables for the interceptor UI
 * Handles style injection, CSS variable updates, and settings sync
 */

import { CSS_CLASSES, CSS_VARIABLES } from '../../../shared/constants';

/**
 * Class for managing styles in the interceptor
 */
export class StyleManager {
  private config = {
    debug: true
  };
  
  private pendingUpdates: Record<string, string> = {};
  private initialized = false;

  /**
   * Initialize the style manager
   */
  constructor() {
    // this.log('Initializing style manager');
    this.loadStyles();
    this.setupStyleListener();
    this.initialized = true;
    // this.log('Style manager initialized');
  }

  /**
   * Load the CSS styles for the interceptor
   */
  public loadStyles(): void {
    try {
      // We can't use chrome.runtime.getURL() in injected scripts
      // Instead, add CSS directly as an inline style
      const styleElement = document.createElement('style');
      styleElement.id = 'diymod-injected-styles';
      styleElement.textContent = `
        /* DIY-MOD Injected Styles */
        .${CSS_CLASSES.BLUR} {
          filter: blur(var(${CSS_VARIABLES.BLUR_INTENSITY}, 8px));
          transition: filter var(${CSS_VARIABLES.BLUR_TRANSITION}, 0.3s ease);
        }
        
        .${CSS_CLASSES.BLUR}:hover {
          filter: blur(0);
        }
        
        .${CSS_CLASSES.OVERLAY}, .${CSS_CLASSES.CONTENT_OVERLAY} {
          position: relative;
          display: block;
          width: 100%;
          cursor: pointer;
        }

        .${CSS_CLASSES.OVERLAY}::before, .${CSS_CLASSES.CONTENT_OVERLAY}::before {
          content: attr(data-warning);
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: var(${CSS_VARIABLES.OVERLAY_BG}, rgba(0, 0, 0, 0.7));
          color: var(${CSS_VARIABLES.OVERLAY_COLOR}, white);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 9999;
          text-align: center;
          padding: 20px;
          border-radius: 4px;
        }
        
        .${CSS_CLASSES.OVERLAY}:hover::before, .${CSS_CLASSES.CONTENT_OVERLAY}:hover::before {
          display: none;
        }
        
        .${CSS_CLASSES.CONTENT_OVERLAY} .warning {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          bottom: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(${CSS_VARIABLES.OVERLAY_BG}, rgba(0, 0, 0, 0.85));
          color: var(${CSS_VARIABLES.OVERLAY_COLOR}, white);
          padding: 8px;
          border-radius: 4px;
          font-size: 0.9em;
          z-index: 10;
          text-align: center;
          white-space: normal;
          line-height: 1.4;
          border: 1px dashed var(${CSS_VARIABLES.ACCENT_COLOR}, rgb(0, 119, 255));
        }
        
        .${CSS_CLASSES.CONTENT_OVERLAY}.${CSS_CLASSES.HIDDEN} .warning {
          display: none;
        }
        
        .${CSS_CLASSES.CONTENT_OVERLAY} .content {
          position: relative;
          z-index: 1;
          width: 100%;
        }
        
        /* Rewritten content styling - unified implementation */
        .${CSS_CLASSES.REWRITTEN} {
          position: relative;
          margin-top: 20px;
          padding: 8px 8px 8px 10px;
          border: 1px dashed var(${CSS_VARIABLES.ACCENT_COLOR}, #ffd700);
          border-left: 3px solid var(${CSS_VARIABLES.ACCENT_COLOR}, #0077ff);
          border-radius: 8px;
        }
        
        /* Hide the standard ::after label to avoid duplication */
        .${CSS_CLASSES.REWRITTEN}::after {
          display: none !important;
        }
        
        /* Only show the modification-indicator */
        .modification-indicator {
          position: absolute;
          top: -18px;
          right: 10px;
          background: rgba(9, 116, 246, 0.94);
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          color: #ffffff;
          border: 1px solid #ddd;
          z-index: 10;
        }
        
        /* Hide any duplicate indicator divs */
        .${CSS_CLASSES.REWRITTEN} > .${CSS_CLASSES.REWRITTEN},
        .rewritten-content > .modification-indicator {
          display: none !important;
        }
        
        .${CSS_CLASSES.PROCESSING} {
          opacity: 0.5;
          pointer-events: none;
          position: relative;
        }
        
        .${CSS_CLASSES.PROCESSING}::after {
          content: "Processing...";
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0, 0, 0, 0.6);
          color: white;
          padding: 8px 16px;
          border-radius: 4px;
          font-size: 14px;
        }
      `;

      // Add to document head
      (document.head || document.documentElement).appendChild(styleElement);
      
      this.log('Added inline styles to the page');
    } catch (error) {
      console.error('DIY-MOD: Failed to load styles', error);
    }
  }
  
  /**
   * Setup listener for style variable updates
   */
  public setupStyleListener(): void {
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      
      // Update CSS variables when styles are updated
      if (event.data?.type === 'updateStyles' && event.data?.cssVariables) {
        this.log('Received style update','debug');
        this.updateCssVariables(event.data.cssVariables);
      }
      
      // Get initial settings
      if (event.data?.type === 'settingsResponse' && event.data?.settings) {
        this.log('Received initial settings','debug');
        const settings = event.data.settings;
        
        // Extract CSS variables from settings
        const cssVariables = {
          [CSS_VARIABLES.BLUR_INTENSITY]: `${settings.blurIntensity || 8}px`,
          [CSS_VARIABLES.BLUR_TRANSITION]: settings.blurHoverEffect ? '0.3s ease' : '0s',
          [CSS_VARIABLES.HOVER_ENABLED]: settings.blurHoverEffect ? '1' : '0',
          [CSS_VARIABLES.OVERLAY_BG]: settings.darkMode ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.7)',
          [CSS_VARIABLES.OVERLAY_COLOR]: settings.darkMode ? '#ffffff' : '#ffffff',
          [CSS_VARIABLES.ACCENT_COLOR]: settings.accentColor || '#0077ff'
        };
        
        this.updateCssVariables(cssVariables);
      }
    });
    
    // Request settings on init
    window.postMessage({ type: 'getSettings' }, '*');
  }
  
  /**
   * Apply any pending style updates
   * This method is called explicitly by the RequestInterceptor
   * to ensure styles are applied after full initialization
   */
  public applyPendingUpdates(): void {
    if (Object.keys(this.pendingUpdates).length > 0) {
      this.log('Applying pending style updates','debug');
      this.updateCssVariables(this.pendingUpdates);
      this.pendingUpdates = {};
    } else {
      this.log('No pending style updates to apply','debug');
    }
    
    // Force a check for any missed style updates
    window.postMessage({ type: 'getSettings' }, '*');
  }
  
  /**
   * Update CSS variables in the document
   */
  public updateCssVariables(variables: Record<string, string>): void {
    this.log('Updating CSS variables', 'debug');
    // console.log('DIY-MOD Style Manager: Applying CSS variables:', variables);
    
    // Check if we have variables to apply
    if (!variables || Object.keys(variables).length === 0) {
      console.error('DIY-MOD: No CSS variables to apply');
      return;
    }
    
    // If not yet initialized, store for later application
    if (!this.initialized) {
      this.log('Storing CSS variables for later application', 'debug');
      Object.entries(variables).forEach(([key, value]) => {
        this.pendingUpdates[key] = value;
      });
      return;
    }
    
    // Apply variables to :root
    const root = document.documentElement;
    
    Object.entries(variables).forEach(([key, value]) => {
      // this.log(`Setting ${key} = ${value}`);
      root.style.setProperty(key, value);
    });
    
    // // Ensure the styles are applied immediately
    // setTimeout(() => {
    //   // this.log('CSS variables applied. Current values:');
    //   Object.keys(variables).forEach(key => {
    //     const computedValue = getComputedStyle(document.documentElement).getPropertyValue(key);
    //     // this.log(`${key} = ${computedValue}`);
    //   });
    // }, 100);
  }

  /**
   * Log a message if debug is enabled
   */
  private log(message: string, level: 'debug' | 'info' | 'warn' | 'error' = 'info'): void {
    const prefix = 'DIY-MOD Style Manager:';
    
    switch(level) {
      case 'debug':
        if (this.config.debug) {
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