
from openai import OpenAI, AsyncOpenAI
from ml_models.base import ImageModel
import requests
from io import BytesIO
import os
from PIL import Image as PILImage
import logging
from llm.prompts import DETECTION_PROMPT
from typing import Dict, Any
logger = logging.getLogger(__name__)
class OpenAIModel(ImageModel):
    """
    Implementation of the ImageModel interface using the OpenAI API.
    """

    def __init__(self, api_key: str = None):
        api_key = api_key
        if not api_key: 
            raise ValueError("OPENAI_API_KEY environment variable not set.")
        logger.info(f"Using OpenAI API key: {api_key[:18]}...")  # Log the first few characters for debugging
        self.client = OpenAI(api_key=api_key)
        self.async_client = AsyncOpenAI(api_key=api_key)  # Add async client

    def describe_image(self, image_url: str, model_name: str = "gpt-4o-mini") -> str:
        """
        Generates a textual description of an image using a specified GPT model.
        """
        response = self.client.chat.completions.create(
            model=model_name,
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "What's in this image?"},
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    },
                ],
            }],
        )
        return response.choices[0].message.content

    def generate_from_prompt(self, prompt: str, model_name: str = "dall-e-3", size: str = "1024x1024") -> str:
        """
        Generates an image based on a textual prompt using a specified DALL-E model.
        """
        response = self.client.images.generate(
            model=model_name,
            prompt=prompt,
            size=size,
            quality="standard",
            n=1,
        )
        return response.data[0].url

    async def edit_image_async(self, image_bytes: bytes, prompt: str, model_name: str = "gpt-image-1") -> bytes:
        """Async version of edit_image for better concurrency"""
        image_file = BytesIO(image_bytes)
        image_file.name = "edit.png"

        result = await self.async_client.images.edit(
            model="dall-e-2",
            image=image_file,
            prompt=prompt
        )
        
        edited_image_url = result.data[0].url
        response = requests.get(edited_image_url)  # This could also be made async
        response.raise_for_status()
        return response.content
        
    def edit_image(self, image_bytes: bytes, prompt: str, model_name: str = "gpt-image-1") -> bytes:
        """
        Edits an existing image based on a textual prompt.
        Note: The model name is for future compatibility, as 'images.edit' may support more models.
        """
        # The OpenAI 'edit' endpoint requires a file handle, not just bytes.
        image_file = BytesIO(image_bytes)
        image_file.name = "edit.png"  # The API requires a filename.

        result = self.client.images.edit(
            model="dall-e-2", # Currently, only dall-e-2 is supported for edits
            image=image_file,
            prompt=prompt
        )
        
        # The result is a URL to the edited image, so we need to download it.
        edited_image_url = result.data[0].url
        response = requests.get(edited_image_url)
        response.raise_for_status()  # Raise an exception for bad status codes
        return response.content
    
    def score_image_two_stage(self, system_prompt: str, user_prompt: str, original_image_url: str, candidate_image_url: str, model_name: str = "gpt-4o") -> str:
        """
        Uses a two-stage prompting approach (CoT -> Score) for more reliable evaluation.
        Stage 1: Ask for Chain-of-Thought analysis.
        Stage 2: Ask for the final score based on the analysis.
        """
        
        # --- Stage 1: Chain of Thought Analysis ---
        cot_user_prompt = user_prompt + "\n\nFirst, provide a detailed step-by-step analysis of the intervention based on the evaluation axes. Do NOT provide the final JSON score yet."
        
        analysis_response = self.client.chat.completions.create(
            model=model_name,
            messages=[{"role": "system", "content": system_prompt},
                      {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": cot_user_prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": original_image_url},
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": candidate_image_url},
                            },
                        ],
                    }],
        )
        analysis_text = analysis_response.choices[0].message.content
        logger.info(f"Two-Stage Scoring: Stage 1 Analysis complete. Length: {len(analysis_text)} chars")
        
        # --- Stage 2: Final Scoring ---
        scoring_user_prompt = "Based on the above analysis, now provide the final score in the requested JSON format."
        
        score_response = self.client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user", 
                    "content": [
                        {"type": "text", "text": cot_user_prompt},
                        {"type": "image_url", "image_url": {"url": original_image_url}},
                        {"type": "image_url", "image_url": {"url": candidate_image_url}},
                    ]
                }, 
                {"role": "assistant", "content": analysis_text},
                {"role": "user", "content": scoring_user_prompt}
            ],
            response_format={"type": "json_object"},
        )
        
        return score_response.choices[0].message.content

    def score_image(self, system_prompt: str, user_prompt: str, original_image_url: str, candidate_image_url: str, model_name: str = "gpt-4o") -> str:
        """
        Uses a VLM to analyze two images and return a structured JSON string with a score.
        """
        response = self.client.chat.completions.create(
            model=model_name,
            messages=[{"role": "system", "content": system_prompt},
                      {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": user_prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": original_image_url},
                            },
                            {
                                "type": "image_url",
                                "image_url": {"url": candidate_image_url},
                            },
                        ],
                    }],
            # Enforce JSON output
            response_format={"type": "json_object"},
        )
        return response.choices[0].message.content

    def detect_objects(self, image_bytes: bytes, filter_text: str, filter_metadata: Dict[str, Any], model_name: str = "gpt-4o") -> dict:
        """
        Detect objects in an image using OpenAI's vision capabilities.
        Returns a dictionary with detected objects and their normalized coordinates.
        """
        import json
        from PIL import Image
        
        # Convert bytes to base64 for OpenAI API
        import base64
        base64_image = base64.b64encode(image_bytes).decode('utf-8')
        data_url = f"data:image/png;base64,{base64_image}"
        
        # Get image dimensions
        image = Image.open(BytesIO(image_bytes))
        img_width, img_height = image.size
        
        detection_prompt = DETECTION_PROMPT.format(
            filter_text=filter_text,
            image_width=img_width,
            image_height=img_height,
            filter_metadata=filter_metadata
        )
        
        try:
            response = self.client.chat.completions.create(
                model=model_name,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": detection_prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                }],
                response_format={"type": "json_object"},
                temperature=0.1  # Low temperature for precise detection
            )
            
            detection_result = json.loads(response.choices[0].message.content)
            logger.info(f"OpenAI object detection completed. Found {len(detection_result.get('detected_objects', []))} objects")
            return detection_result
            
        except Exception as e:
            logger.error(f"OpenAI object detection failed: {e}")
            return {
                "detected_objects": [],
                "image_dimensions": {"width": img_width, "height": img_height},
                "error": f"Detection failed: {str(e)}"
            }
