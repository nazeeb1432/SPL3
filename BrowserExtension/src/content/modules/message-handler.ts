/**
 * Message Handler Module
 * 
 * Provides functionality for handling messages between content and background scripts.
 */

import { logger } from '@/utils/logger';
import { CSS_VARIABLES } from '@/shared/constants';

/**
 * Context interface for message handler
 */
export interface MessageContext {
  isDebugMode: boolean;
  getCurrentPlatform: () => any;
}

/**
 * Set up message listeners for communication with background script
 */
export function setupMessageListeners(context: MessageContext): void {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    logger.content.debug('Received message from background script:', message);
    
    if (message.action === 'getStatus') {
      sendResponse({
        status: 'active',
        platform: context.getCurrentPlatform(),
        url: window.location.href,
        debug: context.isDebugMode
      });
      return true;
    }
    
    // Toggle debug mode
    if (message.action === 'toggleDebug') {
      context.isDebugMode = !context.isDebugMode;
      window.postMessage({ type: 'toggleDebug' }, '*');
      sendResponse({ success: true, debug: context.isDebugMode });
      return true;
    }
    
    // Forward settings updates to the injected script
    if (message.type === 'settingsUpdated') {
      handleSettingsUpdate(message.settings);
      sendResponse({ success: true });
      return true;
    }
    
    // Handle style updates
    if (message.type === 'updateStyles' && message.cssVariables) {
      handleStyleUpdate(message.cssVariables);
      sendResponse({ success: true });
      return true;
    }
  });
  
  // Initialize a connection to listen for settings changes
  chrome.runtime.connect({ name: "settings-sync" });
  
  // Get initial settings
  requestInitialSettings();
}

/**
 * Handle settings update message
 */
function handleSettingsUpdate(settings: any): void {
  // Create CSS variables from settings
  const cssVariables = createCssVariables(settings);
  
  // Forward settings
  window.postMessage({ 
    type: 'settingsUpdated',
    settings: settings
  }, '*');
  
  // Also forward CSS variables
  window.postMessage({ 
    type: 'updateStyles',
    cssVariables
  }, '*');
  
  logger.content.info('Forwarded settings update to injected script');
}

/**
 * Handle style update message
 */
function handleStyleUpdate(cssVariables: any): void {
  logger.content.info('Received style update, forwarding to injected script');
  
  // Log the variables for debugging
  console.log('DIY-MOD: Applying style update:', cssVariables);
  
  window.postMessage({ 
    type: 'updateStyles',
    cssVariables: cssVariables
  }, '*');
}

/**
 * Create CSS variables from settings
 */
function createCssVariables(settings: any): Record<string, string> {
  return {
    [CSS_VARIABLES.BLUR_INTENSITY]: `${settings.blurIntensity || 8}px`,
    [CSS_VARIABLES.BLUR_TRANSITION]: settings.blurHoverEffect ? '0.3s ease' : '0s',
    [CSS_VARIABLES.HOVER_ENABLED]: settings.blurHoverEffect ? '1' : '0',
    [CSS_VARIABLES.OVERLAY_BG]: settings.darkMode ? 'rgba(0, 0, 0, 0.85)' : 'rgba(0, 0, 0, 0.7)',
    [CSS_VARIABLES.OVERLAY_COLOR]: settings.darkMode ? '#ffffff' : '#ffffff',
    [CSS_VARIABLES.ACCENT_COLOR]: settings.accentColor || '#0077ff'
  };
}

/**
 * Request initial settings from the background script
 */
function requestInitialSettings(): void {
  chrome.runtime.sendMessage({ type: 'getSettings' }, response => {
    if (chrome.runtime.lastError) {
      logger.content.error('Initial settings request failed, using defaults');
      const defaultSettings = {
        blurHoverEffect: true,
        blurIntensity: 8
      };
      
      window.postMessage({ 
        type: 'settingsResponse',
        settings: defaultSettings
      }, '*');
      return;
    }
    
    const settings = response?.settings || {
      blurHoverEffect: true,
      blurIntensity: 8
    };
    
    // Also convert settings to CSS variables
    const cssVariables = {
      [CSS_VARIABLES.BLUR_INTENSITY]: `${settings.blurIntensity || 8}px`,
      [CSS_VARIABLES.BLUR_TRANSITION]: settings.blurHoverEffect ? '0.3s ease' : '0s',
      [CSS_VARIABLES.HOVER_ENABLED]: settings.blurHoverEffect ? '1' : '0',
      [CSS_VARIABLES.OVERLAY_BG]: settings.overlayStyle === 'dark' ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.9)',
      [CSS_VARIABLES.OVERLAY_COLOR]: settings.overlayStyle === 'dark' ? '#ffffff' : '#000000',
      [CSS_VARIABLES.ACCENT_COLOR]: settings.overlayBorderColor || '#0077ff'
    };
    
    // Send settings to injected script
    window.postMessage({ 
      type: 'settingsResponse',
      settings: settings
    }, '*');
    
    // Also send CSS variables
    window.postMessage({ 
      type: 'updateStyles',
      cssVariables: cssVariables
    }, '*');
    
    logger.content.info('Sent initial settings to injected script');
    console.log('DIY-MOD: Initialized with settings', settings);
  });
} 