from typing import Dict, Any, Optional
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class StylizePointillismIntervention(ImageIntervention):
    """
    Implements the Pointillism stylization intervention.
    """
    intervention_name = "stylize_pointillism"

    def _get_style_prompts(self, filter_description: str, sensitivity: Optional[int] = None) -> Dict[str, str]:
        """
        Build style prompts that (a) mitigate user-specific triggers, (b) preserve factual integrity,
        and (c) keep outputs coherent. `sensitivity` is 1–5 (higher => stronger mitigation).
        """

        base = (
            "You are an expert AI image editor specializing in therapeutic content transformation."
            "Your role is to balance artistic integrity with the user's emotional safety.\n\n"
            "CONTEXT:\n"
            f"- User trigger: '{filter_description}'.\n"
            "GOAL:\n"
            "- Reinterpret the image in the requested style to reduce the trigger’s salience while preserving the scene’s meaning and composition.\n\n"
            "- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object."
            "EVALUATION GUARDRAILS (must satisfy all):\n"
            "- Coherence: output remains readable and logically consistent.\n"
            "- Factual integrity: preserve real objects, layout, and relationships; add no new elements; do not hallucinate text or objects.\n"
            "- Emotional impact: minimize residual visibility of the trigger for this user; when uncertain, prefer over-mitigation.\n\n"
            "GENERAL INSTRUCTIONS:\n"
            "- Apply the style to the entire image for cohesion.\n"
            "- SPECIAL FOCUS: handle elements matching the trigger as specified below for the chosen style.\n"
            "- FINAL OUTPUT: Generate only the transformed image file. Do not include any text, captions, or commentary.\n"
        )

        pointillism = (
            "STYLE: Pointillism\n"
            "STYLE REQUIREMENTS:\n"
            "- Construct the entire image from small, distinct dots of pure color.\n"
            "- Emphasize the overall effect of light and form as perceived from a distance.\n"
            "- Avoid hard outlines and black shadows; use complementary colors for shading.\n"
            "- Ensure the overall scene and subjects remain recognizable.\n\n"
            f"SPECIAL FOCUS:\n"
            f"- The area containing '{filter_description}' must be the most abstract part of the composition. Use larger, more distinct, and less densely packed dots in this region to dissolve its form and obscure fine details completely."
        )

        return {
            "pointillism": f"{base}\n{pointillism}",
        }

    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel) -> bytes:
        """
        Applies a randomly selected stylization intervention.

        Args:
            image_bytes: The byte content of the image to process.
            filters: A dictionary containing the user's filter description.
            model: The AI model instance to use for editing.

        Returns:
            The byte content of the stylized image.
        """

        filter_description = filters.get('filter_text')
        sensitivity = filters.get('sensitivity')
        # Define the available styles and their prompts
        style_prompts = self._get_style_prompts(filter_description, int(sensitivity))
        available_styles = list(style_prompts.keys())

        # Randomly select a style for this application to ensure diversity
        chosen_style = "pointillism"
        
        # Get the detailed, high-quality prompt for the chosen style
        prompt = style_prompts[chosen_style]

        print(f"Applying stylization: chosen style is '{chosen_style}'")
        
        return model.edit_image(image_bytes, prompt)