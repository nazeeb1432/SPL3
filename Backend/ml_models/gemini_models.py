
import os
from io import BytesIO
import requests
from PIL import Image as PILImage
from ml_models.base import ImageModel
from llm.prompts import DETECTION_PROMPT
import logging
logger = logging.getLogger(__name__)
from typing import Dict, Any

# Conditional import for Google Gemini
try:
    from google import genai
    from google.genai import types
    GEMINI_AVAILABLE = True
except ImportError:
    GEMINI_AVAILABLE = False

class GeminiModel(ImageModel):
    """
    Implementation of the ImageModel interface using the Google Gemini API.
    """

    def __init__(self, api_key: str = None):
        logger.info(f"Initializing GeminiModel with API key: {api_key[:18]}...")  # Log the first few characters for debugging
        if not GEMINI_AVAILABLE:
            raise ImportError("Google Gemini SDK not available. Please install with: pip install google-generativeai pillow")

        api_key = api_key
        if not api_key:
            raise ValueError("GOOGLE_API_KEY environment variable not set.")
        
        self.client = genai.Client(api_key=api_key)

    def describe_image(self, image_url: str, model_name: str = "gemini-pro-vision") -> str:
        """
        Generates a textual description of an image using a specified Gemini model.
        """
        # This is a simplified approach. For a real implementation, you'd download
        # the image and send the bytes.
        prompt = "What's in this image?"
        response = self.client.models.generate_content(
            model=model_name,
            content=[prompt, PILImage.open(requests.get(image_url, stream=True).raw)]
        )
        return response.text

    def generate_from_prompt(self, prompt: str, model_name: str = "gemini-2.0-flash-preview-image-generation", size: str = "1024x1024") -> str:
        """
        Generates an image based on a textual prompt.
        Note: Gemini image generation API details might differ. This is a conceptual implementation.
        The size parameter is kept for interface consistency but may not be used by Gemini.
        """
        # This is a placeholder for Gemini's image generation logic.
        # The actual API call might be different.
        raise NotImplementedError("Gemini image generation from prompt is not implemented in this example.")

    def edit_image(self, image_bytes: bytes, prompt: str, model_name: str = "gemini-2.0-flash-preview-image-generation") -> bytes:
        """
        Edits an existing image based on a textual prompt using Gemini.
        """
        image = PILImage.open(BytesIO(image_bytes))
        
        response = self.client.models.generate_content(
            model=model_name,
            contents=[prompt, image],
            config=types.GenerateContentConfig(
                response_modalities=['TEXT', 'IMAGE'],
                temperature=0.0,
                max_output_tokens=8192,
                top_p=0.95,
            )
        )
        
        # Process the response to extract the image bytes
        for part in response.candidates[0].content.parts:
            if part.inline_data and part.inline_data.data:
                return part.inline_data.data
        
        raise ValueError("No image data was returned from the Gemini API.")

    def score_image(self, system_prompt: str, user_prompt: str, original_image_url: str, candidate_image_url: str, model_name: str = "gemini-2.5-flash") -> str:
        """
        Uses Gemini to analyze two images and return a structured JSON string with a score.
        """
        # Download image content
        original_image = PILImage.open(requests.get(original_image_url, stream=True).raw)
        candidate_image = PILImage.open(requests.get(candidate_image_url, stream=True).raw)

        response = self.client.models.generate_content(
            model=model_name,
            config=types.GenerateContentConfig(
                temperature=1.0,
                max_output_tokens=8192,
                system_instruction=system_prompt,
                response_mime_type="application/json"
            ),
            contents=[user_prompt, original_image, candidate_image],
        )
        
        return response.text

    def detect_objects(self, image_bytes: bytes, filter_text: str, filter_metadata: Dict[str,Any], model_name: str = "gemini-2.5-flash") -> dict:
        """
        Detect objects in an image and return their bounding box coordinates.
        Returns a dictionary with detected objects and their normalized coordinates.
        """
        import json
        image = PILImage.open(BytesIO(image_bytes))
        
        # Get image dimensions for coordinate normalization
        img_width, img_height = image.size
        
        detection_prompt = DETECTION_PROMPT.format(
            filter_text=filter_text,
            image_width=img_width,
            image_height=img_height,
            filter_metadata=filter_metadata
        )
        # print(f"Detection prompt: {detection_prompt}")
        response = self.client.models.generate_content(
            model=model_name,
            contents=[detection_prompt, image],
            config=types.GenerateContentConfig(
                temperature=0.1,  # Low temperature for precise detection
                max_output_tokens=2048,
                response_mime_type="application/json"
            )
        )

        # The API should return a parsed JSON object when mime_type is set,
        # but we'll handle both string and dict responses for robustness.
        response_text = response.text
        if not response_text.strip().startswith('{'):
            # Handle cases where the model might add pretext
            json_start = response_text.find('{')
            json_end = response_text.rfind('}') + 1
            if json_start != -1 and json_end != -1:
                response_text = response_text[json_start:json_end]
        
        try:
            detection_result = json.loads(response_text)
            logger.info(f"Object detection completed. Found {len(detection_result.get('detected_objects', []))} objects of '{filter_text}'.")
            return detection_result
        except (json.JSONDecodeError, ValueError, Exception) as e:
            logger.error(f"Failed to parse object detection response from Gemini: {e}\nResponse text: {getattr(response, 'text', 'N/A')}")
            return {
                "detected_objects": [],
                "image_dimensions": {"width": img_width, "height": img_height},
                "error": "Failed to parse detection response"
            }
