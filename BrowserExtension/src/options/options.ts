/**
 * Options page for DIY-MOD Extension
 */
import { config, loadConfig, saveConfig, setDevelopmentMode, isDevelopment } from '../shared/config';
// import { client } from '../shared/client';
import { CSS_VARIABLES } from '../shared/constants';
import { Filter } from '../shared/types';
import { apiService } from '../shared/api/api-service';

// DOM Elements for authentication
const userInfoEl = document.getElementById('user-info') as HTMLElement;
const signInPromptEl = document.getElementById('sign-in-prompt') as HTMLElement;
const signInBtn = document.getElementById('sign-in') as HTMLButtonElement;
const signOutBtn = document.getElementById('sign-out') as HTMLButtonElement;
const userNameEl = document.getElementById('user-name') as HTMLElement;
const userEmailEl = document.getElementById('user-email') as HTMLElement;
const userAvatarEl = document.getElementById('user-avatar') as HTMLImageElement;

// DOM Elements for server and debug settings
const devModeToggle = document.getElementById('devMode') as HTMLInputElement;
const loggingLevelSelect = document.getElementById('loggingLevel') as HTMLSelectElement;
const apiBaseUrlInput = document.getElementById('apiBaseUrl') as HTMLSpanElement;
const testConnectionBtn = document.getElementById('testConnection') as HTMLButtonElement;
const connectionStatusSpan = document.getElementById('connectionStatus') as HTMLSpanElement;
const userIdInput = document.getElementById('userId') as HTMLInputElement;
const copyUserIdBtn = document.getElementById('copyUserId') as HTMLButtonElement;
const regenerateUserIdBtn = document.getElementById('regenerateUserId') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('saveSettings') as HTMLButtonElement;
const resetDefaultsBtn = document.getElementById('resetDefaults') as HTMLButtonElement;
const saveStatusSpan = document.getElementById('saveStatus') as HTMLSpanElement;

// DOM Elements for new batching settings
const batchingEnabledInput = document.getElementById('batchingEnabled') as HTMLInputElement;
const parallelRequestsEnabledInput = document.getElementById('parallelRequestsEnabled') as HTMLInputElement;
const maxParallelRequestsInput = document.getElementById('maxParallelRequests') as HTMLInputElement;

// DOM Elements for visual settings
const blurIntensityInput = document.getElementById('blurIntensity') as HTMLInputElement;
const blurValueSpan = document.getElementById('blurValue') as HTMLSpanElement;
const blurHoverEffectInput = document.getElementById('blurHoverEffect') as HTMLInputElement;
const overlayStyleSelect = document.getElementById('overlayStyle') as HTMLSelectElement;
const overlayBorderColorInput = document.getElementById('overlayBorderColor') as HTMLInputElement;
const overlayBorderWidthInput = document.getElementById('overlayBorderWidth') as HTMLInputElement;
const showOverlayBorderInput = document.getElementById('showOverlayBorder') as HTMLInputElement;
const rewriteBorderColorInput = document.getElementById('rewriteBorderColor') as HTMLInputElement;
const rewriteBorderWidthInput = document.getElementById('rewriteBorderWidth') as HTMLInputElement;
const showRewriteBorderInput = document.getElementById('showRewriteBorder') as HTMLInputElement;
const syncBordersInput = document.getElementById('syncBorders') as HTMLInputElement;

// DOM Elements for processing settings
const processingModeSelect = document.getElementById('processingMode') as HTMLSelectElement;
const contentTypeSelect = document.getElementById('defaultContentType') as HTMLSelectElement;

// DOM Elements for filter management
const exportFiltersBtn = document.getElementById('exportFilters') as HTMLButtonElement;
const importFiltersBtn = document.getElementById('importFilters') as HTMLButtonElement;
const importInput = document.getElementById('importInput') as HTMLInputElement;
const clearAllFiltersBtn = document.getElementById('clearAllFilters') as HTMLButtonElement;
const refreshFiltersBtn = document.getElementById('refreshFilters') as HTMLButtonElement;
const createFilterBtn = document.getElementById('createFilter') as HTMLButtonElement;
const filterModal = document.getElementById('filter-modal') as HTMLElement;
const filterForm = document.getElementById('filter-form') as HTMLFormElement;
const filterTextField = document.getElementById('filter-text') as HTMLInputElement;
const intensityRange = document.getElementById('intensity') as HTMLInputElement;
const durationSelect = document.getElementById('duration') as HTMLSelectElement;
// const cancelFilterBtn = document.getElementById('cancel-filter') as HTMLButtonElement;
// const saveFilterBtn = document.getElementById('save-filter') as HTMLButtonElement;
const modalCloseBtn = document.querySelector('.modal .close') as HTMLElement;

// Variables for filter modal
let currentFilterId: string | null = null;
let filters: Filter[] = [];

// Load current settings
async function loadSettings(): Promise<void> {
  await loadConfig();
  
  // Set form values for server and debug settings
  if (devModeToggle) devModeToggle.checked = isDevelopment();
  if (loggingLevelSelect) loggingLevelSelect.value = config.logging.level;
  setApiUrlValue(config.api.baseUrl);
  if (userIdInput) userIdInput.value = config.userId || '';
  
  // Set form values for batching settings
  if (batchingEnabledInput) batchingEnabledInput.checked = config.api.batchingEnabled;
  if (parallelRequestsEnabledInput) parallelRequestsEnabledInput.checked = config.api.parallelRequestsEnabled;
  if (maxParallelRequestsInput) maxParallelRequestsInput.value = config.api.maxParallelRequests.toString();
  
  // Set values for default settings
  const defaultDurationSelect = document.getElementById('defaultDuration') as HTMLSelectElement;
  if (defaultDurationSelect && config.userPreferences?.defaultDuration) {
    defaultDurationSelect.value = config.userPreferences.defaultDuration;
  }
  
  if (contentTypeSelect && config.userPreferences?.defaultContentType) {
    contentTypeSelect.value = config.userPreferences.defaultContentType;
  }
  
  // Set form values for visual settings
  if (config.features.userPreferences) {
    // If user preferences exist in config, load them
    if (blurIntensityInput) {
      blurIntensityInput.value = config.userPreferences?.blurIntensity?.toString() || '8';
      if (blurValueSpan) blurValueSpan.textContent = `${blurIntensityInput.value}px`;
    }
    
    if (blurHoverEffectInput) {
      blurHoverEffectInput.checked = config.userPreferences?.blurHoverEffect !== false;
    }
    
    if (overlayStyleSelect) {
      overlayStyleSelect.value = config.userPreferences?.overlayStyle || 'dark';
    }
    
    // Border settings
    if (overlayBorderColorInput && config.userPreferences?.overlayBorderColor) {
      overlayBorderColorInput.value = config.userPreferences.overlayBorderColor;
    }
    
    if (overlayBorderWidthInput && config.userPreferences?.overlayBorderWidth) {
      overlayBorderWidthInput.value = config.userPreferences.overlayBorderWidth.toString();
    }
    
    if (showOverlayBorderInput) {
      showOverlayBorderInput.checked = config.userPreferences?.showOverlayBorder !== false;
    }
    
    if (rewriteBorderColorInput && config.userPreferences?.rewriteBorderColor) {
      rewriteBorderColorInput.value = config.userPreferences.rewriteBorderColor;
    }
    
    if (rewriteBorderWidthInput && config.userPreferences?.rewriteBorderWidth) {
      rewriteBorderWidthInput.value = config.userPreferences.rewriteBorderWidth.toString();
    }
    
    if (showRewriteBorderInput) {
      showRewriteBorderInput.checked = config.userPreferences?.showRewriteBorder !== false;
    }
    
    if (syncBordersInput) {
      syncBordersInput.checked = config.userPreferences?.syncBorders === true;
    }
    
    // Update border controls based on sync setting
    if (syncBordersInput) {
      updateBorderControls(syncBordersInput.checked);
    }
  }
  
  // Set form values for processing settings
  if (processingModeSelect) {
    processingModeSelect.value = config.userPreferences?.processingMode || 'balanced';
  }
}

// Test server connection
async function testConnection(): Promise<void> {
  connectionStatusSpan.textContent = 'Testing...';
  connectionStatusSpan.className = '';
  
  try {
    // // Update API URL from input field
    // const newUrl = apiBaseUrlInput.value.trim();
    // if (newUrl && newUrl !== config.api.baseUrl) {
    //   config.api.baseUrl = newUrl;
    // }
    
    const pingUrl = `${config.api.baseUrl}/ping`;
    const response = await fetch(pingUrl, { method: 'GET' });
    
    if (response.ok) {
      connectionStatusSpan.textContent = 'Test Passed! You can use DIY-MOD!!';
      connectionStatusSpan.className = 'success';
    } else {
      connectionStatusSpan.textContent = `Failed (${response.status})`;
      connectionStatusSpan.className = 'error';
    }
  } catch (error) {
    connectionStatusSpan.textContent = `Error: ${(error as Error).message}`;
    connectionStatusSpan.className = 'error';
  }
  setTimeout(() => {
    connectionStatusSpan.textContent = '';
    connectionStatusSpan.className = '';
  }, 10000);
}

// Save settings
async function saveSettings(): Promise<void> {
  try {
    // Update development mode if element exists
    if (devModeToggle) {
      setDevelopmentMode(devModeToggle.checked);
    }
    
    // Update logging level if element exists
    if (loggingLevelSelect) {
      config.logging.level = loggingLevelSelect.value as 'debug' | 'info' | 'warn' | 'error';
    }
    
    // // Update API URL if element exists
    // if (apiBaseUrlInput) {
    //   config.api.baseUrl = apiBaseUrlInput.value.trim();
    // }
    
    // Update batching settings if elements exist
    if (batchingEnabledInput) {
      config.api.batchingEnabled = batchingEnabledInput.checked;
    }
    
    if (parallelRequestsEnabledInput) {
      config.api.parallelRequestsEnabled = parallelRequestsEnabledInput.checked;
    }
    
    if (maxParallelRequestsInput) {
      config.api.maxParallelRequests = parseInt(maxParallelRequestsInput.value, 10);
    }
    
    // Make sure we have a userPreferences object
    if (!config.userPreferences) {
      config.userPreferences = {};
    }
    
    // Update default settings
    const defaultDurationSelect = document.getElementById('defaultDuration') as HTMLSelectElement;
    if (defaultDurationSelect) {
      config.userPreferences.defaultDuration = defaultDurationSelect.value as 'day' | 'week' | 'month' | 'permanent';
    }
    
    if (contentTypeSelect) {
      config.userPreferences.defaultContentType = contentTypeSelect.value as 'all' | 'text' | 'image';
    }
    
    // Update visual settings
    if (blurIntensityInput) {
      config.userPreferences.blurIntensity = parseInt(blurIntensityInput.value, 10);
    }
    
    if (blurHoverEffectInput) {
      config.userPreferences.blurHoverEffect = blurHoverEffectInput.checked;
    }
    
    if (overlayStyleSelect) {
      config.userPreferences.overlayStyle = overlayStyleSelect.value as 'dark' | 'light';
    }
    
    if (overlayBorderColorInput) {
      config.userPreferences.overlayBorderColor = overlayBorderColorInput.value;
    }
    
    if (overlayBorderWidthInput) {
      config.userPreferences.overlayBorderWidth = parseInt(overlayBorderWidthInput.value, 10);
    }
    
    if (showOverlayBorderInput) {
      config.userPreferences.showOverlayBorder = showOverlayBorderInput.checked;
    }
    
    if (rewriteBorderColorInput) {
      config.userPreferences.rewriteBorderColor = rewriteBorderColorInput.value;
    }
    
    if (rewriteBorderWidthInput) {
      config.userPreferences.rewriteBorderWidth = parseInt(rewriteBorderWidthInput.value, 10);
    }
    
    if (showRewriteBorderInput) {
      config.userPreferences.showRewriteBorder = showRewriteBorderInput.checked;
    }
    
    if (syncBordersInput) {
      config.userPreferences.syncBorders = syncBordersInput.checked;
    }
    
    // Update processing settings if element exists
    if (processingModeSelect) {
      config.userPreferences.processingMode = processingModeSelect.value as 'balanced' | 'aggressive';
    }
    
    // Save config
    await saveConfig();
    
    // Update styles in content scripts
    await updateContentScriptStyles();
    
    // Show success message
    showMessage('Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showMessage(`Error: ${(error as Error).message}`, 'error');
  }
}

// Update content script styles based on current settings
async function updateContentScriptStyles(): Promise<void> {
  // Default values
  const defaultBlurIntensity = 8;
  const defaultOverlayStyle = 'dark';
  const defaultOverlayBorderColor = '#0077ff';
  const defaultOverlayBorderWidth = 1;
  
  // Get values from UI elements or use defaults
  const blurIntensityValue = blurIntensityInput ? parseInt(blurIntensityInput.value, 10) : defaultBlurIntensity;
  const blurHoverEffectValue = blurHoverEffectInput ? blurHoverEffectInput.checked : true;
  const overlayStyleValue = overlayStyleSelect ? overlayStyleSelect.value : defaultOverlayStyle;
  const overlayBorderColorValue = overlayBorderColorInput ? overlayBorderColorInput.value : defaultOverlayBorderColor;
  const overlayBorderWidthValue = overlayBorderWidthInput ? parseInt(overlayBorderWidthInput.value, 10) : defaultOverlayBorderWidth;
  const showOverlayBorderValue = showOverlayBorderInput ? showOverlayBorderInput.checked : true;
  
  const settings = {
    blurIntensity: blurIntensityValue,
    blurHoverEffect: blurHoverEffectValue,
    overlayStyle: overlayStyleValue,
    overlayBorderColor: overlayBorderColorValue,
    overlayBorderWidth: overlayBorderWidthValue,
    showOverlayBorder: showOverlayBorderValue,
    darkMode: overlayStyleValue === 'dark',
    accentColor: overlayBorderColorValue
  };
  
  try {
    // Format CSS variables using standardized names
    const cssVariables = {
      [CSS_VARIABLES.BLUR_INTENSITY]: `${settings.blurIntensity}px`,
      [CSS_VARIABLES.BLUR_TRANSITION]: settings.blurHoverEffect ? '0.3s ease' : '0s',
      [CSS_VARIABLES.OVERLAY_BG]: settings.darkMode ? 'rgba(0, 0, 0, 0.85)' : 'rgba(255, 255, 255, 0.9)',
      [CSS_VARIABLES.OVERLAY_COLOR]: settings.darkMode ? '#ffffff' : '#000000',
      [CSS_VARIABLES.ACCENT_COLOR]: settings.accentColor || '#0077ff'
    };
    
    // Send message to update CSS variables in all tabs
    chrome.runtime.sendMessage({
      type: 'updateStyles',
      cssVariables: cssVariables
    }).catch(error => {
      console.error('Error sending style update message:', error);
    });
  } catch (error) {
    console.error('Error updating content script styles:', error);
  }
}

// Update border controls based on sync setting
function updateBorderControls(syncEnabled: boolean): void {
  // Get rewrite border controls
  const rewriteControls = [
    rewriteBorderColorInput,
    rewriteBorderWidthInput,
    showRewriteBorderInput
  ];
  
  // Enable or disable them based on sync setting
  rewriteControls.forEach(control => {
    if (control) {
      control.disabled = syncEnabled;
    }
  });
  
  // If syncing is enabled, copy overlay values to rewrite
  if (syncEnabled) {
    if (rewriteBorderColorInput && overlayBorderColorInput) {
      rewriteBorderColorInput.value = overlayBorderColorInput.value;
    }
    
    if (rewriteBorderWidthInput && overlayBorderWidthInput) {
      rewriteBorderWidthInput.value = overlayBorderWidthInput.value;
    }
    
    if (showRewriteBorderInput && showOverlayBorderInput) {
      showRewriteBorderInput.checked = showOverlayBorderInput.checked;
    }
  }
}

// Reset to defaults
async function resetDefaults(): Promise<void> {
  if (confirm('Are you sure you want to reset all settings to defaults?')) {
    try {
      // Clear storage
      await chrome.storage.sync.remove(['diy_mod_config', 'diy_mod_dev_mode']);
      localStorage.removeItem('diy_mod_dev_mode');
      
      // Reload settings
      await loadSettings();
      
      // Show success message
      saveStatusSpan.textContent = 'Settings reset to defaults!';
      saveStatusSpan.className = 'success';
      setTimeout(() => {
        saveStatusSpan.textContent = '';
        saveStatusSpan.className = '';
      }, 3000);
    } catch (error) {
      saveStatusSpan.textContent = `Error: ${(error as Error).message}`;
      saveStatusSpan.className = 'error';
    }
  }
}

// Copy User ID to clipboard
function copyUserId(): void {
  const userId = userIdInput.value.trim();
  if (userId) {
    navigator.clipboard.writeText(userId)
      .then(() => {
        userIdInput.select();
        saveStatusSpan.textContent = 'User ID copied to clipboard!';
        saveStatusSpan.className = 'success';
        setTimeout(() => {
          saveStatusSpan.textContent = '';
          saveStatusSpan.className = '';
        }, 2000);
      })
      .catch(err => {
        saveStatusSpan.textContent = `Error copying: ${err}`;
        saveStatusSpan.className = 'error';
      });
  }
}

// Generate new User ID
async function regenerateUserId(): Promise<void> {
  if (confirm('Are you sure you want to generate a new User ID? This will reset your user preferences.')) {
    try {
      // Generate new ID
      const newId = 'user_' + Math.random().toString(36).substring(2, 15) + 
                   Math.random().toString(36).substring(2, 15);
      
      // Save to storage
      await chrome.storage.sync.set({ diy_mod_user_id: newId });
      
      // Update config and UI
      config.userId = newId;
      userIdInput.value = newId;
      
      saveStatusSpan.textContent = 'New User ID generated!';
      saveStatusSpan.className = 'success';
      setTimeout(() => {
        saveStatusSpan.textContent = '';
        saveStatusSpan.className = '';
      }, 2000);
    } catch (error) {
      saveStatusSpan.textContent = `Error: ${(error as Error).message}`;
      saveStatusSpan.className = 'error';
    }
  }
}

// Export filters
async function exportFilters(): Promise<void> {
  try {
    try {
      // Use apiService to get user filters
      const filters = await apiService.getUserFilters();
      
      // Create and download file
      const blob = new Blob([JSON.stringify(filters || [], null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `diy_mod_filters_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      saveStatusSpan.textContent = 'Filters exported successfully';
      saveStatusSpan.className = 'success';
      setTimeout(() => {
        saveStatusSpan.textContent = '';
        saveStatusSpan.className = '';
      }, 3000);
    } catch (error) {
      console.error('Error exporting filters:', error);
      saveStatusSpan.textContent = `Error exporting filters: ${(error as Error).message}`;
      saveStatusSpan.className = 'error';
    }
  } catch (error) {
    console.error('Error exporting filters:', error);
    saveStatusSpan.textContent = `Error exporting filters: ${(error as Error).message}`;
    saveStatusSpan.className = 'error';
  }
}

// Import filters
async function importFilters(event: Event): Promise<void> {
  try {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    
    const content = await file.text();
    let filtersToImport: any[] = [];
    
    try {
      filtersToImport = JSON.parse(content);
    } catch (e) {
      throw new Error('Invalid JSON file format');
    }
    
    if (!Array.isArray(filtersToImport)) {
      throw new Error('Expected an array of filters');
    }
    
    // Import each filter
    let importedCount = 0;
    for (const filter of filtersToImport) {
      try {
        const response = await apiService.createFilter({
          filter_text: filter.filter_text,
          content_type: filter.content_type,
          intensity: filter.intensity,
          duration: filter.duration || 'permanent'
        });
        
        if (response.status === 'success') {
          importedCount++;
        }
      } catch (e) {
        console.warn('Failed to import filter:', filter, e);
      }
    }
    
    if (importedCount > 0) {
      saveStatusSpan.textContent = `${importedCount} filters imported successfully`;
      saveStatusSpan.className = 'success';
    } else {
      saveStatusSpan.textContent = 'No filters were imported';
      saveStatusSpan.className = 'error';
    }
    
    // Reset file input
    input.value = '';
    
    setTimeout(() => {
      saveStatusSpan.textContent = '';
      saveStatusSpan.className = '';
    }, 3000);
  } catch (error) {
    console.error('Error importing filters:', error);
    saveStatusSpan.textContent = `Error importing filters: ${(error as Error).message}`;
    saveStatusSpan.className = 'error';
  }
}

// Clear all filters
async function clearAllFilters(): Promise<void> {
  if (!confirm('Are you sure you want to remove all filters? This cannot be undone.')) {
    return;
  }
  
  try {
    // Get all filters using apiService
    const filters = await apiService.getUserFilters();
    let deletedCount = 0;
    
    // Delete each filter using apiService
    for (const filter of filters) {
      try {
        const response = await apiService.deleteFilter(filter.id);
        
        if (response.status === 'success') {
          deletedCount++;
        }
      } catch (e) {
        console.warn('Failed to delete filter:', filter, e);
      }
    }
    
    if (deletedCount > 0) {
      saveStatusSpan.textContent = `${deletedCount} filters cleared successfully`;
      saveStatusSpan.className = 'success';
    } else {
      saveStatusSpan.textContent = 'No filters were cleared';
      saveStatusSpan.className = 'warn';
    }
    
    setTimeout(() => {
      saveStatusSpan.textContent = '';
      saveStatusSpan.className = '';
    }, 3000);
  } catch (error) {
    console.error('Error clearing filters:', error);
    saveStatusSpan.textContent = `Error clearing filters: ${(error as Error).message}`;
    saveStatusSpan.className = 'error';
  }
}

// Event listeners for form elements
function setupEventListeners(): void {
  // Visual settings
  blurIntensityInput?.addEventListener('input', () => {
    if (blurValueSpan) {
      blurValueSpan.textContent = `${blurIntensityInput.value}px`;
    }
  });
  
  // Sync borders toggle
  syncBordersInput?.addEventListener('change', () => {
    updateBorderControls(syncBordersInput.checked);
  });
  
  // Border control events to sync values when needed
  const overlayBorderControls = [
    overlayBorderColorInput,
    overlayBorderWidthInput,
    showOverlayBorderInput
  ];
  
  overlayBorderControls.forEach(control => {
    control?.addEventListener('change', () => {
      if (syncBordersInput?.checked) {
        // Sync values to rewrite controls
        if (control === overlayBorderColorInput) {
          rewriteBorderColorInput.value = control.value;
        } else if (control === overlayBorderWidthInput) {
          rewriteBorderWidthInput.value = control.value;
        } else if (control === showOverlayBorderInput) {
          showRewriteBorderInput.checked = control.checked;
        }
      }
    });
  });
  
  // Filter management
  exportFiltersBtn?.addEventListener('click', exportFilters);
  importFiltersBtn?.addEventListener('click', () => {
    importInput?.click();
  });
  importInput?.addEventListener('change', importFilters);
  clearAllFiltersBtn?.addEventListener('click', clearAllFilters);
  
  // Filter form buttons
  const cancelFilterBtn = document.getElementById('cancel-filter') as HTMLButtonElement;
  cancelFilterBtn?.addEventListener('click', resetFilterForm);
  
  // Connect the filter form submission to the saveFilter function
  const filterForm = document.getElementById('filter-form') as HTMLFormElement;
  filterForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveFilter();
  });
  
  // Other existing listeners
  testConnectionBtn?.addEventListener('click', testConnection);
  saveSettingsBtn?.addEventListener('click', saveSettings);
  resetDefaultsBtn?.addEventListener('click', resetDefaults);
  copyUserIdBtn?.addEventListener('click', copyUserId);
  regenerateUserIdBtn?.addEventListener('click', regenerateUserId);
  
  // Authentication
  if (signInBtn) {
    signInBtn.addEventListener('click', handleSignIn);
  }
  
  if (signOutBtn) {
    signOutBtn.addEventListener('click', handleSignOut);
  }
  
  // Filter management buttons
  if (refreshFiltersBtn) {
    refreshFiltersBtn.addEventListener('click', loadFilters);
  }
  
  if (createFilterBtn) {
    createFilterBtn.addEventListener('click', openCreateFilterModal);
  }
  
  // Filter modal controls
  if (filterForm) {
    filterForm.addEventListener('submit', saveFilter);
  }
  
  if (cancelFilterBtn) {
    cancelFilterBtn.addEventListener('click', closeFilterModal);
  }
  
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeFilterModal);
  }
  
  // Close modal when clicking outside
  window.addEventListener('click', (event) => {
    if (event.target === filterModal) {
      closeFilterModal();
    }
  });
}

/**
 * Handles the sign in button click
 */
async function handleSignIn(): Promise<void> {
    showMessage('Signing in...', 'info');

    chrome.runtime.sendMessage({ type: 'signIn' }, (response) => {
      if (response && response.success) {
        // Refresh the auth status to show signed-in state
        chrome.runtime.sendMessage({ type: 'getUserInfo' }, (response) => {
          if (response && response.user) {
            updateAuthUI(response.user);
            showMessage('Successfully signed in with Google', 'success');
            loadFilters(); // Load filters after successful sign-in
          }
        });
      } else {
        console.error('Sign in failed:', response?.error);
        showMessage('Failed to sign in with Google', 'error');
      }
    });
}

/**
 * Handles the sign out button click
 */
async function handleSignOut(): Promise<void> {
  try {
    showMessage('Signing out...', 'info');
    
    chrome.runtime.sendMessage({ type: 'signOut' }, (response) => {
      if (response && response.success) {
        // Update UI to reflect signed-out state
        updateAuthUI(null);
        showMessage('Signed out successfully!', 'success');
        loadFilters(); // Load default filters (if any) after successful sign-out
      } else {
        throw new Error(response?.error || 'Sign out failed');
      }
    });
  } catch (error) {
    console.error('Sign-out error:', error);
    showMessage('Failed to sign out. Please try again.', 'error');
  }
}

/**
 * Updates the authentication UI based on user info
 */
function updateAuthUI(userInfo: any): void {
  if (userInfo && userInfo.isGoogle) {
    // User is signed in with Google
    if (userInfoEl) userInfoEl.style.display = 'flex';
    if (signInPromptEl) signInPromptEl.style.display = 'none';
    
    // Update user info - properly access nested user object
    if (userNameEl && userInfo.user && userInfo.user.name) 
      userNameEl.textContent = userInfo.user.name;
    if (userEmailEl && userInfo.user && userInfo.user.email) 
      userEmailEl.textContent = userInfo.user.email;
    if (userAvatarEl && userInfo.user && userInfo.user.picture) 
      userAvatarEl.src = userInfo.user.picture;
  } else {
    // User is not signed in with Google
    if (userInfoEl) userInfoEl.style.display = 'none';
    if (signInPromptEl) signInPromptEl.style.display = 'flex';
    
    // Reset user info fields
    if (userNameEl) userNameEl.textContent = '';
    if (userEmailEl) userEmailEl.textContent = '';
    if (userAvatarEl) userAvatarEl.src = '';
  }
}

/**
 * Check and update authentication state on page load
 */
async function checkAuthState(): Promise<void> {
  try {
    chrome.runtime.sendMessage({ type: 'getUserInfo' }, (response) => {
      if (response && response.user) {
        updateAuthUI(response.user);
        loadFilters(); // Load filters if user is signed in
      }
    });
  } catch (error) {
    console.error('Error checking auth state:', error);
  }
}

// Document load event
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  await checkAuthState();
  console.log('DIY-MOD: Options page initialized');
});

/**
 * Resets the filter form to default values
 */
function resetFilterForm(): void {
  currentFilterId = null;
  
  const filterForm = document.getElementById('filterForm') as HTMLFormElement;
  if (filterForm) {
    filterForm.reset();
  }
  
  const filterNameInput = document.getElementById('filterName') as HTMLInputElement;
  if (filterNameInput) filterNameInput.value = '';
  
  // Reset content type checkboxes
  const contentTypeCheckboxes = document.querySelectorAll('input[name="contentType"]');
  contentTypeCheckboxes.forEach((checkbox: Element) => {
    (checkbox as HTMLInputElement).checked = false;
  });
  
  // Reset intensity slider
  const intensitySlider = document.getElementById('intensitySlider') as HTMLInputElement;
  if (intensitySlider) intensitySlider.value = '5';
  
  // Reset duration radio
  const sessionDurationRadio = document.getElementById('sessionDuration') as HTMLInputElement;
  if (sessionDurationRadio) sessionDurationRadio.checked = true;
}

/**
 * Saves the current filter (create new or update existing)
 */
async function saveFilter(event?: Event): Promise<void> {
  if (event) event.preventDefault();
  
  if (!filterTextField || !contentTypeSelect || !intensityRange || !durationSelect) {
    showMessage('Form elements not found', 'error');
    return;
  }
  
  const filterText = filterTextField.value.trim();
  const contentType = contentTypeSelect.value as 'text' | 'image' | 'all';
  const intensity = parseInt(intensityRange.value, 5);
  const duration = durationSelect.value;
  
  if (!filterText) {
    showMessage('Filter text is required', 'error');
    return;
  }
  
  try {
    let response;
    
    if (currentFilterId) {
      // Update existing filter
      response = await apiService.updateFilter(currentFilterId, {
        filter_text: filterText,
        content_type: contentType,
        intensity: intensity,
        duration: duration
      });
    } else {
      // Create new filter
      response = await apiService.createFilter({
        filter_text: filterText,
        content_type: contentType,
        intensity: intensity,
        duration: duration
      });
    }
    
    if (response.status === 'success') {
      showMessage(`Filter ${currentFilterId ? 'updated' : 'created'} successfully`, 'success');
      closeFilterModal();
      await loadFilters();
    } else {
      throw new Error(response.message || `Failed to ${currentFilterId ? 'update' : 'create'} filter`);
    }
  } catch (error) {
    console.error('Error saving filter:', error);
    showMessage(`Error ${currentFilterId ? 'updating' : 'creating'} filter: ${(error as Error).message}`, 'error');
  }
}

/**
 * Opens the filter modal for creating a new filter
 */
function openCreateFilterModal(): void {
  // Reset form and state
  currentFilterId = null;
  if (filterForm) filterForm.reset();
  
  // Set default values from preferences
  if (contentTypeSelect && config.userPreferences?.defaultContentType) {
    contentTypeSelect.value = config.userPreferences.defaultContentType;
  }
  
  if (durationSelect && config.userPreferences?.defaultDuration) {
    durationSelect.value = config.userPreferences.defaultDuration;
  }
  
  // Update title
  const modalTitle = document.getElementById('modal-title');
  if (modalTitle) modalTitle.textContent = 'Create New Filter';
  
  // Show modal
  if (filterModal) filterModal.style.display = 'block';
}

// Closes the filter modal
function closeFilterModal(): void {
  if (filterModal) filterModal.style.display = 'none';
}

/**
 * Finds a filter by its ID in the loaded filters array
 */
function findFilterById(filterId: string): Filter | undefined {
  return filters.find(f => f.id === filterId);
}

/**
 * Loads filters from the server using the API service
 */
async function loadFilters(): Promise<void> {
  try {
    // Show loading state
    const loadingIndicator = document.getElementById('filters-loading');
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    
    // Get filters from the server
    filters = await apiService.getUserFilters();
    
    // Display filters
    renderFilterTable(filters);
    
    // Hide loading indicator
    if (loadingIndicator) loadingIndicator.style.display = 'none';
  } catch (error) {
    console.error('Error loading filters:', error);
    showMessage('Failed to load filters: ' + (error as Error).message, 'error');
    
    // Hide loading indicator on error
    const loadingIndicator = document.getElementById('filters-loading');
    if (loadingIndicator) loadingIndicator.style.display = 'none';
  }
}

/**
 * Renders the filter table with the provided filters
 */
function renderFilterTable(filters: Filter[]): void {
  const filtersList = document.getElementById('filters-list');
  const filtersTable = document.getElementById('filters-table');
  const noFiltersMsg = document.getElementById('no-filters');
  
  if (!filtersList || !filtersTable || !noFiltersMsg) return;
  
  // Clear existing filters
  filtersList.innerHTML = '';
  
  if (filters.length === 0) {
    filtersTable.style.display = 'none';
    noFiltersMsg.style.display = 'block';
    return;
  }
  
  // Show table, hide no filters message
  filtersTable.style.display = 'table';
  noFiltersMsg.style.display = 'none';
  
  // Add each filter to the table
  filters.forEach(filter => {
    const row = document.createElement('tr');
    
    // Filter text
    const textCell = document.createElement('td');
    textCell.textContent = filter.filter_text;
    row.appendChild(textCell);
    
    // Content type with icon
    const typeCell = document.createElement('td');
    typeCell.innerHTML = getContentTypeIcon(filter.content_type);
    row.appendChild(typeCell);
    
    // Intensity
    const intensityCell = document.createElement('td');
    intensityCell.textContent = filter.intensity.toString();
    row.appendChild(intensityCell);
    
    // Duration
    const durationCell = document.createElement('td');
    if (filter.is_temporary) {
      const expiresAt = filter.expires_at ? new Date(filter.expires_at) : null;
      if (expiresAt) {
        const now = new Date();
        const diffTime = Math.abs(expiresAt.getTime() - now.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        durationCell.textContent = `${diffDays} days`;
      } else {
        durationCell.textContent = 'Temporary';
      }
    } else {
      durationCell.textContent = 'Permanent';
    }
    row.appendChild(durationCell);
    
    // Actions
    const actionsCell = document.createElement('td');
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'action-buttons';
    
    // Edit button
    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-sm btn-icon';
    editBtn.innerHTML = '<i class="fas fa-edit"></i>';
    editBtn.title = 'Edit filter';
    editBtn.onclick = () => editFilter(filter.id);
    actionsDiv.appendChild(editBtn);
    
    // Delete button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-sm btn-danger';
    deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
    deleteBtn.title = 'Delete filter';
    deleteBtn.onclick = () => confirmDeleteFilter(filter.id);
    actionsDiv.appendChild(deleteBtn);
    
    actionsCell.appendChild(actionsDiv);
    row.appendChild(actionsCell);
    
    filtersList.appendChild(row);
  });
}

/**
 * Opens the edit filter modal for a specific filter
 */
function editFilter(filterId: string): void {
  const filter = findFilterById(filterId);
  if (!filter) return;
  
  // Set the current filter ID
  currentFilterId = filterId;
  
  // Update modal title
  const modalTitle = document.getElementById('modal-title');
  if (modalTitle) modalTitle.textContent = 'Edit Filter';
  
  // Set form values
  if (filterTextField) filterTextField.value = filter.filter_text;
  if (contentTypeSelect) contentTypeSelect.value = filter.content_type;
  if (intensityRange) intensityRange.value = filter.intensity.toString();
  
  // Determine the duration value
  let durationValue = 'permanent';
  if (filter.is_temporary && filter.expires_at) {
    const now = new Date();
    const expiresAt = new Date(filter.expires_at);
    const diffDays = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (diffDays <= 1) durationValue = 'day';
    else if (diffDays <= 7) durationValue = 'week';
    else if (diffDays <= 30) durationValue = 'month';
    else durationValue = 'permanent';
  }
  
  if (durationSelect) durationSelect.value = durationValue;
  
  // Show modal
  if (filterModal) filterModal.style.display = 'block';
}

/**
 * Shows a confirmation dialog before deleting a filter
 */
function confirmDeleteFilter(filterId: string): void {
  const filter = findFilterById(filterId);
  if (!filter) return;
  
  if (confirm(`Are you sure you want to delete the filter "${filter.filter_text}"?`)) {
    deleteFilter(filterId);
  }
}

/**
 * Deletes a filter by ID
 */
async function deleteFilter(filterId: string): Promise<void> {
  try {
    const response = await apiService.deleteFilter(filterId);
    
    if (response.status === 'success') {
      showMessage('Filter deleted successfully', 'success');
      // Refresh the filters list
      await loadFilters();
    } else {
      throw new Error(response.message || 'Failed to delete filter');
    }
  } catch (error) {
    console.error('Error deleting filter:', error);
    showMessage('Error deleting filter: ' + (error as Error).message, 'error');
  }
}

/**
 * Shows a message to the user
 */
function showMessage(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
  if (!saveStatusSpan) return;
  
  saveStatusSpan.textContent = message;
  saveStatusSpan.className = type;
  
  setTimeout(() => {
    saveStatusSpan.textContent = '';
    saveStatusSpan.className = '';
  }, 3000);
}

/**
 * Get icon HTML for content type
 */
function getContentTypeIcon(contentType: string): string {
  switch(contentType) {
    case 'text':
      return '<i class="fas fa-file-alt" title="Text Only"></i>';
    case 'image':
      return '<i class="fas fa-image" title="Images Only"></i>';
    case 'all':
    default:
      return '<i class="fas fa-file-alt" title="Text"></i> <i class="fas fa-image" title="Images"></i>';
  }
}

// // Helper functions for API URL display
// function getApiUrlValue(): string {
//   if (apiBaseUrlInput) {
//     if (apiBaseUrlInput instanceof HTMLInputElement) {
//       return apiBaseUrlInput.value;
//     } else {
//       // It's a span element
//       return apiBaseUrlInput.textContent || '';
//     }
//   }
//   return config.api.baseUrl; // Fallback
// }

function setApiUrlValue(url: string): void {
  if (apiBaseUrlInput) {
    if (apiBaseUrlInput instanceof HTMLInputElement) {
      apiBaseUrlInput.value = url;
    } else {
      // It's a span element
      apiBaseUrlInput.textContent = url;
    }
  }
}