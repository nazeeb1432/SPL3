# interventions/warning.py

from typing import Dict, Any
from io import BytesIO
from PIL import Image, ImageDraw, ImageFont
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class WarningIntervention(ImageIntervention):
    """
    Implements the content warning overlay intervention.
    It identifies a distressing element and places a text-based warning directly over it.
    """
    intervention_name = "warning"

    def apply(
        self, 
        image_bytes: bytes, 
        filters: Dict[str, Any], 
        model: ImageModel, 
        model_name: str = None
    ) -> bytes:
        """
        Applies a warning overlay to specified areas of an image.

        Args:
            image_bytes: The byte content of the image.
            filters: A dictionary containing filter details, including 'filter_text'.
            model: The AI model instance, used for object detection.
            model_name: The specific model to use for detection.

        Returns:
            The byte content of the image with a warning overlay.
        """
        filter_text = filters.get('filter_text')
        filter_metadata = filters.get('filter_metadata', {})
        
        # Check if pixel coordinates are directly provided in metadata
        bounding_boxes = filter_metadata.get('bounding_boxes')
        
        if not bounding_boxes:
            if not filter_text:
                logger.warning("Warning called without bounding_boxes or filter_text. Returning original image.")
                return image_bytes

            logger.info(f"No bounding boxes provided for warning. Using AI detection for: '{filter_text}'")
            try:
                # --- AI Detection Step ---
                detection_result = model.detect_objects(image_bytes, filter_text=filter_text, filter_metadata=filter_metadata)
                detected_objects = detection_result.get('detected_objects', [])
                bounding_boxes = [obj['bounding_box'] for obj in detected_objects if 'bounding_box' in obj]
                
                if not bounding_boxes:
                    logger.warning(f"AI detection found no instances of '{filter_text}' for warning. Returning original image.")
                    return image_bytes # Fail safely
                    
            except Exception as e:
                logger.error(f"AI object detection for warning failed: {e}. Returning original image.", exc_info=True)
                return image_bytes

        try:
            # --- Image Processing Step ---
            image = Image.open(BytesIO(image_bytes)).convert("RGBA")
            draw = ImageDraw.Draw(image)
            
            warning_text = filter_metadata.get("warning_text", f"Warning: Contains {filter_text}")
            font_size = filter_metadata.get("font_size", 48)
            box_color = filter_metadata.get("box_color", (0, 0, 0, 180)) # Semi-transparent black
            text_color = filter_metadata.get("text_color", (255, 255, 255)) # White text

            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except IOError:
                logger.warning("Arial font not found. Using default font for warning.")
                font = ImageFont.load_default()

            for bbox in bounding_boxes:
                if not (isinstance(bbox, list) and len(bbox) == 4):
                    logger.warning(f"Invalid bounding box format for warning: {bbox}. Skipping.")
                    continue
                
                # --- DYNAMIC FONT SIZING ---
                # Calculate an appropriate font size based on the bounding box height
                box_height = bbox[3] - bbox[1]
                # Aim for the font to be roughly 1/15th of the box height, with a minimum size
                dynamic_font_size = max(12, int(box_height / 15))
                
                try:
                    # Attempt to load the font with the dynamically calculated size
                    sized_font = ImageFont.truetype("arial.ttf", dynamic_font_size)
                except IOError:
                    # If Arial is not available, the default font will be used (size cannot be changed)
                    sized_font = ImageFont.load_default(size=dynamic_font_size)
                    if 'arial' in font.font.family.lower(): # Check if default is not what we wanted
                        logger.warning(f"Could not use dynamic font size {dynamic_font_size}. Falling back to fixed-size default font.")
                # --- END DYNAMIC FONT SIZING ---

                # Draw the semi-transparent overlay
                draw.rectangle(bbox, fill=box_color)
                
                # Calculate text position to center it within the box
                x1, y1, x2, y2 = bbox
                
                # Use the (potentially) resized font for measurement and drawing
                try:
                    text_bbox = sized_font.getbbox(warning_text)
                    text_width = text_bbox[2] - text_bbox[0]
                    text_height = text_bbox[3] - text_bbox[1]
                except AttributeError:
                    text_width, text_height = draw.textsize(warning_text, font=sized_font)

                text_x = x1 + (x2 - x1 - text_width) / 2
                text_y = y1 + (y2 - y1 - text_height) / 2
                
                # Draw the warning text
                draw.text((text_x, text_y), warning_text, font=sized_font, fill=text_color)

            
            output_buffer = BytesIO()
            image.convert("RGB").save(output_buffer, format="PNG")
            return output_buffer.getvalue()

        except Exception as e:
            logger.error(f"Error during warning overlay creation: {e}. Returning original image.", exc_info=True)
            return image_bytes