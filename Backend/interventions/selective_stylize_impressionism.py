from typing import Dict, Any, Optional
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class SelectiveStylizeImpressionismIntervention(ImageIntervention):
    """
    Implements a selective stylization intervention using Impressionism.
    It transforms only the specified distressing element into an Impressionist style,
    leaving the rest of the image photorealistic.
    """
    intervention_name = "selective_stylize_impressionism"

    def _build_prompt(self, filter_description: str, sensitivity: Optional[float] = None) -> str:
        """
        Builds the specific prompt for selective Impressionism style.
        """
        if sensitivity is not None:
            sens_level = int(sensitivity)
            sens_line = f"- Sensitivity: {sens_level}/5 (higher => stronger intervention)\n"
            soft_adverb = "gently" if sens_level <= 2 else ("clearly" if sens_level == 3 else "strongly")
        else:
            sens_line = ""
            soft_adverb = "clearly"

        # Base prompt focuses on the precision of the selective edit
        base = (
            "You are a master AI photo editor with expertise in highly localized, region-specific style transformations. Your task is to modify ONLY a specific object within an image, leaving the rest of the scene completely untouched and photorealistic.\n\n"
            "## CONTEXT:\n"
            f"- Target Object: The user finds '{filter_description}' distressing.\n"
            f"{sens_line}"
            "- Primary Goal: The transformation MUST make the target object significantly less realistic to reduce its visceral impact.\n"
            "- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object."
            "- CRITICAL CONSTRAINT: The background and all other non-target objects in the image MUST remain in their original, photorealistic state. Only the target object should be stylized.\n\n"
            "## INSTRUCTIONS:\n"
            f"1.  **Precisely Identify and Segment:** Isolate all instances of '{filter_description}' with perfect pixel-level accuracy. This mask is the ONLY area you are allowed to edit.\n"
            "2.  **Apply Style to Target Only:** Re-render the segmented area according to the specified style below.\n"
            "3.  **Seamless Integration:** Ensure the boundary between the stylized object and the photorealistic background is clean and natural.\n"
            "4.  **Output:** Generate only the final, selectively modified image."
        )

        impressionism_focus = (
            "STYLE: Impressionism\n"
            "STYLE REQUIREMENTS FOR TARGET:\n"
            "- Render the target object with visible, broken brushstrokes and an emphasis on light over sharp detail.\n"
            "- CRITICAL: Drastically reduce the level of detail. The result should feel more like a symbol than a detailed character."
            f"- Use vibrant colors to {soft_adverb} dissolve the object's hard outlines, making its form soft and indistinct."
        )

        return f"{base}\n{impressionism_focus}"

    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel, model_name: str = None) -> bytes:
        """Applies the selective Impressionism intervention."""
        filter_description = filters.get('filter_text', 'a distressing element')
        sensitivity = filters.get('intensity') # Expects int 1-5
        
        prompt = self._build_prompt(filter_description, sensitivity)
        
        logger.info("Applying selective Impressionism stylization.")
        return model.edit_image(image_bytes, prompt)