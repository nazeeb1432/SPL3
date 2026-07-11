# interventions/shrink.py

from typing import Dict, Any
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class ShrinkIntervention(ImageIntervention):
    """
    Implements the shrink intervention using a generative AI model.
    It reduces the visual prominence of a specified object by redrawing it at a smaller scale in-place.
    """
    intervention_name = "shrink"

    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel) -> bytes:
        """
        Applies the generative shrink intervention.

        Args:
            image_bytes: The byte content of the image to process.
            filters: A dictionary containing the description of the object to shrink.
            model: The AI model instance to use for editing.

        Returns:
            The byte content of the edited image.
        """
        filter_description = filters.get('filter_text')
        if not filter_description:
            logger.error("Shrink intervention requires a 'filter_text' description.")
            raise ValueError("Shrink intervention requires a 'filter_text' description.")

        filter_metadata = filters.get('filter_metadata', {})
        # Shrink factor can be used to guide the prompt's instruction on how much to shrink
        shrink_factor = filter_metadata.get("shrink_factor", 0.8) # Default to 50% size

        # Convert factor to a descriptive term for the prompt
        if shrink_factor <= 0.5:
            size_description = "about 15-20% of its original size"
        elif shrink_factor <= 0.7:
            size_description = "about 5-10% of its original size"
        else:
            size_description = "about 2-3% of its original size"

        logger.info(f"Applying generative shrink for: '{filter_description}', aiming for {size_description}")

        # This prompt guides the model to perform a complex in-place scaling and inpainting task.
        prompt = (
            "You are an expert AI photo editor specializing in subtle, in-place object resizing.\n\n"
            "## CONTEXT:\n"
            f"- Object to Modify: The user wants to reduce the visual prominence of '{filter_description}'.\n\n"
            "## TASK:\n"
            "1.  **Identify and Segment:** Precisely locate all instances of '{filter_description}' in the image.\n"
            "2.  **Shrink and Re-render:** Redraw the identified object(s) so that they are "
            f"{size_description}. The object must remain in the exact same location (centered on its original position) and retain its core identity.\n"
            "3.  **Seamlessly Inpaint:** As you shrink the object, intelligently and seamlessly fill the newly exposed surrounding area with a background that is perfectly consistent with the rest of the image.\n"
            "4.  **Constraint:** The final image must look natural and unedited. The only change should be that the target object is now smaller.\n"
            "5.  **Output:** Generate only the final, modified image."
        )

        try:
            return model.edit_image(image_bytes, prompt)
        except Exception as e:
            logger.error(f"Error during generative shrink intervention for '{filter_description}': {e}", exc_info=True)
            # Fail safely by returning the original image if the AI call fails.
            return image_bytes