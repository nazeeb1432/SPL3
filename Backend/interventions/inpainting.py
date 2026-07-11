# interventions/inpainting.py

from typing import Dict, Any
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class InpaintingIntervention(ImageIntervention):
    """
    Implements the inpainting intervention.
    It uses a generative model to remove a specified object and fill the space
    with a contextually coherent background.
    """
    intervention_name = "inpainting"

    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel) -> bytes:
        """
        Applies the inpainting intervention.

        Args:
            image_bytes: The byte content of the image to process.
            filters: A dictionary containing the description of the object to remove.
            model: The AI model instance to use for inpainting.

        Returns:
            The byte content of the edited image.
        """
        filter_description = filters.get('filter_text')
        if not filter_description:
            logger.error("Inpainting intervention requires a 'filter_text' description.")
            raise ValueError("Inpainting intervention requires a 'filter_text' description.")
        
        logger.info(f"Applying inpainting to remove: '{filter_description}'")

        # The prompt is a direct instruction to the generative model to remove an object.
        # This is simpler than replacement as we trust the model's inpainting capability.
        prompt = (
            "You are an expert AI photo editor specializing in inpainting. "
            "Your task is to seamlessly remove an object from this image. "
            f"Identify and completely remove all instances of '{filter_description}'. "
            "Fill the resulting empty space with a background that is perfectly consistent and coherent with the surrounding area. "
            "The final image should look natural and as if the object was never there. "
            "Do not add any new objects. Output only the modified image."
        )

        try:
            # The 'edit_image' function in the model should handle the inpainting/masking logic.
            return model.edit_image(image_bytes, prompt)
        except Exception as e:
            logger.error(f"Error during inpainting intervention for '{filter_description}': {e}", exc_info=True)
            # Fail safely by returning the original image if the AI call fails.
            return image_bytes