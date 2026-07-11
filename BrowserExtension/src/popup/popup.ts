/**
 * DIY-MOD Extension Popup
 * TypeScript implementation of the popup functionality
 */

import { config } from '../shared/config';
import { apiService } from '../shared/api/api-service';
import { useFilterStore } from '../shared/state/filter-store';
import { FilterState, Filter, LLMResponse } from '../shared/types';
import { PopupStateManager } from './popup-state-manager';
// WebSocket status will be managed through background script
import '../popup/popup.css';

/**
 * Chat message in history
 */
interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  type?: string;
}

/**
 * Main Popup Controller
 */
class PopupController {
  // DOM Elements
  private wordInput!: HTMLTextAreaElement;
  private submitBtn!: HTMLButtonElement;
  private imageUploadBtn!: HTMLButtonElement;
  private imageInput!: HTMLInputElement;
  private chatArea!: HTMLDivElement;
  private optionsArea!: HTMLDivElement;
  private filtersBtn!: HTMLButtonElement;
  // Removed unused property: private trendingToggle!: HTMLInputElement;
  private openOptions!: HTMLButtonElement;
  private newChatBtn!: HTMLButtonElement;

  // State variables
  private conversationHistory: ChatMessage[] = [];
  private isShowingFilters = false;
  private currentAttachment: File | null = null;
  private userId: string | null = null;
  private eventListenersInitialized = false;
  private justSavedFilter = false; // Flag to track if we just saved a filter
  private hasCheckedFilters = false; // Flag to track if we've checked filters in this session
  
  // State persistence
  private stateManager: PopupStateManager;
  
  // Access Zustand store
  private get filterStore() {
    return useFilterStore.getState();
  }
  
  // Shorthand getters
  private get currentState() {
    return this.filterStore.currentState;
  }
  
  private get filterData() {
    return this.filterStore.filterData;
  }

  constructor() {
    // Initialize state manager
    this.stateManager = new PopupStateManager(config.logging.enabled);
    
    this.initElements();
    this.init();
  }

  /**
   * Initialize DOM elements
   */
  private initElements() {
    this.wordInput = document.getElementById('wordInput') as HTMLTextAreaElement;
    this.submitBtn = document.getElementById('submitBtn') as HTMLButtonElement;
    this.imageUploadBtn = document.getElementById('imageUploadBtn') as HTMLButtonElement;
    this.imageInput = document.getElementById('imageInput') as HTMLInputElement;
    this.chatArea = document.getElementById('chatArea') as HTMLDivElement;
    this.optionsArea = document.getElementById('optionsArea') as HTMLDivElement;
    this.filtersBtn = document.getElementById('showFilters') as HTMLButtonElement;
    // Removed unused element: this.trendingToggle = document.getElementById('trendingToggle') as HTMLInputElement;
    this.openOptions = document.getElementById('openOptions') as HTMLButtonElement;
    this.newChatBtn = document.getElementById('newChatBtn') as HTMLButtonElement;

    // Disable inputs initially
    this.wordInput.disabled = true;
    this.submitBtn.disabled = true;
    this.imageUploadBtn.disabled = true;
  }

  /**
   * Initialize the popup
   */
  private async init() {
    if (this.eventListenersInitialized) return;
    this.eventListenersInitialized = true;

    try {
      // Initialize user ID
      const data = await chrome.storage.sync.get(['user_id']);
      this.userId = data.user_id || null;

      if (!this.userId) {
        console.log('Waiting for user_id initialization...');
        this.userId = await this.waitForUserId();
      }

      // Enable inputs
      this.wordInput.disabled = false;
      this.submitBtn.disabled = false;
      this.imageUploadBtn.disabled = false;

      // Set up event listeners
      this.setupEventListeners();
      
      // Set up WebSocket status monitoring
      this.setupWebSocketStatus();
      
      // Check for saved state first
      const hasSavedState = await this.restoreSavedState();
      
      // Only check for existing filters if we didn't restore a state
      if (!hasSavedState) {
        this.checkExistingFilters();
      }
      
      // Listen for storage changes from other popup instances
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.savedPopupState && !changes.savedPopupState.newValue) {
          console.log('State cleared detection, justSavedFilter =', this.justSavedFilter);
          
          // Only check existing filters if we didn't just save a filter
          if (!this.justSavedFilter) {
            console.log('State cleared by another popup instance, refreshing...');
            this.resetState();
            this.checkExistingFilters();
          } else {
            // Reset the flag after handling the event
            this.justSavedFilter = false;
          }
        }
      });
    } catch (error) {
      console.error('Initialization error:', error);
      this.showFeedback('Failed to initialize extension', 'error');
    }
  }

  /**
   * Wait for user ID to be initialized
   */
  private waitForUserId(): Promise<string> {
    return new Promise(resolve => {
      const checkUserId = setInterval(() => {
        chrome.storage.sync.get(['user_id'], result => {
          if (result.user_id) {
            clearInterval(checkUserId);
            resolve(result.user_id);
          }
        });
      }, 100);
    });
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners() {
    // Handle submit button click
    this.submitBtn.addEventListener('click', () => this.handleSubmit());

    // Handle image upload button click
    this.imageUploadBtn.addEventListener('click', () => this.imageInput.click());

    // Handle image selection
    this.imageInput.addEventListener('change', e => this.handleImageSelection(e));

    // Handle enter key in input
    this.wordInput.addEventListener('keypress', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSubmit();
      }
    });

    // Auto-resize textarea
    this.wordInput.addEventListener('input', () => {
      this.wordInput.style.height = 'auto';
      this.wordInput.style.height = Math.min(this.wordInput.scrollHeight, 120) + 'px';
    });

    // Event delegation for dynamic elements
    document.addEventListener('click', e => {
      const target = e.target as HTMLElement;

      if (target.matches('.option-button[data-type]') || target.closest('.option-button[data-type]')) {
        this.handleContentTypeSelection(target.closest('.option-button') as HTMLButtonElement);
        this.saveState(); // Save after selection
      } else if (target.matches('.option-button[data-duration]') || target.closest('.option-button[data-duration]')) {
        this.handleDurationSelection(target.closest('.option-button') as HTMLButtonElement);
        this.saveState(); // Save after selection
      } else if (target.matches('.remove-image') || target.closest('.remove-image')) {
        this.removeAttachedImage();
      } else if (target.matches('.remove-filter') || target.closest('.remove-filter')) {
        const button = target.closest('.remove-filter') as HTMLButtonElement;
        this.removeFilter(button.dataset.filterId || '');
      } else if (target.matches('.option-button')) {
        this.handleOptionClick((target as HTMLButtonElement).textContent || '');
        this.saveState(); // Save after option selection
      }
    }, { capture: true });

    // Open options page
    this.openOptions.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    
    // New Chat button - clear current conversation and start fresh
    this.newChatBtn.addEventListener('click', () => this.startNewChat());

    // Use the visibility API to detect when the popup is shown/hidden
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.isShowingFilters) {
        this.loadAndDisplayFilters();
      }
      
      // Handle visibility change with the state manager
      this.stateManager.handleVisibilityChanges(
        this.currentState,
        this.filterData,
        this.conversationHistory,
        this.chatArea.innerHTML,
        (visible) => {
          if (visible) {
            console.log('Popup became visible, checking for saved state...');
            setTimeout(() => this.restoreSavedState(), 100);
          }
        }
      );
    });

    // Add filters button handler
    this.filtersBtn.addEventListener('click', () => this.toggleFiltersView());
    
    // Setup periodic state saving (every 10 seconds) as a backup mechanism
    setInterval(() => {
      if ((this.currentState === FilterState.CLARIFYING || 
          this.currentState === FilterState.FILTER_CONFIG) &&
          this.chatArea.innerHTML) {
        this.saveState();
      }
    }, 10000);
  }

  /**
   * Set up WebSocket status monitoring
   */
  private setupWebSocketStatus() {
    const statusElement = document.getElementById('websocket-status');
    if (!statusElement) return;
    
    // Update status based on message from background
    const updateStatus = (isConnected: boolean) => {
      statusElement.className = 'connection-status';
      
      if (isConnected) {
        statusElement.classList.add('connected');
        statusElement.title = 'Real-time updates active';
      } else {
        statusElement.classList.add('disconnected');
        statusElement.title = 'Real-time updates inactive (using fallback)';
      }
    };
    
    // Request initial status from background
    chrome.runtime.sendMessage({ type: 'getWebSocketStatus' }, (response) => {
      if (response && typeof response.connected === 'boolean') {
        updateStatus(response.connected);
      }
    });
    
    // Listen for status updates from background
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'websocketStatusChanged') {
        updateStatus(message.connected);
      }
    });
  }

  /**
   * Check for existing filters and show prompt
   */
  private async checkExistingFilters() {
    // Skip if we've already checked once in this session or if userId is missing
    if (this.hasCheckedFilters || !this.userId) return;
    
    try {
      const response = await fetch(`${config.api.baseUrl}/filters?user_id=${this.userId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      
      const data = await response.json();
      if (data.status === 'success' && data.filters && data.filters.length > 0) {
        const welcomeMessage = "Welcome back! I found your existing content preferences. Would you like to review them?";
        
        // Add welcome message to conversation history before displaying it
        this.conversationHistory.push({
          role: 'assistant',
          content: welcomeMessage,
          type: 'clarify' // Add the message type to provide better context for LLM
        });
        
        this.showChatMessage(
          welcomeMessage,
          'assistant',
          ["Yes, show my filters", "No, something else"]
        );
      }
      
      // Mark that we've checked filters in this session
      this.hasCheckedFilters = true;
    } catch (error) {
      console.error('Error checking filters:', error);
    }
  }

  /**
   * Handle submit button click
   */
  private handleSubmit() {
    const input = this.wordInput.value.trim();
    const hasAttachment = this.currentAttachment !== null;
    
    // Require either text input or image attachment
    if (!input && !hasAttachment) return;
    
    // If showing filters, switch back to chat view
    if (this.isShowingFilters) {
      this.toggleFiltersView();
    }
    
    // For text input, show in chat
    if (input) {
      this.showChatMessage(input, 'user');
      this.wordInput.value = '';
      this.wordInput.style.height = 'auto';
    }
    // For image, show a placeholder message
    else if (hasAttachment) {
      this.showChatMessage("I'd like to create a filter for this image", 'user');
    }
    
    // Reset state if we're starting a new conversation
    if (this.currentState === FilterState.COMPLETE) {
      this.resetState();
    }
    
    // Save state after user input - use debounced version
    this.saveState();
    
    if (hasAttachment) {
      this.sendImageToLLM(input);
    } else {
      this.sendToLLM(input);
    }
  }

  /**
   * Handle image selection
   */
  private handleImageSelection(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    
    // Check if file is an image
    if (!file.type.match('image.*')) {
      this.showFeedback('Please select an image file', 'error');
      return;
    }
    
    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      this.showFeedback('Image too large (max 5MB)', 'error');
      return;
    }
    
    // Store the file
    this.currentAttachment = file;
    
    // Display image preview
    const reader = new FileReader();
    reader.onload = (event) => {
      const imgPreview = document.createElement('div');
      imgPreview.className = 'image-preview';
      imgPreview.innerHTML = `
        <img src="${event.target?.result}" alt="Attached image">
        <button class="remove-image">
          <i class="fas fa-times"></i>
        </button>
      `;
      
      // Clear previous preview if exists
      const existingPreview = document.querySelector('.image-preview');
      if (existingPreview) {
        existingPreview.remove();
      }
      
      // Add preview before input group
      const inputGroup = document.querySelector('.input-group');
      if (inputGroup && inputGroup.parentNode) {
        inputGroup.parentNode.insertBefore(imgPreview, inputGroup);
      }
    };
    
    reader.readAsDataURL(file);
  }

  /**
   * Remove attached image
   */
  private removeAttachedImage() {
    this.currentAttachment = null;
    const imgPreview = document.querySelector('.image-preview');
    if (imgPreview) {
      imgPreview.remove();
    }
    if (this.imageInput) {
      this.imageInput.value = '';
    }
  }

  /**
   * Send image to LLM for processing
   */
  private async sendImageToLLM(userInput: string = '') {
    if (!this.currentAttachment) return;
    
    // Disable inputs while processing
    this.wordInput.disabled = true;
    this.submitBtn.disabled = true;
    this.imageUploadBtn.disabled = true;
    
    // Show loading indicator
    this.showChatMessage('Analyzing image...', 'assistant');
    
    // Create form data
    const formData = new FormData();
    formData.append('image', this.currentAttachment);
    if (userInput) {
      formData.append('message', userInput);
    }
    
    // Add relevant history
    const relevantHistory = this.conversationHistory.slice(
      this.conversationHistory.findIndex(msg => msg.type === 'content_type') || 0
    );
    formData.append('history', JSON.stringify(relevantHistory));
    
    try {
      // Send to backend
      const response = await fetch(`${config.api.baseUrl}/chat/image`, {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      
      const data: LLMResponse = await response.json();
      console.log('LLM Response for image:', data);
      
      if (data.status === 'success') {
        // Add to conversation history
        if (userInput) {
          this.conversationHistory.push({ role: 'user', content: userInput });
        } else {
          this.conversationHistory.push({ 
            role: 'user', 
            content: "I'd like to create a filter for this image" 
          });
        }
        
        // Clear the image attachment
        this.removeAttachedImage();
        
        // Handle the response based on state
        this.handleLLMResponse(data);
        
        // Add assistant's response to history
        this.conversationHistory.push({
          role: 'assistant',
          content: data.text
        });
      } else {
        throw new Error(data.message || 'Server error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showFeedback((error as Error).message || 'Network error. Please try again.', 'error');
      this.showChatMessage('Sorry, there was an error processing your image. Please try again.', 'assistant', ['Try again']);
    } finally {
      // Re-enable inputs
      this.wordInput.disabled = false;
      this.submitBtn.disabled = false;
      this.imageUploadBtn.disabled = false;
    }
  }

  /**
   * Send text to LLM for processing
   */
  private async sendToLLM(userInput: string) {
    // Only send relevant history for the current filter
    const relevantHistory = this.conversationHistory.slice(
      this.conversationHistory.findIndex(msg => msg.type === 'content_type') || 0
    );
    
    // Disable inputs while waiting for response
    this.wordInput.disabled = true;
    this.submitBtn.disabled = true;
    
    try {
      const response = await fetch(`${config.api.baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userInput,
          history: relevantHistory,
          user_id: this.userId
        })
      });
      
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
      
      const data: LLMResponse = await response.json();
      console.log('LLM Response:', data);
      
      if (data.status === 'success') {
        // Log filter data specifically
        console.log('Filter Data from LLM:', data.filter_data);
        
        // Add to conversation history
        this.conversationHistory.push({ role: 'user', content: userInput });
        
        // Handle the response
        this.handleLLMResponse(data);
        
        // Add assistant's response to history
        this.conversationHistory.push({
          role: 'assistant',
          content: data.text
        });
      } else {
        throw new Error(data.message || 'Server error');
      }
    } catch (error) {
      console.error('Error:', error);
      this.showFeedback((error as Error).message || 'Network error. Please try again.', 'error');
      this.showChatMessage('Sorry, there was an error. Please try again.', 'assistant', ['Try again']);
    } finally {
      // Re-enable inputs
      this.wordInput.disabled = false;
      this.submitBtn.disabled = false;
    }
  }

  /**
   * Handle LLM response based on current state
   */
  private handleLLMResponse(data: LLMResponse) {
    // Display response message
    this.showChatMessage(data.text, 'assistant', data.options);
    
    // Let filter store handle state transitions and data updates
    this.filterStore.handleResponse(data);
    
    // Force update UI to reflect state changes
    this.updateInputPlaceholder();
    
    // If we're in FILTER_CONFIG state after the response, explicitly show the config UI
    if (this.currentState === FilterState.FILTER_CONFIG && this.filterData.text) {
      this.showFilterConfigUI();
    }
    
    // Save state after processing response
    this.saveState();
    
    // Scroll chat area to bottom to show the latest message
    if (this.chatArea) {
      setTimeout(() => {
        this.chatArea.scrollTop = this.chatArea.scrollHeight;
      }, 100);
    }
  }

  /**
   * Show the filter configuration UI
   */
  private showFilterConfigUI() {
    // Clear existing options/config UI
    this.optionsArea.innerHTML = '';
    
    const configUI = document.createElement('div');
    configUI.className = 'filter-config';
    
    // Pre-select values from the store
    const contentTypeValue = this.filterData.contentType || 'all';
    const intensityValue = this.filterData.intensity || 3;
    const durationValue = this.filterData.duration || 'permanent';
    
    configUI.innerHTML = `
      <div class="config-section">
        <div class="config-header">
          <h3>Filter: "${this.filterData.text}"</h3>
          <button class="modify-filter-btn">Modify Filter</button>
        </div>
        <div class="config-section">
          <h3>Content Type</h3>
          <div class="button-group content-type-options">
            <button class="option-button ${contentTypeValue === 'text' ? 'selected' : ''}" data-type="text">Text Only</button>
            <button class="option-button ${contentTypeValue === 'image' ? 'selected' : ''}" data-type="image">Images Only</button>
            <button class="option-button ${contentTypeValue === 'all' ? 'selected' : ''}" data-type="all">Both</button>
          </div>
        </div>
        <div class="config-section">
          <h3>Sensitivity</h3>
          <div class="slider-container intensity-options">
            <input type="range" class="intensity-slider" min="1" max="5" value="${intensityValue}">
            <div class="slider-labels">
              <span>Mild</span>
              <span>Moderate</span>
              <span>Strict</span>
            </div>
          </div>
        </div>
        <div class="config-section">
          <h3>Duration</h3>
          <div class="button-group duration-options">
            <button class="option-button ${durationValue === 'permanent' ? 'selected' : ''}" data-duration="permanent">Permanent</button>
            <button class="option-button ${durationValue === 'day' ? 'selected' : ''}" data-duration="day">24 Hours</button>
            <button class="option-button ${durationValue === 'week' ? 'selected' : ''}" data-duration="week">1 Week</button>
          </div>
        </div>
        <button class="save-config">Save Filter</button>
      </div>
    `;
    
    this.optionsArea.appendChild(configUI);
    
    // Add event listeners for configuration options
    this.setupConfigEventListeners(configUI);
    
    // Make sure all options are visible
    setTimeout(() => {
      if (this.optionsArea) {
        this.optionsArea.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }, 300);
  }

  /**
   * Handle option button clicks
   */
  private handleOptionClick(option: string) {
    if (option === "Yes, show my filters") {
      this.chatArea.innerHTML = '';
      this.loadAndDisplayFilters();
      return;
    } else if (option === "Add another filter") {
      this.resetState();
      this.chatArea.innerHTML = '';
      return;
    } else if (option === "I'm done") {
      this.resetState();
      
      // Clear saved state when user explicitly indicates they're done
      this.stateManager.clearStorageState();
      
      return;
    } else if (option === "Try again") {
      return;
    }
    
    // Handle other options as user messages
    this.showChatMessage(option, 'user');
    this.conversationHistory.push({
      role: 'user',
      content: option
    });
    
    this.sendToLLM(option);
    this.optionsArea.innerHTML = '';
  }

  /**
   * Handle content type selection
   */
  private handleContentTypeSelection(button: HTMLButtonElement) {
    document.querySelectorAll('.option-button[data-type]').forEach(btn => 
      btn.classList.remove('selected'));
    button.classList.add('selected');
    
    // Update in Zustand store
    this.filterStore.updateFilterData({
      contentType: button.dataset.type as 'text' | 'image' | 'all'
    });
  }

  /**
   * Handle duration selection
   */
  private handleDurationSelection(button: HTMLButtonElement) {
    document.querySelectorAll('.option-button[data-duration]').forEach(btn => 
      btn.classList.remove('selected'));
    button.classList.add('selected');
    
    // Update in Zustand store
    this.filterStore.updateFilterData({
      duration: button.dataset.duration || 'permanent'
    });
  }

  /**
   * Setup event listeners for filter configuration
   */
  private setupConfigEventListeners(configUI: HTMLElement) {
    // Content type buttons
    const contentTypeButtons = configUI.querySelectorAll('.content-type-options .option-button');
    contentTypeButtons.forEach(button => {
      button.addEventListener('click', () => {
        contentTypeButtons.forEach(b => b.classList.remove('selected'));
        button.classList.add('selected');
        const contentType = button.getAttribute('data-type') as 'text' | 'image' | 'all';
        if (contentType) {
          this.filterStore.updateFilterData({
            contentType
          });
        }
      });
    });
    
    // Intensity slider
    const intensitySlider = configUI.querySelector('.intensity-slider') as HTMLInputElement;
    if (intensitySlider) {
      intensitySlider.addEventListener('input', () => {
        this.filterStore.updateFilterData({
          intensity: parseInt(intensitySlider.value)
        });
      });
    }
    
    // Duration buttons
    const durationButtons = configUI.querySelectorAll('.duration-options .option-button');
    durationButtons.forEach(button => {
      button.addEventListener('click', () => {
        durationButtons.forEach(b => b.classList.remove('selected'));
        button.classList.add('selected');
        const duration = button.getAttribute('data-duration');
        if (duration) {
          this.filterStore.updateFilterData({
            duration
          });
        }
      });
    });
    
    // Save button
    const saveButton = configUI.querySelector('.save-config');
    if (saveButton) {
      saveButton.addEventListener('click', this.handleConfigSave.bind(this));
    }
    
    // Modify filter button
    const modifyButton = configUI.querySelector('.modify-filter-btn');
    if (modifyButton) {
      modifyButton.addEventListener('click', () => {
        // Change state back to CLARIFYING
        this.filterStore.transitionTo(FilterState.CLARIFYING);
        
        // Clear the config UI
        this.optionsArea.innerHTML = '';
        
        // Update placeholder to indicate clarification mode
        this.updateInputPlaceholder();
        
        // Show message asking for modification
        this.showChatMessage(
          `You're modifying your filter: "${this.filterData.text}". Please tell me what you'd like to change.`, 
          'assistant'
        );
      });
    }
  }

  /**
   * Save filter configuration
   */
  private async handleConfigSave() {
    try {
      // Get selected values from UI
      const contentTypeBtn = document.querySelector('.option-button[data-type].selected') as HTMLButtonElement;
      const intensitySlider = document.querySelector('.intensity-slider') as HTMLInputElement;
      const durationBtn = document.querySelector('.option-button[data-duration].selected') as HTMLButtonElement;
      
      if (!contentTypeBtn || !intensitySlider || !durationBtn) {
        this.showFeedback('Please select all options before saving', 'error');
        return;
      }
      
      // Update filter data in store with UI values
      this.filterStore.updateFilterData({
        contentType: contentTypeBtn.dataset.type as 'text' | 'image' | 'all',
        intensity: parseInt(intensitySlider.value),
        duration: durationBtn.dataset.duration || 'permanent'
      });
      
      const { text, contentType, intensity, duration } = this.filterData;
      
      if (!text) {
        console.error('Filter text is missing:', this.filterData);
        this.showFeedback('Filter text not found. Please try again.', 'error');
        return;
      }
      
      if (!this.userId) {
        this.showFeedback('User ID not found', 'error');
        return;
      }
      
      // Use the API service to create filter
      try {
        const response = await apiService.createFilter({
          filter_text: text,
          content_type: contentType,
          intensity: intensity,
          duration: duration
        });
        
        if (response.status === 'success') {
          // Set flag to indicate we just saved a filter
          this.justSavedFilter = true;
          
          // Clear saved state immediately after successful save
          // This ensures we don't restore this state when popup is reopened
          await this.stateManager.clearStorageState();
          
          // Transition to complete state
          this.filterStore.transitionTo(FilterState.COMPLETE);
          
          // Clear chat and input
          this.chatArea.innerHTML = '';
          this.wordInput.value = '';
          
          // Show success message with options
          this.showChatMessage('Filter saved successfully! Would you like to add another?', 'assistant', 
            ['Add another filter', 'I\'m done']);
        } else {
          throw new Error(response.message || 'Failed to save filter');
        }
      } catch (error) {
        throw error;
      }
    } catch (error) {
      console.error('Error saving filter:', error);
      this.showFeedback(`Failed to save filter: ${(error as Error).message}`, 'error');
    }
  }

  /**
   * Start a new chat by clearing current conversation and state
   */
  private startNewChat() {
    // If already in initial state with no conversation, do nothing
    if (this.currentState === FilterState.INITIAL && 
        this.conversationHistory.length === 0 && 
        !this.chatArea.innerHTML) {
      return;
    }

    // Confirm before clearing if in the middle of a conversation
    if (this.currentState !== FilterState.INITIAL && 
        this.currentState !== FilterState.COMPLETE) {
      if (!confirm('This will clear your current conversation. Continue?')) {
        return;
      }
    }
    
    // Clear conversation history
    this.conversationHistory = [];
    
    // Clear chat area
    this.chatArea.innerHTML = '';
    
    // Reset message count attribute
    this.chatArea.setAttribute('data-message-count', '0');
    
    // Clear input field
    this.wordInput.value = '';
    
    // Reset filter data and state
    this.filterStore.reset();
    
    // Clear any saved state
    this.stateManager.clearStorageState();
    
    // Reset any image attachments
    this.removeAttachedImage();
    
    const welcomeMessage = "Hi! I'm here to help manage content that affects you. What would you like to discuss today?";
      
    // Add welcome message to conversation history before displaying it
    this.conversationHistory.push({
      role: 'assistant',
      content: welcomeMessage,
    });

    // Show welcome message
    this.showChatMessage(
      welcomeMessage, 
      'assistant'
    );
  }

  /**
   * Toggle between filters view and chat view
   */
  private toggleFiltersView() {
    // If we're in the middle of a chat configuration, don't allow toggle
    if (this.currentState !== FilterState.INITIAL && 
        this.currentState !== FilterState.COMPLETE) {
      this.showFeedback('Please complete the current configuration first', 'error');
      return;
    }
    
    this.isShowingFilters = !this.isShowingFilters;
    this.filtersBtn.classList.toggle('active');
    
    if (this.isShowingFilters) {
      // Store current chat content
      if (!this.chatArea.hasAttribute('data-chat-content')) {
        this.chatArea.setAttribute('data-chat-content', this.chatArea.innerHTML);
      }
      // Load and display filters
      this.loadAndDisplayFilters();
    } else {
      // Restore previous chat content if it exists
      if (this.chatArea.hasAttribute('data-chat-content')) {
        this.chatArea.innerHTML = this.chatArea.getAttribute('data-chat-content') || '';
        this.chatArea.removeAttribute('data-chat-content');
      } else {
        this.chatArea.innerHTML = '';
      }
    }
  }

  /**
   * Load and display user filters using the API service
   */
  private async loadAndDisplayFilters() {
    if (!this.userId) {
      this.showFeedback('User ID not found', 'error');
      return;
    }
    
    try {
      // Use the API service to get user filters
      const filters = await apiService.getUserFilters();
      this.displayUserFilters(filters);
    } catch (error) {
      console.error('Error loading filters:', error);
      this.showFeedback('Failed to load filters', 'error');
    }
  }

  /**
   * Display user filters in the chat area
   */
  private displayUserFilters(filters: Filter[]) {
    this.chatArea.innerHTML = '';
    
    if (filters.length === 0) {
      const noFiltersMsg = document.createElement('div');
      noFiltersMsg.className = 'chat-message assistant';
      noFiltersMsg.textContent = 'You don\'t have any active content filters.';
      this.chatArea.appendChild(noFiltersMsg);
      return;
    }
    
    const header = document.createElement('div');
    header.className = 'chat-message assistant';
    header.textContent = 'Your active content filters:';
    this.chatArea.appendChild(header);
    
    filters.forEach((filter, index) => {
      const filterMsg = document.createElement('div');
      filterMsg.className = 'chat-message assistant filter-item';
      
      const duration = filter.is_temporary ? 
        `(${filter.expires_at ? 'until ' + new Date(filter.expires_at).toLocaleDateString() : 'temporary'})` : 
        '(permanent)';
      
      filterMsg.innerHTML = `
        ${index + 1}. "${filter.filter_text}" 
        <br>Type: ${filter.content_type}
        <br>Intensity: ${filter.intensity}/5
        <br>${duration}
        <button class="remove-filter" data-filter-id="${filter.id}">Remove</button>
      `;
      
      this.chatArea.appendChild(filterMsg);
    });
  }

  /**
   * Remove a filter using the API service
   */
  private async removeFilter(filterId: string) {
    if (!this.userId) {
      this.showFeedback('User ID not found', 'error');
      return;
    }
    
    try {
      // Use the API service to delete a filter
      const response = await apiService.deleteFilter(filterId);
      
      if (response.status === 'success') {
        this.showFeedback('Filter removed successfully', 'success');
        await this.loadAndDisplayFilters();
      } else {
        throw new Error(response.message || 'Failed to remove filter');
      }
    } catch (error) {
      console.error('Error removing filter:', error);
      this.showFeedback('Error removing filter: ' + (error as Error).message, 'error');
    }
  }

  /**
   * Show chat message
   */
  private showChatMessage(message: string, role: 'user' | 'assistant', options: string[] = []) {
    // Add message to chat
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    messageDiv.textContent = message;
    this.chatArea.appendChild(messageDiv);
    
    // Update message count for dynamic expansion
    const messageCount = this.chatArea.querySelectorAll('.chat-message').length;
    this.chatArea.setAttribute('data-message-count', messageCount.toString());
    
    // Auto-adjust chat area height based on content
    if (this.chatArea.scrollHeight < 180) {
      this.chatArea.style.height = 'auto';
      this.chatArea.style.height = `${Math.min(this.chatArea.scrollHeight + 20, 320)}px`;
    }
    
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
    
    // Clear existing options/config UI
    this.optionsArea.innerHTML = '';
    
    // Handle different states - except for FILTER_CONFIG which is now handled by showFilterConfigUI
    if (options && options.length > 0) {
      // Show regular option buttons for other states
      options.forEach(option => {
        const button = document.createElement('button');
        button.className = 'option-button';
        button.textContent = option;
        this.optionsArea.appendChild(button);
      });
    }
    
    // Update input placeholder
    this.updateInputPlaceholder();
  }

  /**
   * Show feedback message
   */
  private showFeedback(message: string, type: 'error' | 'success') {
    const feedback = document.getElementById('feedback') || this.createFeedbackElement();
    feedback.textContent = message;
    feedback.className = `feedback ${type}`;
    
    setTimeout(() => {
      feedback.textContent = '';
      feedback.className = 'feedback';
    }, 3000);
  }

  /**
   * Create feedback element if it doesn't exist
   */
  private createFeedbackElement(): HTMLDivElement {
    const feedback = document.createElement('div');
    feedback.id = 'feedback';
    document.body.insertBefore(feedback, document.body.firstChild);
    return feedback;
  }

  /**
   * Update the placeholder text based on conversation state
   */
  private updateInputPlaceholder() {
    switch (this.currentState) {
      case FilterState.CLARIFYING:
        this.wordInput.placeholder = "Or you can specify typing here...";
        break;
      case FilterState.FILTER_CONFIG:
        this.wordInput.placeholder = "Or type here to modify your request...";
        break;
      case FilterState.CONTENT_TYPE:
      case FilterState.INTENSITY:
      case FilterState.DURATION:
        this.wordInput.placeholder = "Answering questions about your filter...";
        break;
      case FilterState.COMPLETE:
        this.wordInput.placeholder = "What else can I help with?";
        break;
      default:
        this.wordInput.placeholder = "How can DIY-MOD help you today? Write here...";
    }
  }

  /**
   * Reset the state for a new conversation
   */
  private resetState() {
    // Use Zustand store's reset method
    this.filterStore.reset();
    this.updateInputPlaceholder();
  }

  /**
   * Save current state using state manager
   */
  private saveState(): void {
    this.stateManager.debouncedSave(
      this.currentState,
      this.filterData,
      this.conversationHistory,
      this.chatArea.innerHTML
    );
  }

  /**
   * Restore saved state if it exists, with option to start new chat
   * @returns Promise<boolean> True if state was restored
   */
  private async restoreSavedState(): Promise<boolean> {
    try {
      const savedState = await this.stateManager.restoreSavedState(this.currentState);
      
      if (!savedState) {
        return false;
      }
      
      // Create a dialog asking if user wants to continue previous chat
      const continueChat = confirm("Would you like to continue your previous conversation?");
      
      // If user doesn't want to continue, clear the saved state and start fresh
      if (!continueChat) {
        await this.stateManager.clearStorageState();
        this.startNewChat();
        return false;
      }
      
      // Restore the filter store state
      this.filterStore.transitionTo(savedState.currentState);
      if (savedState.filterData) {
        this.filterStore.updateFilterData(savedState.filterData);
      }
      
      // Restore conversation history
      this.conversationHistory = savedState.conversationHistory || [];
      
      // Restore chat UI
      if (savedState.chatAreaContent) {
        this.chatArea.innerHTML = savedState.chatAreaContent;
      }
      
      // If we were in FILTER_CONFIG state, show the config UI
      if (savedState.currentState === FilterState.FILTER_CONFIG && savedState.filterData?.text) {
        setTimeout(() => {
          this.showFilterConfigUI();
        }, 200);
      }
      
      // Update UI based on restored state
      this.updateInputPlaceholder();
      
      this.showFeedback('Previous session restored', 'success');
      return true;
    } catch (error) {
      console.error('Error restoring state:', error);
      return false;
    }
  }
}

/**
 * Initialize authentication UI
 */
function initAuthentication(): void {
  const userInfoEl = document.getElementById('user-info');
  const signInPromptEl = document.getElementById('sign-in-prompt');
  const signInBtn = document.getElementById('sign-in');
  const signOutBtn = document.getElementById('sign-out');
  const userNameEl = document.getElementById('user-name');
  const userAvatarEl = document.getElementById('user-avatar') as HTMLImageElement;

  // Check current auth status
  chrome.runtime.sendMessage({ type: 'getUserInfo' }, (response) => {
    console.log('DIY-MOD: response: ', response);
    if (response.user && response.user.isGoogle) {
      // User is signed in with Google
      if (signInPromptEl) signInPromptEl.style.display = 'none';
      if (userInfoEl) userInfoEl.style.display = 'flex';
      
      // Update user info - properly access nested user object
      if (userNameEl && response.user.user && response.user.user.name) 
        userNameEl.textContent = response.user.user.name;
      if (userAvatarEl && response.user.user && response.user.user.picture) 
        userAvatarEl.src = response.user.user.picture;
    } else {
      // User is not signed in with Google
      if (signInPromptEl) signInPromptEl.style.display = 'flex';
      if (userInfoEl) userInfoEl.style.display = 'none';
    }
  });

  // Handle sign in click
  if (signInBtn) {
    signInBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'signIn' }, (response) => {
        if (response.success) {
          // Refresh the popup to show signed-in state
          window.location.reload();
        } else {
          console.error('Sign in failed:', response.error);
          alert('Failed to sign in with Google. Please try again.');
        }
      });
    });
  }

  // Handle sign out click
  if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'signOut' }, (response) => {
        if (response.success) {
          // Refresh the popup to show signed-out state
          window.location.reload();
        } else {
          console.error('Sign out failed:', response.error);
          alert('Failed to sign out. Please try again.');
        }
      });
    });
  }
}

// Initialize the popup controller when the document is loaded
document.addEventListener('DOMContentLoaded', () => {
  // Initialize controller
  new PopupController();
  
  // Initialize authentication
  initAuthentication();
});