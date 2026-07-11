import random
from typing import Dict, Any
from typing import Dict, Optional
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class SelectiveStylizationIntervention(ImageIntervention):
    """
    Implements a selective stylization intervention.
    It transforms only the specified distressing element into an artistic style,
    leaving the rest of the image photorealistic.
    """
    intervention_name = "selectivestylization"

    def _get_style_prompts(self, filter_description: str) -> Dict[str, str]:
        """
        Generates a dictionary of detailed prompts for various artistic styles,
        specifically tailored for selective application.
        """
        # Base prompt focuses on the precision of the selective edit
        base = (
            "You are a master AI photo editor with expertise in highly localized, region-specific style transformations. Your task is to modify ONLY a specific object within an image, leaving the rest of the scene completely untouched and photorealistic.\n\n"
            "## CONTEXT:\n"
            f"- Target Object: The user finds '{filter_description}' distressing.\n"
            "- Primary Goal: The transformation MUST make the target object significantly less realistic to reduce its visceral impact.\n"
            "- CRITICAL CONSTRAINT: The background and all other non-target objects in the image MUST remain in their original, photorealistic state. Only the target object should be stylized.\n\n"
            "## INSTRUCTIONS:\n"
            "1.  **Precisely Identify and Segment:** Isolate all instances of '{filter_description}' with perfect pixel-level accuracy. This mask is the ONLY area you are allowed to edit.\n"
            "2.  **Apply Style to Target Only:** Re-render the segmented area according to the specified style below.\n"
            "3.  **Seamless Integration:** Ensure the boundary between the stylized object and the photorealistic background is clean and natural.\n"
            "4.  **Output:** Generate only the final, selectively modified image."
        )

        cubism_focus = (
            "STYLE: Cubism\n"
            "STYLE REQUIREMENTS FOR TARGET:\n"
            "- Deconstruct the target object into geometric planes and angular facets.\n"
            "- Use a muted, cohesive color palette within the stylized region.\n"
            f"- The final stylized form of '{filter_description}' should be abstract but still recognizable as having replaced the original object."
        )

        impressionism_focus = (
            "STYLE: Impressionism\n"
            "STYLE REQUIREMENTS FOR TARGET:\n"
            "- Render the target object with visible, broken brushstrokes and an emphasis on light over sharp detail.\n"
            "- Use vibrant colors to dissolve the object's hard outlines, making its form soft and indistinct."
        )

        ghibli_focus = (
            "STYLE: Studio Ghibli\n"
            "STYLE REQUIREMENTS FOR TARGET:\n"
            "- Redraw the target object with clean, hand-drawn line art and simplified, friendly forms.\n"
            "- Use a gentle, harmonious color palette to make the object appear benign and non-threatening."
        )

        return {
            "cubism": f"{base}\n{cubism_focus}",
            "impressionism": f"{base}\n{impressionism_focus}",
            "ghibli": f"{base}\n{ghibli_focus}",
        }

    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel) -> bytes:
        """
        Applies a randomly selected selective stylization intervention.

        Args:
            image_bytes: The byte content of the image to process.
            filters: A dictionary containing the user's filter description.
            model: The AI model instance to use for editing.

        Returns:
            The byte content of the stylized image.
        """
        filter_description = filters.get('filter_text', 'a distressing element')
        
        # Define the available styles and their prompts
        style_prompts = self._get_style_prompts(filter_description)
        available_styles = list(style_prompts.keys())

        # Randomly select a style for this application
        chosen_style = random.choice(available_styles)
        
        # Get the detailed prompt for the chosen style
        prompt = style_prompts[chosen_style]

        logger.info(f"Applying selective stylization: chosen style is '{chosen_style}'")
        
        try:
            return model.edit_image(image_bytes, prompt)
        except Exception as e:
            logger.error(f"Error during selective stylization for '{filter_description}': {e}", exc_info=True)
            return image_bytes