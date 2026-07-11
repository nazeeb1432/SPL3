/**
 * Configuration for DIY-MOD Extension
 * Central place for all configuration settings
 */

import { Platform } from './types';

interface UserPreferences {
  // Visual preferences
  blurIntensity?: number;
  blurHoverEffect?: boolean;
  overlayStyle?: 'dark' | 'light';
  overlayBorderColor?: string;
  overlayBorderWidth?: number;
  showOverlayBorder?: boolean;
  rewriteBorderColor?: string;
  rewriteBorderWidth?: number;
  showRewriteBorder?: boolean;
  syncBorders?: boolean;
  
  // Processing preferences
  processingMode?: 'balanced' | 'aggressive';
  defaultContentType?: 'all' | 'text' | 'image';
  defaultDuration?: 'permanent' | 'day' | 'week' | 'month';
}

interface Config {
  version: string;
  userId: string | null;
  userStudy: {
    active: boolean;
    collectEmail: boolean;
    welcomeURL?: string; // Optional URL for welcome page
    feedbackURL?: string; // Optional URL for feedback form
  };
  api: {
    baseUrl: string;
    pollingBaseUrl: string; // Added polling base URL
    websocketUrl: string; // WebSocket server URL
    endpoints: {
      process: string;
      settings: string;
      filters: string;
      stats: string;
      imageResult: string; // Added endpoint for image result polling
    };
    maxRetries: number;
    requestTimeoutMs: number;
    batchTimeoutMs: number;
    batchingEnabled: boolean;
    parallelRequestsEnabled: boolean;
    maxParallelRequests: number;
    polling: {
      maxAttempts: number; // Added max attempts for polling
      baseIntervalMs: number;  // Added polling interval in milliseconds
      maxIntervalMs?: number; // Optional max interval for exponential backoff
      useCustomTiming: boolean; // Use custom timing instead of exponential backoff
      customTiming: {
        firstTwoAttemptsMs: number; // Interval for first 2 attempts
        remainingAttemptsMs: number; // Interval for remaining attempts
      };
    };
    websockets: {
      useWebSockets: boolean;  // Set to false to disable WebSockets
    };
  };
  features: {
    contentFiltering: boolean;
    imageProcessing: boolean;
    analytics: boolean;
    userPreferences: boolean;
    hideInitialPosts: boolean; // Whether to hide the first few posts on social media sites
  };
  platforms: {
    [key in Platform]: {
      enabled: boolean;
      name: string;
      url: string;
      interceptPatterns: string[];
      selectors: {
        [key: string]: string;
      };
    }
  };
  logging: {
    enabled: boolean;
    level: 'debug' | 'info' | 'warn' | 'error';
    enableRemoteLogging: boolean;
  };
  userPreferences: UserPreferences;
}

// Default configuration
export const config: Config = {
  version: '1.0.0',
  userId: null,
  userStudy: {
    active: true,
    collectEmail: true,
    welcomeURL: 'https://rayhan.io/diymod.github.io/welcome/', // Optional URL for welcome page
    feedbackURL: 'https://rayhan.io/diymod.github.io/feedback/', // Optional URL for feedback form
  },
  api: {
    baseUrl: 'https://api.xxxxxx.io', //'https://api.xxxxxx.io',  // 127.0.0.1:8001 for local testing
    pollingBaseUrl: 'https://api.xxxxxx.io', // 'https://api.xxxxxx.io', // For polling image results, using local endpoint for now
    websocketUrl: 'ws://127.0.0.1:8010/ws', // WebSocket endpoint
    endpoints: {
      // Match the original vanilla implementation endpoints exactly
      process: '/get_feed',
      settings: '/settings',
      filters: '/filters',
      stats: '/stats',
      imageResult: '/get_img_result', // Endpoint for checking image processing status
    },
    maxRetries: 3,
    requestTimeoutMs: 60000,
    batchTimeoutMs: 100,
    batchingEnabled: false,
    parallelRequestsEnabled: true,
    maxParallelRequests: 5,
    polling: {
      maxAttempts: 20, // Maximum number of polling attempts before giving up
      baseIntervalMs: 1000, // Interval between polling attempts (3 seconds)
      maxIntervalMs: 60000, // Maximum interval between polling attempts (60 seconds)
      useCustomTiming: true, // Use custom timing instead of exponential backoff
      customTiming: {
        firstTwoAttemptsMs: 5000, // 5 seconds for first 2 attempts
        remainingAttemptsMs: 2500, // 2.5 seconds for remaining attempts (between 2-3s)
      },
    },
    websockets: {
      useWebSockets: false  // Set to false to disable WebSockets
    },
  },
  userPreferences: {
    // Visual settings
    blurIntensity: 8,
    blurHoverEffect: true,
    overlayStyle: 'dark',
    overlayBorderColor: '#0077ff',
    overlayBorderWidth: 1,
    showOverlayBorder: true,
    rewriteBorderColor: '#ffd700',
    rewriteBorderWidth: 1,
    showRewriteBorder: true,
    syncBorders: false,
    
    // Processing settings
    processingMode: 'balanced',
    defaultContentType: 'all',
    defaultDuration: 'permanent',
  },
  features: {
    contentFiltering: true,
    imageProcessing: true,
    analytics: true,
    userPreferences: true,
    hideInitialPosts: true, // Whether to hide the first few posts on social media sites
  },
  platforms: {
    reddit: {
      enabled: true,
      name: 'Reddit',
      url: 'reddit.com',
      interceptPatterns: [
        '*://www.reddit.com/*',
        '*://reddit.com/*',
        '*://*.reddit.com/*/comments/*',
        '*://*.reddit.com/r/*',
      ],
      selectors: {
        postTitle: 'div[slot="title"]',
        postContent: 'div[slot="text-body"]',
        postImage: 'div[slot="post-media-container"] img',
      },
    },
    twitter: {
      enabled: true,
      name: 'Twitter',
      url: 'twitter.com',
      interceptPatterns: [
        '*://twitter.com/*',
        '*://x.com/*',
        '*://twitter.com/home',
        '*://api.twitter.com/*',
      ],
      selectors: {
        tweetText: 'div[data-testid="tweetText"]',
        tweetImage: 'div[data-testid="tweetPhoto"]',
      },
    },
  },
  logging: {
    enabled: true,
    level: 'info',
    enableRemoteLogging: false,
  },
};

/**
 * Determine if we're in development mode based on both extension manifest and environment
 */
export function isDevelopment(): boolean {
  try {
    // First check for explicit development flag in storage
    const devFlag = localStorage.getItem('diy_mod_dev_mode');
    if (devFlag === 'true') {
      return true;
    }
    if (devFlag === 'false') {
      return false;
    }
    
    // Check if we're in dev mode by looking for update_url in manifest
    // Only try to access chrome.runtime if it exists (not in injected scripts)
    let isDevExtension = false;
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
      const manifest = chrome.runtime.getManifest();
      isDevExtension = !('update_url' in manifest);
    }
    
    // Try to access NODE_ENV from environment if available (for building)
    const isDevEnv = typeof process !== 'undefined' && 
      typeof process.env !== 'undefined' && 
      process.env.NODE_ENV === 'development';
      
    return isDevExtension || isDevEnv;
  } catch {
    // Default to production if we can't determine
    return false;
  }
}

/**
 * Explicitly set development mode
 */
export function setDevelopmentMode(isDev: boolean): void {
  localStorage.setItem('diy_mod_dev_mode', isDev ? 'true' : 'false');
  console.log(`DIY-MOD: Development mode manually set to: ${isDev}`);
}

/**
 * Refresh userId from storage
 */
export async function refreshUserId(): Promise<string | null> {
  config.userId = await loadUserId();
  console.log(`DIY-MOD: Refreshed userId to: ${config.userId}`);
  return config.userId;
}

/**
 * Loads user ID from storage
 */
async function loadUserId(): Promise<string | null> {
  try {
    const storage = await chrome.storage.sync.get(['user_id']);
    console.log('DIY-MOD: storage: ', storage);
    if (storage.user_id) {
      return storage.user_id;
    }
    
    // Generate a new user ID if none exists
    if (!storage.user_id) {
      const newUserId = generateUserId();
      await chrome.storage.sync.set({ user_id: newUserId });
      return newUserId;
    }
    
    return null;
  } catch (error) {
    console.error('Failed to load user ID:', error);
    return null;
  }
}

/**
 * Generate a new user ID
 */
function generateUserId(): string {
  return Math.random().toString(36).substring(2, 15) + 'user_' + Math.random().toString(36).substring(2, 15);
}

/**
 * Loads custom configuration from storage if available
 */
export async function loadConfig(): Promise<void> {
  try {
    // Check if chrome.storage API is available
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      console.warn('DIY-MOD: chrome.storage.sync is not available, using default configuration');
      return; // Exit early and use default config
    }

    // First load the user ID
    // console.log('DIY-MOD: config.userId: ', config.userId);
    config.userId = await loadUserId();
    
    // Then load stored configuration
    const storage = await chrome.storage.sync.get(['diy_mod_config']);
    
    if (storage.diy_mod_config) {
      // Merge stored config with default config, but don't overwrite userId
      const userId = config.userId;
      Object.assign(config, storage.diy_mod_config);
      config.userId = userId; // Ensure userId is preserved
    }
    
    // Check for development environment and adjust settings
    if (isDevelopment()) {
      // In development mode, set to debug to see all logs
      config.logging.level = 'debug';
      console.log('DIY-MOD: Running in development mode with debug logging enabled');
    } else {
      // In production, respect the saved config setting
      console.log(`DIY-MOD: Running in production mode with ${config.logging.level} logging`);
    }
  } catch (error) {
    console.error('Failed to load configuration:', error);
  }
}

/**
 * Set logging level and save it to storage
 */
export async function setLoggingLevel(level: 'debug' | 'info' | 'warn' | 'error'): Promise<void> {
  config.logging.level = level;
  await saveConfig();
}

/**
 * Save current configuration to storage
 */
export async function saveConfig(): Promise<void> {
  try {
    // Check if chrome.storage API is available
    if (!chrome || !chrome.storage || !chrome.storage.sync) {
      console.warn('DIY-MOD: chrome.storage.sync is not available, cannot save configuration');
      return;
    }
    
    await chrome.storage.sync.set({ diy_mod_config: config });
  } catch (error) {
    console.error('Failed to save configuration:', error);
  }
}