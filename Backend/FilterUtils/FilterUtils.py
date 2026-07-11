import json
import os
import random
import glob
from openai import AsyncOpenAI
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field
from utils.errors import LLMError, handle_processing_errors
import logging

logger = logging.getLogger(__name__)


# Validate API key
api_key = os.getenv('OPENAI_API_KEY')
if not api_key:
    raise LLMError("OPENAI_API_KEY not found in environment")

client = AsyncOpenAI(api_key=api_key)

AVAILABLE_INTERVENTIONS = [
      'blur', 'inpainting', 'occlusion', 'replacement',
      'shrink', 'warning',
      'stylize_cubism', 'stylize_impressionism', 'stylize_ghibli', 'stylize_pointillism',
      'selective_stylize_cubism', 'selective_stylize_impressionism', 'selective_stylize_ghibli',
      'selective_stylize_pointillism'
]


# Pydantic models for structured LLM responses
class FilterElementAnalysis(BaseModel):
    """Analysis of a single filter element in the image"""
    element: str = Field(..., description="The filter text being analyzed")
    present: int = Field(..., ge=0, le=1, description="1 if element is visible in image, 0 otherwise") 
    coverage: int = Field(..., ge=0, le=10, description="How much of image area the element occupies (0-10)")
    centrality: int = Field(..., ge=0, le=10, description="How important element is to main theme (0-10)")


class ImageFilterAnalysis(BaseModel):
    """Complete image analysis response with filter elements and intervention recommendations"""
    elements: List[FilterElementAnalysis] = Field(..., description="Analysis results for each filter element")
    recommended_interventions: List[str] = Field(default=[], description="Recommended intervention names")


class FilterResult(BaseModel):
    """Combined result containing best filter and recommended interventions"""
    best_filter: Optional[Any] = Field(default=None, description="The best matching filter object")
    recommended_interventions: List[str] = Field(default=[], description="List of recommended intervention names")
    top3_interventions: List[str] = Field(default=[], description="Top 3 recommended interventions")
    next2_interventions: List[str] = Field(default=[], description="Next 2 recommended interventions (for study purposes)")


async def get_image_filter_information(filter_texts: List[str], image_url: str, include_interventions: bool = False) -> ImageFilterAnalysis:
    """
    Analyzes an image to evaluate the presence and importance of given elements.
    Optionally also recommends appropriate interventions.
    Uses OpenAI's structured output with Pydantic models.
    """
    # Get available interventions for recommendation
    available_interventions = get_available_interventions()
    intervention_descriptions = {
        # --- High protection, low context retention ---
        'occlusion': (
            "Covers the specified region with an opaque patch. "
            "Maximizes suppression of visual detail but removes all information inside the region and is visually conspicuous."
        ),

        'replacement': (
            "Substitutes the specified region with a benign graphic or user-provided element while preserving layout. "
            "Can feel more natural than a black box but may appear out-of-place if blending fails;"
        ),

        # --- Context-preserving edits ---
        'inpainting': (
            "Removes the specified region and synthesizes plausible background content. "
            "Works best on simple textures or repetitive structure; may artifact on complex scenes;"
        ),

        'blur': (
            "Applies strong blur within the specified region while keeping the rest of the image clear. "
            "Preserves global context; the object’s silhouette may remain discernible."
        ),



        'shrink': (
            "Downscales the specified region and re-centers it within a filled background of the original area. "
            "Reduces visual prominence while keeping the element present."
        ),

        # --- Informational / interaction layer ---
        'warning': (
            "Occludes the specified region with a solid patch and overlays a clear text warning using the provided filter text."
        ),

        # --- Deterministic stylization interventions ---
        'stylize_cubism': (
            "Transforms the entire image into a Cubist style, deconstructing forms into geometric planes and angular facets to reduce realism."
        ),

        'stylize_impressionism': (
            "Transforms the entire image into an Impressionist style, using broken brushstrokes and atmospheric effects to soften harsh details."
        ),

        'stylize_ghibli': (
            "Transforms the entire image into an Abstract art style, reducing representational forms to non-representational shapes and colors."
        ),
        'stylize_pointillism': (
            "Transforms the entire image into a Pointillist style, using distinct dots of color to create forms and convey light."
        ),

        # --- Selective deterministic stylization interventions ---
        'selective_stylize_cubism': (
            "Applies Cubist style only to the specified region, deconstructing problematic elements into geometric forms while leaving surroundings realistic."
        ),

        'selective_stylize_impressionism': (
            "Applies Impressionist style only to the specified region, softening problematic elements with broken brushstrokes while keeping surroundings photorealistic."
        ),

        'selective_stylize_ghibli': (
            "Applies Studio Ghibli anime style only to the specified region, transforming problematic elements into friendly, hand-drawn forms while keeping surroundings realistic."
        ),
        'selective_stylize_pointillism': (
            "Applies Pointillist style only to the specified region, using distinct dots of color to transform problematic elements while keeping surroundings realistic."
        ),
    }
    
    intervention_section = ""
    if include_interventions:
        intervention_list = []
        for intervention in available_interventions:
            description = intervention_descriptions.get(intervention, f'Apply {intervention} intervention')
            intervention_list.append(f"- {intervention}: {description}")
        interventions_text = '\n'.join(intervention_list)
        
        intervention_section = f"""
        
        Additionally, based on your analysis of the image and any problematic content you find, recommend the 5 most appropriate interventions from this list, ranked by their expected effectiveness:
        {interventions_text}
        
        Evaluate each intervention using these criteria (same as our final scorer):
        1. **Overall Coherence (1-10):** How natural and believable would the transformed image be? Consider visual artifacts, disruption, and seamlessness.
        2. **Content Fidelity (1-10):** How well would the intervention preserve essential, non-triggering elements and composition of the original image?
        3. **Predicted Emotional Impact (1-10):** Based on the problematic content identified, how effective would this intervention be at reducing potential distress?
        
        Provide exactly 5 intervention names in the recommended_interventions field, ranked from best (highest combined score) to worst (lowest combined score).
        """
    
    prompt = f"""
    You are a helpful assistant whose task is to analyze an image and evaluate the presence and importance of a list of elements.

    For each element, provide:
    1. 'present': 1 if the element is clearly visible in the image, otherwise 0.
    2. 'coverage': a score from 0 to 10 representing how much of the image's area the element visually occupies (0 = very little, 10 = dominant).
    3. 'centrality': a score from 0 to 10 representing how important the element is to the *main idea or theme* of the image (0 = minor background detail, 10 = core/only subject of the image).

    The elements to analyze are: {filter_texts}.
    {intervention_section}
    """
    
    try:
        # Use structured output with beta API
        response = await client.beta.chat.completions.parse(
            model="gpt-4o",
            response_format=ImageFilterAnalysis,
            messages=[
                {"role": "system", "content": "You are a helpful assistant that analyzes images for content filtering."},
                {"role": "user", "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": image_url}},
                ]},
            ],
        )
        
        # Extract the parsed response
        analysis = response.choices[0].message.parsed
        
        logger.debug("Analyzed elements from image:")
        for element in analysis.elements:
            if element.present == 1:
                logger.debug(f"- Element: {element.element}, Present: {element.present}, Coverage: {element.coverage}, Centrality: {element.centrality}")

        if include_interventions and analysis.recommended_interventions:
            logger.debug(f"Recommended interventions: {analysis.recommended_interventions}")

        return analysis
        
    except Exception as e:
        logger.error(f"Error in structured image analysis: {e}")
        # Return empty structured response on error
        return ImageFilterAnalysis(
            elements=[],
            recommended_interventions=[]
        )

async def get_best_filter(filters: List[Dict[str, Any]], image_url: str, include_interventions: bool = False) -> Optional[FilterResult]:
    """
    Finds the most relevant filter from a list of filter objects based on image analysis.
    The "best" filter is determined by a weighted score of coverage and centrality.
    Returns the entire filter object that is deemed the best, or None.
    
    Args:
        filters: List of filter objects
        image_url: URL of the image to analyze
        include_interventions: Whether to also get intervention recommendations
        
    Returns:
        FilterResult containing best filter object and optionally recommended interventions,
        or legacy format for backward compatibility when include_interventions=False
    """
    if not filters:
        return None

    filter_texts = [(f.filter_text, "") for f in filters if f.filter_text]
    if not filter_texts:
        return None
        
    # Get structured analysis
    analysis_results = await get_image_filter_information(filter_texts, image_url, include_interventions)
    
    best_filter_object = None
    highest_score = -1.0

    # Create a mapping from filter text to its original filter object
    filter_map = {f.filter_text: f for f in filters}

    for element in analysis_results.elements:
        if element.present == 1:
            # Calculate a weighted score. Centrality is weighted more heavily.
            score = (0.4 * element.coverage) + (0.6 * element.centrality)
            
            if score > highest_score:
                highest_score = score
                # Find the original filter object using the element text
                best_filter_object = filter_map.get(element.element)

    if best_filter_object:
        logger.info(f"Best filter selected: {best_filter_object.filter_text} with score {highest_score}")
        if include_interventions and analysis_results.recommended_interventions:
            logger.info(f"Recommended interventions: {analysis_results.recommended_interventions}")
    else:
        logger.warning("No suitable filter found.")

    # Return structured result when interventions are included
    if include_interventions:
        # Split the 5 recommended interventions into top3 and next2
        recommended = analysis_results.recommended_interventions
        top3_interventions = recommended[:3] if len(recommended) >= 3 else recommended
        next2_interventions = recommended[3:5] if len(recommended) > 3 else []
        
        return FilterResult(
            best_filter=best_filter_object,
            recommended_interventions=analysis_results.recommended_interventions,
            top3_interventions=top3_interventions,
            next2_interventions=next2_interventions
        )
    else:
        # Return legacy format for backward compatibility
        return best_filter_object


def get_available_interventions() -> List[str]:
      return AVAILABLE_INTERVENTIONS.copy()


def get_random_interventions(count: int = 3) -> List[str]:
    """
    Randomly selects interventions from available interventions.
    
    Args:
        count: Number of interventions to select (default 3)
        
    Returns:
        List of randomly selected intervention names
    """
    available = get_available_interventions()
    
    # If we have fewer interventions than requested, return all available
    if len(available) <= count:
        return available
    
    # Randomly sample without replacement
    selected = random.sample(available, count)
    logger.info(f"Randomly selected interventions: {selected}")
    return selected


