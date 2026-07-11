/**
 * Popup State Manager
 * Handles persistence of popup state between user sessions
 */

import { FilterState, FilterData } from '@/shared/types';
// import { useFilterStore } from './filter-store';

// Session state interface
interface PopupSessionState {
  currentState: FilterState;
  filterData: FilterData;
  conversationHistory: any[];
  chatAreaContent: string;
  timestamp: number;
}

// Debounce function to prevent excessive storage writes
const debounce = (func: Function, wait: number) => {
  let timeout: number | null = null;
  return function(...args: any[]) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    if (timeout !== null) clearTimeout(timeout);
    timeout = setTimeout(later, wait) as unknown as number;
  };
};

export class PopupStateManager {
  private lastSavedState: string = '';
  private saveStateDebounced: Function;
  private debug: boolean;

  constructor(debug = false) {
    this.debug = debug;
    this.saveStateDebounced = debounce(this.saveCurrentState.bind(this), 500);
    this.setupStorageListener();
    
    if (debug) {
      // Expose debugging methods on window
      (window as any).diymod = {
        ...(window as any).diymod || {},
        checkStorage: this.checkStorageState.bind(this),
        clearStorage: this.clearStorageState.bind(this),
        saveState: this.saveCurrentState.bind(this),
        restoreState: this.restoreSavedState.bind(this)
      };
      console.log('DIY-MOD: State manager debug tools available via window.diymod');
    }
  }

  /**
   * Setup listener for storage changes from other popup instances
   */
  private setupStorageListener() {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.savedPopupState) {
        if (this.debug) {
          console.log('Storage changed:', changes.savedPopupState);
        }
      }
    });
  }

  /**
   * Check current storage state (debug method)
   */
  async checkStorageState(): Promise<any> {
    return new Promise((resolve) => {
      chrome.storage.local.get(['savedPopupState'], (data) => {
        console.log('Current storage state:', data.savedPopupState);
        resolve(data.savedPopupState);
      });
    });
  }

  /**
   * Clear saved state
   */
  clearStorageState(): Promise<void> {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['savedPopupState'], () => {
        console.log('Storage state cleared');
        this.lastSavedState = '';
        resolve();
      });
    });
  }

  /**
   * Save current state to storage
   * @param currentState Current filter state
   * @param filterData Current filter data
   * @param conversationHistory Conversation history
   * @param chatAreaContent HTML content of the chat area
   */
  saveCurrentState(
    currentState: FilterState,
    filterData: FilterData,
    conversationHistory: any[],
    chatAreaContent: string
  ): void {
    try {
      // Only save if we're in one of these states and have content
      if ((currentState !== FilterState.CLARIFYING && 
          currentState !== FilterState.FILTER_CONFIG) || 
          !chatAreaContent) {
        return;
      }
      
      const stateToSave: PopupSessionState = {
        currentState,
        filterData,
        conversationHistory,
        chatAreaContent,
        timestamp: Date.now()
      };
      
      // Stringify for comparison to avoid unnecessary writes
      const stateString = JSON.stringify({
        currentState: stateToSave.currentState,
        filterData: stateToSave.filterData,
        conversationHistory: conversationHistory.length
      });
      
      // Only save if state has changed
      if (stateString === this.lastSavedState) {
        if (this.debug) console.log('State unchanged, skipping save');
        return;
      }
      
      this.lastSavedState = stateString;
      
      // Save to local storage with callback to confirm
      chrome.storage.local.set({ savedPopupState: stateToSave }, () => {
        if (chrome.runtime.lastError) {
          console.error('Error saving state:', chrome.runtime.lastError);
        } else if (this.debug) {
          console.log('State saved successfully at', new Date().toISOString());
        }
      });
    } catch (error) {
      console.error('Error in saveCurrentState:', error);
    }
  }

  /**
   * Save state with debounce to limit storage operations
   */
  debouncedSave(
    currentState: FilterState,
    filterData: FilterData,
    conversationHistory: any[],
    chatAreaContent: string
  ): void {
    this.saveStateDebounced(currentState, filterData, conversationHistory, chatAreaContent);
  }

  /**
   * Restore saved state if it exists
   * @param currentState Current application state to avoid overwriting active work
   * @returns Promise with restored state or null if no valid state found
   */
  async restoreSavedState(currentState: FilterState): Promise<PopupSessionState | null> {
    try {
      return new Promise((resolve) => {
        chrome.storage.local.get(['savedPopupState'], (data) => {
          if (chrome.runtime.lastError) {
            console.error('Error retrieving state:', chrome.runtime.lastError);
            resolve(null);
            return;
          }
          
          const savedState = data.savedPopupState as PopupSessionState;
          
          if (!savedState) {
            if (this.debug) console.log('No saved state found');
            resolve(null);
            return;
          }
          
          if (this.debug) {
            console.log('Found saved state from', new Date(savedState.timestamp).toLocaleTimeString());
          }
          
          // Check if the state is one we want to restore and not too old (30 minutes)
          const isValidState = savedState.currentState === FilterState.CLARIFYING || 
                              savedState.currentState === FilterState.FILTER_CONFIG;
          const isNotTooOld = Date.now() - savedState.timestamp < 3 * 60 * 1000; // 30 minutes
          
          if (!isValidState || !isNotTooOld) {
            if (this.debug) {
              console.log('State not valid for restoration:', { 
                isValidState, 
                isNotTooOld, 
                state: savedState.currentState,
                age: Math.round((Date.now() - savedState.timestamp) / 1000 / 60) + ' minutes old'
              });
            }
            
            // Clear invalid or old state
            this.clearStorageState();
            resolve(null);
            return;
          }
          
          // Only restore if we're not already in a non-initial state
          // This prevents overwriting current work in progress
          if (currentState !== FilterState.INITIAL && 
              currentState !== FilterState.COMPLETE) {
            if (this.debug) {
              console.log('Already in active state, not restoring:', currentState);
            }
            resolve(null);
            return;
          }
          
          resolve(savedState);
        });
      });
    } catch (error) {
      console.error('Error in restoreSavedState:', error);
      return null;
    }
  }

  /**
   * Handle visibility changes to save state when popup is hidden
   * @param callback Optional callback when visibility changes
   */
  handleVisibilityChanges(
    currentState: FilterState,
    filterData: FilterData,
    conversationHistory: any[],
    chatAreaContent: string,
    callback?: (visible: boolean) => void
  ): void {
    if (document.hidden) {
      // Save state immediately when popup is hidden
      if (this.debug) console.log('Popup hidden, saving state urgently');
      this.saveCurrentState(currentState, filterData, conversationHistory, chatAreaContent);
    } else {
      // Popup became visible
      if (callback) callback(true);
    }
  }
} 