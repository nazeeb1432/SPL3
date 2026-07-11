"""Handles chat-based filter creation and management"""
from openai import OpenAI
from typing import Dict, List, Optional, Tuple
import json
import os
import logging
import re
from difflib import SequenceMatcher
from dotenv import load_dotenv
from .processor import ContentFilter
from .chat_system_prompt import CHAT_SYSTEM_PROMPT
from utils.config import ConfigManager
from database.operations import get_user_filters

logger = logging.getLogger(__name__)

class FilterCreationChat:
    """Manages chat-based filter creation workflow"""
    
    def __init__(self):
        # Initialize config first
        config = ConfigManager()
        llm_config = config.get_llm_config()
        
        # Validate API key
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise EnvironmentError("OPENAI_API_KEY not found in environment")
            
        self.client = OpenAI(api_key=api_key)
        self.chat_model = llm_config.chat_model  # Get model from config
        logger.info(f"Initialized FilterCreationChat with model {self.chat_model}")
        
        # Common vague/generic terms that need clarification
        self.vague_terms = {
            'things', 'stuff', 'it', 'them', 'that', 'this', 'something',
            'everything', 'anything', 'whatever', 'content', 'posts', 'media'
        }
        
        # Common ambiguous names that could refer to multiple entities
        self.ambiguous_patterns = {
            'jordan': ['Michael Jordan (basketball)', 'Jordan Peterson', 'Country of Jordan'],
            'paris': ['Paris, France', 'Paris Hilton', 'Paris (mythology)'],
            'mercury': ['Planet Mercury', 'Mercury (element)', 'Freddie Mercury'],
            'apple': ['Apple Inc. (technology)', 'Apple (fruit)', 'Apple products'],
            'amazon': ['Amazon (company)', 'Amazon rainforest', 'Amazon Prime'],
            'corona': ['Coronavirus/COVID-19', 'Corona beer', 'Solar corona'],
        }
        
    def _is_gibberish(self, text: str) -> bool:
        """Detect if input appears to be gibberish or random characters"""
        # Remove spaces for analysis
        text_no_spaces = text.replace(' ', '').lower()
        
        # Check for too many consonants in a row (more than 4)
        if re.search(r'[bcdfghjklmnpqrstvwxyz]{5,}', text_no_spaces):
            return True
            
        # Check for unusual character patterns
        # Real words rarely have 3+ identical characters in a row
        if re.search(r'(.)\1{2,}', text_no_spaces):
            return True
            
        # Check vowel to consonant ratio (should be roughly 1:2 to 1:3 in English)
        vowels = sum(1 for c in text_no_spaces if c in 'aeiou')
        consonants = sum(1 for c in text_no_spaces if c.isalpha() and c not in 'aeiou')
        
        if consonants > 0:
            ratio = vowels / consonants
            if ratio < 0.1 or ratio > 2.0:  # Too few or too many vowels
                return True
                
        # Check for random alphanumeric patterns
        if re.search(r'[a-z]+\d+[a-z]+\d+', text_no_spaces) or re.search(r'\d+[a-z]+\d+[a-z]+', text_no_spaces):
            return True
            
        return False
    
    def _analyze_input_clarity(self, message: str, user_filters: List[Dict]) -> Tuple[bool, Optional[Dict]]:
        """
        Analyze if the input is too vague or ambiguous
        Returns: (is_vague, disambiguation_suggestions)
        """
        message_lower = message.lower().strip()
        
        # Check for gibberish
        if self._is_gibberish(message):
            return True, {
                "reason": "gibberish",
                "suggestions": [
                    "Please describe what content you'd like to filter",
                    "Tell me about specific topics that bother you",
                    "What kind of posts do you want to avoid?"
                ]
            }
        
        # Check for single word inputs (except clear entities)
        words = message.split()
        if len(words) == 1:
            word = words[0].lower()
            
            # Check if it's a known ambiguous term
            if word in self.ambiguous_patterns:
                return True, {
                    "reason": "ambiguous",
                    "original": word,
                    "suggestions": self.ambiguous_patterns[word]
                }
            
            # Check if it's too generic
            if word in self.vague_terms:
                return True, {
                    "reason": "too_generic",
                    "suggestions": [
                        f"What specific kind of {word} bothers you?",
                        f"Can you describe the {word} you want to filter?",
                        f"What aspect of {word} do you want to avoid?"
                    ]
                }
            
            # For other single words, suggest more context
            if len(word) < 4 or word.isdigit():
                return True, {
                    "reason": "too_short",
                    "suggestions": self._generate_contextual_suggestions(word, user_filters)
                }
        
        # Check for very short phrases (2-3 characters)
        if len(message) <= 3 and not any(char.isdigit() for char in message):
            return True, {
                "reason": "too_short",
                "suggestions": [
                    "Could you provide more details?",
                    "What specifically about this bothers you?",
                    "Can you describe this in more detail?"
                ]
            }
            
        # Check for purely generic phrases
        if all(word in self.vague_terms for word in words):
            return True, {
                "reason": "all_generic",
                "suggestions": [
                    "Please be more specific about what you want to filter",
                    "What particular content are you trying to avoid?",
                    "Can you give an example of what bothers you?"
                ]
            }
            
        return False, None
    
    def _generate_contextual_suggestions(self, term: str, user_filters: List[Dict]) -> List[str]:
        """Generate context-aware suggestions based on the term and existing filters"""
        suggestions = []
        
        # Common expansions for single terms
        term_lower = term.lower()
        
        # Animal-related
        if term_lower in ['dog', 'dogs', 'cat', 'cats', 'bird', 'birds', 'animal', 'animals']:
            suggestions.extend([
                f"{term} videos and images",
                f"{term} attack or bite incidents",
                f"Dead or injured {term}",
                f"Cute {term} content"
            ])
        
        # People/names
        elif term_lower[0].isupper() or term_lower in ['trump', 'biden', 'musk', 'swift']:
            suggestions.extend([
                f"{term} political content",
                f"{term} news and updates",
                f"{term} social media posts",
                f"Discussions about {term}"
            ])
        
        # Generic single word
        else:
            suggestions.extend([
                f"{term} related news",
                f"Images of {term}",
                f"Discussions about {term}",
                f"Content featuring {term}"
            ])
            
        # Add suggestions based on existing filters
        if user_filters:
            # Find filters with similar themes
            for filter_obj in user_filters[:3]:  # Check recent filters
                filter_text = filter_obj.get('filter_text', '').lower()
                if 'political' in filter_text and term_lower not in filter_text:
                    suggestions.append(f"{term} political discussions")
                    break
                elif 'news' in filter_text and term_lower not in filter_text:
                    suggestions.append(f"{term} news stories")
                    break
                    
        return suggestions[:4]  # Return max 4 suggestions
    
    def _find_similar_filters(self, new_filter: str, existing_filters: List[Dict]) -> List[Dict]:
        """Find existing filters that are semantically similar to the proposed filter"""
        similar = []
        new_filter_lower = new_filter.lower()
        
        for filter_obj in existing_filters:
            existing_text = filter_obj.get('filter_text', '').lower()
            
            # Calculate similarity score
            similarity = SequenceMatcher(None, new_filter_lower, existing_text).ratio()
            
            # Check for substring matches
            if new_filter_lower in existing_text or existing_text in new_filter_lower:
                similarity = max(similarity, 0.8)
            
            # Check for word overlap
            new_words = set(new_filter_lower.split())
            existing_words = set(existing_text.split())
            word_overlap = len(new_words & existing_words) / max(len(new_words), len(existing_words))
            
            if word_overlap > 0.5:
                similarity = max(similarity, word_overlap)
                
            if similarity > 0.6:  # Threshold for similarity
                similar.append({
                    'filter': filter_obj,
                    'similarity': similarity
                })
                
        # Sort by similarity and return top 3
        similar.sort(key=lambda x: x['similarity'], reverse=True)
        return [item['filter'] for item in similar[:3]]
        
    def process_chat(self, message: str, history: List[Dict], user_id: str = None) -> Dict:
        """Process chat messages and return structured response"""
        logger.debug(f"Processing message: {message}")
        logger.debug(f"History: {history}")
        
        # Get user's filter history if user_id is provided
        user_filters = []
        if user_id:
            try:
                user_filters = get_user_filters(user_id)
                logger.debug(f"Retrieved {len(user_filters)} existing filters for user {user_id}")
            except Exception as e:
                logger.error(f"Failed to retrieve user filters: {e}")
        
        # Check if this is an initial filter request (not a follow-up in conversation)
        is_initial_request = True
        for msg in history:
            if msg.get('role') == 'assistant':
                content = msg.get('content', {})
                if isinstance(content, dict) and content.get('type') in ['clarify', 'ready_for_config']:
                    is_initial_request = False
                    break
        
        # Only apply disambiguation logic to initial filter requests
        if is_initial_request and message.lower() not in ['try again', 'start over']:
            # Analyze input clarity
            is_vague, disambiguation_info = self._analyze_input_clarity(message, user_filters)
            
            if is_vague:
                logger.info(f"Detected vague input: {message}, reason: {disambiguation_info.get('reason')}")
                
                # Format appropriate response based on the type of vagueness
                if disambiguation_info['reason'] == 'gibberish':
                    return {
                        "text": "I couldn't understand that input. Could you please describe what content you'd like to filter?",
                        "type": "clarify",
                        "options": disambiguation_info['suggestions']
                    }
                elif disambiguation_info['reason'] == 'ambiguous':
                    original = disambiguation_info.get('original', message)
                    return {
                        "text": f"'{original.title()}' could refer to different things. Which one would you like to filter?",
                        "type": "clarify",
                        "options": disambiguation_info['suggestions'],
                        "filter_data": {
                            "filter_text": message,
                            "initial_type": "ambiguous"
                        }
                    }
                elif disambiguation_info['reason'] in ['too_short', 'too_generic']:
                    return {
                        "text": f"I need more context about '{message}'. What specifically would you like to filter?",
                        "type": "clarify",
                        "options": disambiguation_info['suggestions'],
                        "filter_data": {
                            "filter_text": message,
                            "initial_type": "unclear"
                        }
                    }
                else:
                    return {
                        "text": "Your input seems too vague. Could you be more specific about what you want to filter?",
                        "type": "clarify",
                        "options": disambiguation_info['suggestions']
                    }
        
        # Check for similar existing filters if we have a clear filter text
        if is_initial_request and user_filters and len(message.split()) > 1:
            similar_filters = self._find_similar_filters(message, user_filters)
            if similar_filters:
                filter_names = [f['filter_text'] for f in similar_filters]
                logger.info(f"Found similar existing filters: {filter_names}")
                
                # Add this information to the message context for the LLM
                message = f"{message}\n[Note: User has similar existing filters: {', '.join(filter_names[:2])}]"
        
        # Check if this is a retry after an error
        if message.lower() in ['try again', 'start over']:
            if message.lower() == 'start over':
                history = []
                logger.info("Starting new conversation")
            else:
                history = [msg for msg in history if not (
                    isinstance(msg.get('content'), dict) and 
                    msg.get('content', {}).get('type') == 'error'
                )]
                logger.info("Retrying after removing error messages")
        
        # Clean history
        cleaned_history = []
        for msg in history:
            content = msg['content']
            if isinstance(content, dict):
                if content.get('type') == 'error':
                    continue
                # Convert dict content to string representation
                if 'text' in content:
                    cleaned_content = content['text']
                else:
                    # Remove technical fields from JSON string
                    filtered_content = {k: v for k, v in content.items() 
                                    if k in ['text', 'filter_data']}
                    cleaned_content = json.dumps(filtered_content)
            else:
                cleaned_content = str(content)
                
            cleaned_history.append({
                "role": msg['role'],
                "content": cleaned_content
            })
        
        # Prepare filter context if user has existing filters
        filter_context = ""
        if user_filters:
            filter_names = [f["filter_text"] for f in user_filters[:5]]  # Limit to 5 most recent
            filter_context = f"User has existing filters for: {', '.join(filter_names)}. "
            filter_context += "Consider these when suggesting new filters."
            logger.debug(f"Adding filter context to messages: {filter_context}")
        
        messages = [
            {"role": "system", "content": CHAT_SYSTEM_PROMPT},
            # Add filter context as a system message if available
            *([] if not filter_context else [{"role": "system", "content": filter_context}]),
            *cleaned_history,
            {"role": "user", "content": message}
        ]

        try:
            completion = self.client.chat.completions.create(
                model=self.chat_model,
                messages=messages,
                response_format={"type": "json_object"},
            )
            
            raw_response = completion.choices[0].message.content
            logger.debug(f"Raw Chat LLM response: {raw_response}")
            
            try:
                response_data = json.loads(raw_response)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse LLM response as JSON: {e}")
                raise ValueError(f"Invalid JSON response from LLM: {raw_response[:100]}...")
                
            # Ensure required fields exist
            if not all(k in response_data for k in ['text', 'type']):
                raise ValueError("Missing required fields in response")
                
            if 'options' not in response_data:
                response_data['options'] = []
                
            return response_data
                
        except Exception as e:
            logger.error(f"Error in chat process: {e}", exc_info=True)
            
            # Get most recent valid filter data and conversation state
            prev_filter_data = None
            conversation_state = "initial"
            
            for msg in reversed(history):
                if isinstance(msg.get('content'), dict):
                    content = msg.get('content', {})
                    if 'filter_data' in content:
                        prev_filter_data = content['filter_data']
                        # Try to determine the conversation state
                        if content.get('type') == 'ready_for_config':
                            conversation_state = "filter_config"
                        break
            
            # Return error with preserved context
            return {
                "text": "Something went wrong. Would you like to try again?",
                "options": ["Try again", "Start over"],
                "type": "error",
                "conversation_state": conversation_state,
                **({"filter_data": prev_filter_data} if prev_filter_data else {})
            }

    def _determine_conversation_state(self, history: List[Dict]) -> str:
        """Determine the current state of conversation based on history"""
        if not history:
            return "initial"
            
        last_assistant_msg = next((msg for msg in reversed(history) 
                                if msg.get('role') == 'assistant'), None)
        if not last_assistant_msg:
            return "initial"
            
        content = last_assistant_msg.get('content', '').lower()
        
        if "should this apply to just images" in content:
            return "content_type"
        elif "how strict" in content:
            return "intensity"
        elif "how long" in content or "duration" in content:
            return "duration"
        
        return "initial"

    def _format_plain_text_response(self, text: str, state: str, history: List[Dict]) -> Dict:
        """Convert plain text response to proper JSON format based on conversation state"""

    # Get previous filter data if available
        prev_filter_data = {}
        for msg in reversed(history):
            if msg.get('role') == 'assistant' and isinstance(msg.get('content'), dict):
                filter_data = msg.get('content').get('filter_data', {})
                if filter_data:
                    prev_filter_data = filter_data
                    break
        
        if state == "intensity":
            return {
                "text": text,
                "type": "intensity",
                "options": ["Very strict", "Moderate", "Mild"],
                "filter_data": {
                    **prev_filter_data,
                    "content_type": "both" if "both" in history[-1].get('content', '').lower() else "image"
                }
            }
        elif state == "duration":
            return {
                "text": "How long would you like this filter to be active?",
                "type": "duration",
                "options": ["Permanent", "24 hours", "1 week"],
                "filter_data": prev_filter_data
            }
        
# Default response for other states
        return {
            "text": text,
            "type": "clarify",
            "options": []
        }