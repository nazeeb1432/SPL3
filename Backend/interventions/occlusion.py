# interventions/occlusion.py

from typing import List, Dict, Any
from io import BytesIO
from PIL import Image, ImageDraw
# from llm.prompts import DETECTION_PROMPT
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class OcclusionIntervention(ImageIntervention):
    """
    Implements the occlusion intervention by drawing solid rectangles over specified areas.
    This intervention does not require an AI model call if coordinates are provided.
    """
    intervention_name = "occlusion"

    def apply(
        self, 
        image_bytes: bytes, 
        filters: Dict[str, Any], 
        model: ImageModel, 
        model_name: str = None
    ) -> bytes:
        """
        Applies the occlusion intervention using AI-powered object detection if needed.

        Args:
            image_bytes: The byte content of the image.
            filters: A dictionary containing filter details, especially 'filter_text'.
            model: The AI model instance, used for object detection.
            model_name: The specific model to use for detection.

        Returns:
            The byte content of the occluded image.
        """
        filter_text = filters.get('filter_text')
        filter_metadata = filters.get('filter_metadata', {})
        
        # Check if pixel coordinates are directly provided in metadata
        bounding_boxes = filter_metadata.get('bounding_boxes')
        
        if not bounding_boxes:
            if not filter_text:
                logger.warning("Occlusion called without bounding_boxes or filter_text. Returning original image.")
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
            image = Image.open(BytesIO(image_bytes))
            draw = ImageDraw.Draw(image)
            occlusion_color = filter_metadata.get("occlusion_color", "black")

            for bbox in bounding_boxes:
                if isinstance(bbox, list) and len(bbox) == 4:
                    draw.rectangle(bbox, fill=occlusion_color)
                else:
                    logger.warning(f"Invalid bounding box format in list: {bbox}. Skipping.")
            
            output_buffer = BytesIO()
            image.save(output_buffer, format="PNG")
            return output_buffer.getvalue()

        except Exception as e:
            logger.error(f"Error during Pillow drawing for occlusion: {e}. Returning original image.", exc_info=True)
            return image_bytes