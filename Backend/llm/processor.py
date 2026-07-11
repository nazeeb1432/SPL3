from . import prompts
import os
import json
import logging
import re
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from google import genai
from pydantic import BaseModel
from utils.config import ConfigManager
from utils.errors import LLMError, handle_processing_errors
from utils import safe_json_loads, validate_llm_response
from datetime import datetime
logger = logging.getLogger(__name__)
from .response_models import TextInterventionEvaluation


class ContentFilter(BaseModel):
    filter_text: str
    intensity: int
    content_type: str = 'all'
    is_temporary: bool = False
    expires_at: Optional[datetime] = None
    filter_metadata: Dict[str, Any] = {}

    def to_llm_format(self) -> Dict[str, Any]:
        """Convert filter to LLM-friendly format with only relevant fields"""
        return {
            "filter_text": self.filter_text,
            "intensity": self.intensity,
            "content_type": self.content_type,
            "filter_metadata": self.filter_metadata
        }

class FilterMatch(BaseModel):
    matched_filter_ids: List[int]
    confidence_scores: Dict[str, float]

class LLMProcessor:
    def __init__(self):
        config = ConfigManager()
        llm_config = config.get_llm_config()
        
        # Validate API key
        api_key = os.getenv('OPENAI_API_KEY')
        if not api_key:
            raise LLMError("OPENAI_API_KEY not found in environment")
        google_api_key = os.getenv('GOOGLE_API_KEY')
        if not google_api_key:
            raise LLMError("GOOGLE_API_KEY not found in environment")
        self.llm_client = AsyncOpenAI(api_key=api_key)
        self.gemini_client = genai.Client(api_key=google_api_key)
        self.llm_model = llm_config.content_model
        self.temperature = llm_config.temperature
        self.max_tokens = llm_config.max_tokens
        
        # Get processing configuration
        proc_config = config.get_processing_config()
        self.mode = proc_config.default_mode
        
        # Define markers for content modification
        self.MARKERS = {
            'blur': ("__BLUR_START__", "__BLUR_END__"),
            'overlay': ("__OVERLAY_START__", "__OVERLAY_END__"),
            'rewrite': ("__REWRITE_START__", "__REWRITE_END__")
        }
        
        # Confidence thresholds - adjust based on mode
        self.CONFIDENCE_THRESHOLDS = {
            'balanced': {
                1: 0.8,  # High threshold for low intensity
                2: 0.8,
                3: 0.7,
                4: 0.7,
                5: 0.7   # Low threshold for high intensity
            },
            'aggressive': {
                1: 0.7,  # Lower thresholds for aggressive mode
                2: 0.6,
                3: 0.5,
                4: 0.4,
                5: 0.3
            }
        }[self.mode]
        
        logger.info(f"Initialized LLMProcessor in {self.mode} mode using {self.llm_model}")
        
    @handle_processing_errors
    async def evaluate_content(self, text: str, filters: List[ContentFilter]) -> List[ContentFilter]:
        """Evaluate if content matches any filters"""
        try:
            if not text.strip() or not filters:
                logger.debug("Empty content or no filters to evaluate")
                return []
                
            logger.debug(f"Evaluating content in {self.mode} mode against {len(filters)} filters")
            logger.debug(f"Content sample: {text[:100]}...")
            
            # In aggressive mode, we combine similar filters
            if self.mode == 'aggressive':
                filters = self._combine_similar_filters(filters)
                
            completion = await self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=[{
                    "role": "system",
                    "content": prompts.FILTER_EVALUATION_PROMPT
                }, {
                    "role": "user",
                    "content": json.dumps({
                        "text": text,
                        "filters": [f.to_llm_format() for f in filters]  # Use simplified format
                    })
                }],
                response_format={"type": "json_object"},
                max_tokens=self.max_tokens,
                temperature=self.temperature
            )
            logger.debug(f"LLM response for Filter Evaluation: Text {text[:100]} \nOuput: {completion.choices[0].message.content}")
            response_data = validate_llm_response(
                completion.choices[0].message.content,
                ['matched_filter_ids', 'confidence_scores']
            )
            if not response_data:
                raise LLMError("Invalid response format from LLM", {
                    "response": completion.choices[0].message.content[:200]
                })
            
            try:
                matches = FilterMatch(**response_data)
            except ValueError as e:
                raise LLMError(f"Invalid match data: {e}", {
                    "response_data": response_data
                })
                
            # Apply confidence thresholds with detailed logging
            validated_matches = []
            for idx in matches.matched_filter_ids:
                if idx >= len(filters):
                    logger.warning(f"LLM returned invalid filter index: {idx}")
                    continue
                    
                filter_data = filters[idx]
                confidence = matches.confidence_scores.get(str(idx), 0.0)
                threshold = self.CONFIDENCE_THRESHOLDS.get(filter_data.intensity, 0.7)
                
                if confidence >= threshold:
                    validated_matches.append(filter_data)
                    logger.debug(f"Filter '{filter_data.filter_text}' matched with {confidence:.2f} confidence (threshold: {threshold})")
                else:
                    logger.debug(f"Filter '{filter_data.filter_text}' below threshold: {confidence:.2f} < {threshold}")
            
            if validated_matches:
                logger.debug(f"Found {len(validated_matches)} valid matches out of {len(matches.matched_filter_ids)} total matches")
                    
            return validated_matches
                
        except Exception as e:
            raise LLMError(f"Error in content evaluation: {e}", {
                "text_sample": text[:100],
                "filter_count": len(filters),
                "mode": self.mode
            })

    def _validate_markers(self, text: str) -> str:
        """Validate marker structure and fix any issues"""
        try:
            # Check for nested markers of same type
            for marker_type in self.MARKERS.values():
                start, end = marker_type
                # Find all start and end positions
                starts = [m.start() for m in re.finditer(re.escape(start), text)]
                ends = [m.start() for m in re.finditer(re.escape(end), text)]
                
                if len(starts) != len(ends):
                    logger.warning(f"Mismatched markers found: {len(starts)} starts and {len(ends)} ends")
                    # Remove all markers of this type and re-add outermost
                    text = text.replace(start, "").replace(end, "")
                    text = f"{start}{text}{end}"
                    
                # Check for correct nesting
                for s, e in zip(starts, ends):
                    inner_starts = [i for i in starts if s < i < e]
                    if inner_starts:
                        logger.warning(f"Nested markers found, fixing...")
                        # Keep only outermost markers
                        text = text.replace(start, "", len(inner_starts))
                        text = text.replace(end, "", len(inner_starts))
            
            # Ensure TITLE/BODY tags are preserved
            for tag in ['TITLE', 'BODY']:
                tag_pattern = f'\\[{tag}\\](.*?)\\[/{tag}\\]'
                matches = list(re.finditer(tag_pattern, text))
                for match in matches:
                    # Extract content with potential markers
                    full_match = match.group(0)
                    content = match.group(1)
                    # Preserve markers inside section but ensure they don't wrap the tags
                    text = text.replace(full_match, f'[{tag}]{content}[/{tag}]')
            
            return text
            
        except Exception as e:
            logger.error(f"Error validating markers: {e}")
            return text

    @handle_processing_errors
    async def process_content(self, text: str, intensity: int, matched_filters: List[ContentFilter], post_metadata: Dict[str, Any]) -> str:
        """Process content based on intensity level and mode"""
        try:
            if not text.strip() or not matched_filters:
                return text
                
            # Try LLM processing with fallback options
            try:
                result = ""
                if self.mode == 'aggressive':
                    result = await self._process_aggressive(text, intensity, matched_filters)
                else:

                    intervention_defined = post_metadata.get('text_intervention', False)
                    logger.debug(f"Intervention defined: {intervention_defined}")
                    if intervention_defined:
                        if intervention_defined == "blur":
                            result = await self._process_low_intensity(text, matched_filters)
                        elif intervention_defined == "overlay":
                            result = await self._process_medium_intensity(text, matched_filters)
                        elif intervention_defined == "rewrite":
                            result = await self._process_high_intensity(text, matched_filters)
                        else:
                            result = await self._process_high_intensity(text, matched_filters)
                    else:
                        int_n = await self.select_text_intervention(text, matched_filters)
                        # In balanced mode, process each part separately
                        if int_n == 1:
                            result = await self._process_low_intensity(text, matched_filters)
                        elif int_n == 2:
                            result = await self._process_medium_intensity(text, matched_filters)
                        else:
                            result = await self._process_high_intensity(text, matched_filters)
                        
                # Validate marker structure before returning
                return self._validate_markers(result)
                    
            except Exception as processing_error:
                logger.error(f"LLM processing failed, falling back to basic processing: {processing_error}")
                # Fallback to basic processing
                result = self._basic_content_processing(text, intensity, matched_filters)
                # Validate markers even for basic processing
                return self._validate_markers(result)
                
        except Exception as e:
            logger.error(f"Error in content processing: {e}", exc_info=True)
            return text
            
    def _basic_content_processing(self, text: str, intensity: int, filters: List[ContentFilter]) -> str:
        """Basic content processing without LLM when more sophisticated processing fails"""
        try:
            title_match = re.search(r'\[TITLE\](.*?)\[/TITLE\]', text, re.DOTALL)
            body_match = re.search(r'\[BODY\](.*?)\[/BODY\]', text, re.DOTALL)
            
            result = text
            if intensity < 3:
                # For low intensity, blur exact filter text matches
                if title_match:
                    title_content = title_match.group(1)
                    processed_title = self._apply_basic_blur(title_content, filters)
                    result = result.replace(title_match.group(0), f'[TITLE]{processed_title}[/TITLE]')
                    
                if body_match:
                    body_content = body_match.group(1)
                    processed_body = self._apply_basic_blur(body_content, filters)
                    result = result.replace(body_match.group(0), f'[BODY]{processed_body}[/BODY]')
                    
                if not (title_match or body_match):
                    result = self._apply_basic_blur(text, filters)
                    
            elif intensity == 3:
                # For medium intensity, add overlay
                warning = f"Warning: This content may contain sensitive topics"
                
                if title_match:
                    result = result.replace(
                        title_match.group(0),
                        f'[TITLE]{self.MARKERS["overlay"][0]}{warning}|{title_match.group(1)}{self.MARKERS["overlay"][1]}[/TITLE]'
                    )
                    
                if body_match:
                    result = result.replace(
                        body_match.group(0),
                        f'[BODY]{self.MARKERS["overlay"][0]}{warning}|{body_match.group(1)}{self.MARKERS["overlay"][1]}[/BODY]'
                    )
                    
                if not (title_match or body_match):
                    result = f'{self.MARKERS["overlay"][0]}{warning}|{text}{self.MARKERS["overlay"][1]}'
                    
            else:
                # For high intensity, mark sections for rewrite
                if title_match:
                    result = result.replace(
                        title_match.group(0),
                        f'[TITLE]{self.MARKERS["rewrite"][0]}Content filtered{self.MARKERS["rewrite"][1]}[/TITLE]'
                    )
                    
                if body_match:
                    result = result.replace(
                        body_match.group(0),
                        f'[BODY]{self.MARKERS["rewrite"][0]}Content filtered due to sensitive topics{self.MARKERS["rewrite"][1]}[/BODY]'
                    )
                    
                if not (title_match or body_match):
                    result = f'{self.MARKERS["rewrite"][0]}Content filtered due to sensitive topics{self.MARKERS["rewrite"][1]}'
            
            return result
            
        except Exception as e:
            logger.error(f"Error in basic content processing: {e}")
            return text
            
    def _apply_basic_blur(self, text: str, filters: List[ContentFilter]) -> str:
        """Apply blur markers to exact filter text matches"""
        result = text
        for f in filters:
            if f.filter_text in result:
                result = result.replace(
                    f.filter_text,
                    f"{self.MARKERS['blur'][0]}{f.filter_text}{self.MARKERS['blur'][1]}"
                )
        return result

    def _clean_llm_markers(self, text: str) -> str:
        """Remove any markers that might have been added by LLM"""
        for marker_type in self.MARKERS.values():
            start, end = marker_type
            # Remove any existing markers
            text = text.replace(start, "").replace(end, "")
        return text

    def _process_section_content(self, text: str, section_match: re.Match, marker_type: str, warning: str = None) -> str:
        """Process a section (TITLE or BODY) with proper marker handling"""
        content = section_match.group(1)
        # Clean any existing markers first
        content = self._clean_llm_markers(content)
        
        if marker_type == 'blur':
            return content  # Will be processed by _apply_blur_markers
        elif marker_type == 'overlay':
            overlay_warning = warning or "Warning: Filtered Content"
            return f'{self.MARKERS["overlay"][0]}{overlay_warning}|{content}{self.MARKERS["overlay"][1]}'
        elif marker_type == 'rewrite':
            return f'{self.MARKERS["rewrite"][0]}{content}{self.MARKERS["rewrite"][1]}'
        return content

    @handle_processing_errors
    async def _process_low_intensity(self, text: str, filters: List[ContentFilter]) -> str:
        """Process text for low intensity - blur specific words"""
        try:
            completion = await self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=[{
                    "role": "system",
                    "content": prompts.LOW_INTENSITY_PROMPT
                }, {
                    "role": "user",
                    "content": json.dumps({
                        "text": text,
                        "filters": [f.to_llm_format() for f in filters]
                    })
                }],
                response_format={"type": "text"}
            )
            
            # Get list of words/phrases to blur and clean any markers
            words_to_blur = [
                self._clean_llm_markers(word.strip())
                for word in completion.choices[0].message.content.strip().split('\n')
                if word.strip()
            ]
            
            # Process by preserving [TITLE] and [BODY] sections
            title_match = re.search(r'\[TITLE\](.*?)\[/TITLE\]', text, re.DOTALL)
            body_match = re.search(r'\[BODY\](.*?)\[/BODY\]', text, re.DOTALL)
            
            result = text
            if title_match:
                title_content = self._process_section_content(text, title_match, 'blur')
                processed_title = self._apply_blur_markers(title_content, words_to_blur)
                result = result.replace(title_match.group(0), f'[TITLE]{processed_title}[/TITLE]')
                
            if body_match:
                body_content = self._process_section_content(text, body_match, 'blur')
                processed_body = self._apply_blur_markers(body_content, words_to_blur)
                result = result.replace(body_match.group(0), f'[BODY]{processed_body}[/BODY]')
                
            if not (title_match or body_match):
                result = self._apply_blur_markers(self._clean_llm_markers(text), words_to_blur)
            
            logger.debug(f"_low_intensity_processed: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Error in low intensity processing: {e}")
            return text

    def _apply_blur_markers(self, text: str, segments_to_blur: List[str]) -> str:
        """Apply blur markers to specific text segments"""
        result = text
        for segment in segments_to_blur:
            segment = segment.strip()
            if segment and segment in result:
                result = result.replace(
                    segment,
                    f"{self.MARKERS['blur'][0]}{segment}{self.MARKERS['blur'][1]}"
                )
        return result

    @handle_processing_errors
    async def _process_medium_intensity(self, text: str, filters: List[ContentFilter]) -> str:
        """Process text for medium intensity - add content warning overlay"""
        try:
            completion = await self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=[{
                    "role": "system",
                    "content": prompts.MEDIUM_INTENSITY_PROMPT
                }, {
                    "role": "user",
                    "content": json.dumps({
                        "text": text,
                        "filters": [f.to_llm_format() for f in filters]
                    })
                }],
                response_format={"type": "text"}
            )
            
            # Get warning message and clean any markers
            warning = self._clean_llm_markers(completion.choices[0].message.content.strip())
            
            # Process by preserving [TITLE] and [BODY] sections
            title_match = re.search(r'\[TITLE\](.*?)\[/TITLE\]', text, re.DOTALL)
            body_match = re.search(r'\[BODY\](.*?)\[/BODY\]', text, re.DOTALL)
            
            result = text
            if title_match:
                title_content = self._process_section_content(text, title_match, 'overlay', warning)
                result = result.replace(title_match.group(0), f'[TITLE]{title_content}[/TITLE]')
                
            if body_match:
                body_content = self._process_section_content(text, body_match, 'overlay', warning)
                result = result.replace(body_match.group(0), f'[BODY]{body_content}[/BODY]')
                
            if not (title_match or body_match):
                clean_text = self._clean_llm_markers(text)
                result = f'{self.MARKERS["overlay"][0]}{warning}|{clean_text}{self.MARKERS["overlay"][1]}'
            
            logger.debug(f"_medium_intensity_processed: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Error in medium intensity processing: {e}")
            return text

    @handle_processing_errors
    async def _process_high_intensity(self, text: str, filters: List[ContentFilter]) -> str:
        """Process text for high intensity - rewrite content"""
        try:
            completion = await self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=[{
                    "role": "system",
                    "content": prompts.HIGH_INTENSITY_PROMPT
                }, {
                    "role": "user",
                    "content": json.dumps({
                        "text": text,
                        "filters": [f.to_llm_format() for f in filters]
                    })
                }],
                response_format={"type": "text"}
            )
            logger.debug(f"LLM response for High Intensity: Text {text[:100]} \nOuput: {completion.choices[0].message.content.strip()}")
            # Get rewritten content and clean any markers
            rewritten = self._clean_llm_markers(completion.choices[0].message.content.strip())
            
            # Process by preserving [TITLE] and [BODY] sections
            title_match = re.search(r'\[TITLE\](.*?)\[/TITLE\]', rewritten, re.DOTALL)
            body_match = re.search(r'\[BODY\](.*?)\[/BODY\]', rewritten, re.DOTALL)
            
            result = rewritten
            if title_match:
                title_content = self._process_section_content(rewritten, title_match, 'rewrite')
                result = result.replace(title_match.group(0), f'[TITLE]{title_content}[/TITLE]')
                
            if body_match:
                body_content = self._process_section_content(rewritten, body_match, 'rewrite')
                result = result.replace(body_match.group(0), f'[BODY]{body_content}[/BODY]')
                
            if not (title_match or body_match):
                clean_text = self._clean_llm_markers(rewritten)
                result = f'{self.MARKERS["rewrite"][0]}{clean_text}{self.MARKERS["rewrite"][1]}'
            
            logger.debug(f"_high_intensity_processed: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Error in high intensity processing: {e}")
            return text

    @handle_processing_errors
    async def _process_aggressive(self, text: str, intensity: int, filters: List[ContentFilter]) -> str:
        """Aggressively process content while preserving section boundaries"""
        try:
            completion = await self.llm_client.chat.completions.create(
                model=self.llm_model,
                messages=[{
                    "role": "system",
                    "content": prompts.AGGRESSIVE_MODE_PROMPT
                }, {
                    "role": "user",
                    "content": json.dumps({
                        "text": text,
                        "intensity": intensity,
                        "filters": [f.to_llm_format() for f in filters]
                    })
                }],
                response_format={"type": "text"}
            )
            
            # Get rewritten content and clean any markers
            rewritten = self._clean_llm_markers(completion.choices[0].message.content.strip())
            
            # Extract and process sections separately
            title_match = re.search(r'\[TITLE\](.*?)\[/TITLE\]', rewritten, re.DOTALL)
            body_match = re.search(r'\[BODY\](.*?)\[/BODY\]', rewritten, re.DOTALL)
            
            result = text
            if title_match:
                title_content = self._process_section_content(rewritten, title_match, 'rewrite')
                # For aggressive mode, add both overlay and rewrite
                processed_title = (
                    f'{self.MARKERS["overlay"][0]}Warning: Filtered Content|'
                    f'{title_content}'
                    f'{self.MARKERS["overlay"][1]}'
                )
                result = result.replace(title_match.group(0), f'[TITLE]{processed_title}[/TITLE]')
                
            if body_match:
                body_content = self._process_section_content(rewritten, body_match, 'rewrite')
                # For aggressive mode, add both overlay and rewrite
                processed_body = (
                    f'{self.MARKERS["overlay"][0]}Warning: Filtered Content|'
                    f'{body_content}'
                    f'{self.MARKERS["overlay"][1]}'
                )
                result = result.replace(body_match.group(0), f'[BODY]{processed_body}[/BODY]')
                
            if not (title_match or body_match):
                clean_text = self._clean_llm_markers(rewritten)
                result = (
                    f'{self.MARKERS["overlay"][0]}Warning: Filtered Content|'
                    f'{self.MARKERS["rewrite"][0]}{clean_text}{self.MARKERS["rewrite"][1]}'
                    f'{self.MARKERS["overlay"][1]}'
                )
            
            logger.debug(f"_aggressive_processed: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Error in aggressive processing: {e}")
            return text
            
    def _combine_similar_filters(self, filters: List[ContentFilter]) -> List[ContentFilter]:
        if not filters:
            return []
            
        # Group filters by intensity
        intensity_groups = {}
        for f in filters:
            if f.intensity not in intensity_groups:
                intensity_groups[f.intensity] = []
            intensity_groups[f.intensity].append(f)
            
        # Combine filters in each intensity group
        combined_filters = []
        for intensity, group in intensity_groups.items():
            if len(group) == 1:
                combined_filters.extend(group)
            else:
                combined = ContentFilter(
                    filter_text=" OR ".join(f.filter_text for f in group),
                    intensity=intensity,
                    filter_metadata={"combined": [f.model_dump() for f in group]}  # Updated to filter_metadata
                )
                combined_filters.append(combined)
                
        return combined_filters
    
    @handle_processing_errors
    async def select_text_intervention(
        self,
        text: str,
        matched_filters: List[ContentFilter]
    ) -> tuple[int, Optional[TextInterventionEvaluation]]:
        """
        Queries gpt-4o to perform a structured evaluation of text interventions
        and returns the best choice.

        Returns:
            A tuple containing:
            - The chosen intervention ID (1, 2, or 3).
            - The full TextInterventionEvaluation object from the LLM for logging/analysis.
            Returns (3, None) as a safe default in case of errors.
        """
        if not matched_filters:
            # If this function is called with no matching filters, no intervention is needed.
            return 0, None  # Assuming 0 means "no intervention"

        # 1. Prepare dynamic content for the prompt template
        filter_descriptions = "\n".join(
            [f"- Filter matching '{f.filter_text}': User Sensitivity: {f.intensity}/5 Filter metadata: {f.filter_metadata}" for f in matched_filters]
        )
        
        # Use the highest intensity from the matched filters as the primary driver for the decision
        highest_intensity = max([f.intensity for f in matched_filters])

        # 2. Format the final user prompt using the template
        user_prompt = prompts.SELECTOR_USER_PROMPT_TEMPLATE.format(
            text=text,
            filter_descriptions=filter_descriptions,
            highest_intensity=highest_intensity
        )

        # 3. Query the LLM and parse the response
        try:
            # OpenAI GPT-4o version
            logger.debug(f"Sending request to GPT-4o for text intervention selection. Async") 
            response = await self.llm_client.chat.completions.create(
                model= self.llm_model,  # Use the model configured for the processor
                messages= [
                    {"role": "system", "content": prompts.SELECTOR_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                    {"role": "user", "content": prompts.RESPONSE_JSON_SCHEMA}
                ],
                response_format={"type": "json_object"},
            )

            evaluation = validate_llm_response(
                response.choices[0].message.content,
                ['scores', 'rationale']
            )

            evaluation = TextInterventionEvaluation(**evaluation)
            logger.debug(f"LLM response for Text Intervention Evaluation: {response.choices[0].message.content}")
            logger.debug(f"LLM response for Text Intervention Evaluation: {evaluation}")

            # # Google Gemini version
            # logger.debug(f"Sending request to Gemini for text intervention selection. Async")
            # response = await self.gemini_client.aio.models.generate_content(
            #     model= "gemini-2.5-flash", # self.llm_model,  # Use the model configured for the processor
            #     contents=f"system: {prompts.SELECTOR_SYSTEM_PROMPT}\nuser: {user_prompt}", 
            #     # [
            #     #     {"role": "system", "content": prompts.SELECTOR_SYSTEM_PROMPT},
            #     #     {"role": "user", "content": user_prompt}
            #     # ],
            #     config={
            #         "response_mime_type": "application/json",
            #         "response_schema": TextInterventionEvaluation,
            #     }
            # )
            
            # evaluation = TextInterventionEvaluation.model_validate_json(response.text)
            # logger.debug(f"LLM response for Text Intervention Evaluation: {response.text}")
            # logger.debug(f"LLM response for Text Intervention Evaluation: {evaluation}")

            
            # 4. Use the scores to make the final decision
            # --- DYNAMIC WEIGHTING LOGIC ---
            # To easily switch strategies, you can comment/uncomment these blocks
            # or add more complex logic.
            
            # Set default weights for balanced mode
            content_fidelity_weight = 1.0
            emotional_impact_weight = 1.0
            
            # Adjust weights based on the highest sensitivity (intensity)
            # if highest_intensity <= 2:
            #     # For low sensitivity, prioritize keeping the original content as much as possible.
            #     content_fidelity_weight = 1.0
            #     logger.debug(f"Using content_fidelity-focused weights for intensity {highest_intensity}.")
            # elif highest_intensity >= 4:
            #     # For high sensitivity, prioritize reducing potential negative emotional impact.
            #     emotional_impact_weight = 1.0
            #     logger.debug(f"Using emotional_impact-focused weights for intensity {highest_intensity}.")
            # else: # highest_intensity == 3
            #     # Use balanced weights for medium sensitivity.
            #     logger.debug(f"Using balanced weights for intensity {highest_intensity}.")
            # --- END DYNAMIC WEIGHTING LOGIC ---

            intervention_map = {"Modify Segments": 1, "Add Warning": 2, "Rewrite": 3}
            best_intervention_id = 3 # Default to the safest option (Rewrite)
            max_score = -1

            for scores in evaluation.scores:
                # Apply the dynamic weights to calculate the score for each intervention type
                total_score = (
                    (1.0 * scores.overall_coherence) +
                    (content_fidelity_weight * scores.content_fidelity) +
                    (emotional_impact_weight * scores.predicted_emotional_impact)
                )
                logger.debug(f"  - Scoring '{scores.intervention_type}': Coherence({scores.overall_coherence}) + Fidelity({scores.content_fidelity} * {content_fidelity_weight}) + Impact({scores.predicted_emotional_impact} * {emotional_impact_weight}) = {total_score:.2f}")
                
                if total_score > max_score:
                    max_score = total_score
                    best_intervention_id = intervention_map[scores.intervention_type]
            
            logger.info(f"Best intervention selected: ID {best_intervention_id} ('{evaluation.scores[best_intervention_id-1].intervention_type}') with score {max_score:.2f}")
            return best_intervention_id

        except Exception as e:
            logger.error(f"Error during structured parsing or scoring: {e}. Defaulting to safe option (3).", exc_info=True)
            return 3