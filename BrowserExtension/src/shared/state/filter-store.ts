import { create } from 'zustand';
import { FilterState, FilterData, LLMResponse } from '../types';

interface FilterStore {
  // State
  currentState: FilterState;
  filterData: FilterData;
  
  // Actions
  handleResponse: (data: LLMResponse) => void;
  updateFilterData: (data: Partial<FilterData>) => void;
  transitionTo: (newState: FilterState) => void;
  reset: () => void;
  
  // Helper methods
  isConfiguring: () => boolean;
  isComplete: () => boolean;
}

const DEFAULT_FILTER_DATA: FilterData = {
  text: '',
  contentType: 'all',
  intensity: 3,
  duration: 'permanent'
};

// Create store with Zustand
export const useFilterStore = create<FilterStore>((set, get) => ({
  // Initial state
  currentState: FilterState.INITIAL,
  filterData: { ...DEFAULT_FILTER_DATA },
  
  // Handle LLM API response
  handleResponse: (data: LLMResponse) => {
    console.log('FilterStore handling response:', data);
    
    // Update filter data if present
    if (data.filter_data) {
      const filterText = data.filter_data.filter_text;
      
      if (filterText) {
        get().updateFilterData({
          text: filterText,
          contentType: data.filter_data.content_type as any || 'all',
          intensity: data.filter_data.intensity || 3,
          duration: data.filter_data.duration || 'permanent',
          type: data.filter_data.initial_type,
          context: data.filter_data.context
        });
      }
    }
    
    // Handle state transition based on response type
    switch (data.type) {
      case 'ready_for_config':
        // Always transition to FILTER_CONFIG when ready
        get().transitionTo(FilterState.FILTER_CONFIG);
        break;
        
      case 'clarify':
        get().transitionTo(FilterState.CLARIFYING);
        break;
        
      case 'complete':
        get().transitionTo(FilterState.COMPLETE);
        break;

      case 'initial':
        get().transitionTo(FilterState.INITIAL);
        break; 
         
      default:
        console.warn('Unknown response type:', data.type);
    }
  },
  
  // Update filter data
  updateFilterData: (data: Partial<FilterData>) => {
    set(state => ({
      filterData: {
        ...state.filterData,
        ...data
      }
    }));
  },
  
  // State transition
  transitionTo: (newState: FilterState) => {
    console.log(`State transition: ${get().currentState} -> ${newState}`);
    set({ currentState: newState });
  },
  
  // Reset to initial state
  reset: () => {
    set({
      currentState: FilterState.INITIAL,
      filterData: { ...DEFAULT_FILTER_DATA }
    });
  },
  
  // Helper methods
  isConfiguring: () => get().currentState === FilterState.FILTER_CONFIG,
  isComplete: () => get().currentState === FilterState.COMPLETE
}));