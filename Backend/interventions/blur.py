# interventions/blur.py

from typing import List, Dict, Any
from io import BytesIO
from PIL import Image, ImageFilter, ImageDraw
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class BlurIntervention(ImageIntervention):
    """
    Implements the blur intervention by applying gaussian blur to specified areas.
    This intervention does not require an AI model call if coordinates are provided.
    """
    intervention_name = "blur"

    def apply(
        self, 
        image_bytes: bytes, 
        filters: Dict[str, Any], 
        model: ImageModel, 
        model_name: str = None
    ) -> bytes:
        """
        Applies the blur intervention using AI-powered object detection if needed.

        Args:
            image_bytes: The byte content of the image.
            filters: A dictionary containing filter details, especially 'filter_text'.
            model: The AI model instance, used for object detection.
            model_name: The specific model to use for detection.

        Returns:
            The byte content of the blurred image.
        """
        filter_text = filters.get('filter_text')
        filter_metadata = filters.get('filter_metadata', {})
        
        # Check if pixel coordinates are directly provided in metadata
        bounding_boxes = filter_metadata.get('bounding_boxes')
        
        if not bounding_boxes:
            if not filter_text:
                logger.warning("Blur called without bounding_boxes or filter_text. Returning original image.")
                return image_bytes

            logger.info(f"No bounding boxes provided. Using AI detection for: '{filter_text}'")
            try:
                # --- AI Detection Step ---
                detection_result = model.detect_objects(image_bytes, filter_text=filter_text, filter_metadata=filter_metadata)
                detected_objects = detection_result.get('detected_objects', [])
                
                # Directly extract the pixel-based bounding boxes
                bounding_boxes = [obj['bounding_box'] for obj in detected_objects if 'bounding_box' in obj]
                
                if not bounding_boxes:
                    logger.warning(f"AI detection found no instances of '{filter_text}'. Returning original image.")
                    return image_bytes # Fail safely by doing nothing
                    
            except Exception as e:
                logger.error(f"AI object detection failed catastrophically: {e}. Returning original image.", exc_info=True)
                return image_bytes

        try:
            # --- Image Processing Step ---
            image = Image.open(BytesIO(image_bytes)).convert("RGB")
            blur_radius = filter_metadata.get("blur_radius", 18)  # Default blur radius
            
            # Create a blurred version of the entire image
            blurred_image = image.filter(ImageFilter.GaussianBlur(radius=blur_radius))
            
            # Create a mask for the areas to blur
            mask = Image.new('L', image.size, 0)  # Black mask (transparent)
            mask_draw = ImageDraw.Draw(mask)
            
            for bbox in bounding_boxes:
                if isinstance(bbox, list) and len(bbox) == 4:
                    # Draw white rectangle on mask for areas to blur
                    mask_draw.rectangle(bbox, fill=255)
                else:
                    logger.warning(f"Invalid bounding box format in list: {bbox}. Skipping.")
            
            # Composite the original and blurred images using the mask
            result_image = Image.composite(blurred_image, image, mask)
            
            output_buffer = BytesIO()
            result_image.save(output_buffer, format="PNG")
            return output_buffer.getvalue()

        except Exception as e:
            logger.error(f"Error during image blurring: {e}. Returning original image.", exc_info=True)
            return image_bytes