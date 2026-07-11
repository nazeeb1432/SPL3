
from ml_models.base import ImageModel
from typing import Dict, Any, List
import logging
from ImageProcessor.ObjectDetector.GroundingDINODetector import GroundingDINODetector
from PIL import Image
import torch
import numpy as np
from io import BytesIO

logger = logging.getLogger(__name__)

class GroundingDinoModel(ImageModel):
    """
    Adapter for GroundingDINODetector to fit the ImageModel interface.
    """
    def __init__(self):
        self.detector = GroundingDINODetector()
        # logger.info(f"Initialized GroundingDinoModel with device: {self.detector.device}")

    def detect_objects(self, image_bytes: bytes, filter_text: str, filter_metadata: Dict[str, Any] = None) -> dict:
        """
        Detect objects in an image using GroundingDino.
        """
        try:
            # GroundingDINODetector.detect expects a numpy array (image) and a list of filters.
            
            pil_image = Image.open(BytesIO(image_bytes)).convert("RGB")
            # Convert to numpy array (H, W, C)
            image_np = np.array(pil_image)
            
            # GroundingDINODetector.detect expects (image, filters) where filters is a list e.g. ["cat."]
            # create filter list from filter_text
            filters = [filter_text]
            
            # Call the underlying detector
            # logic: detect(self, image, filters) returns list of boxes [[x1, y1, x2, y2], ...]
            boxes = self.detector.detect(image_np, filters)
            
            if boxes is None:
                boxes = []
                
            # Convert to format expected by ImageModel/OcclusionIntervention
            # OcclusionIntervention expects: [obj['bounding_box'] for obj in detected_objects]
            # detected_objects should be a list of dicts with 'bounding_box' key.
            
            detected_objects = []
            for box in boxes:
                detected_objects.append({
                    "label": filter_text,
                    "confidence": "unknown", # The original code swallows confidence.
                    "bounding_box": box
                })
                
            return {
                "detected_objects": detected_objects,
                "image_dimensions": {"width": pil_image.width, "height": pil_image.height}
            }
            
        except Exception as e:
            logger.error(f"GroundingDino detection failed: {e}", exc_info=True)
            return {"detected_objects": [], "error": str(e)}

    # Implementing abstract methods with stubs as they are not supported by this local model
    def describe_image(self, image_url: str, model_name: str = "default") -> str:
        raise NotImplementedError("Description not supported by GroundingDino")

    def generate_from_prompt(self, prompt: str, model_name: str = "default", size: str = "1024x1024") -> str:
        raise NotImplementedError("Generation not supported by GroundingDino")

    def edit_image(self, image_bytes: bytes, prompt: str, model_name: str = "default") -> bytes:
        raise NotImplementedError("Editing not supported by GroundingDino")
        
    def score_image(self, system_prompt: str, user_prompt: str, original_image_url: str, candidate_image_url: str, model_name: str = "default") -> str:
        raise NotImplementedError("Scoring not supported by GroundingDino")
