
from abc import ABC, abstractmethod

class ImageModel(ABC):
    """
    Abstract base class for an image processing model.
    It defines the common interface that all concrete model implementations must follow.
    """

    @abstractmethod
    def describe_image(self, image_url: str, model_name: str) -> str:
        """
        Generates a textual description of an image.

        Args:
            image_url: The URL of the image to describe.
            model_name: The specific model version to use (e.g., "gpt-4o-mini").

        Returns:
            A string containing the description of the image.
        """
        ...

    @abstractmethod
    def generate_from_prompt(self, prompt: str, model_name: str, size: str = "1024x1024") -> str:
        """
        Generates an image based on a textual prompt.

        Args:
            prompt: The text prompt to generate the image from.
            model_name: The specific model version to use (e.g., "dall-e-3").
            size: The desired size of the generated image.

        Returns:
            The URL of the generated image.
        """
        ...

    @abstractmethod
    def edit_image(self, image_bytes: bytes, prompt: str, model_name: str) -> bytes:
        """
        Edits an existing image based on a textual prompt.

        Args:
            image_bytes: The byte content of the image to edit.
            prompt: The text prompt describing the desired edit.
            model_name: The specific model version to use.

        Returns:
            The byte content of the edited image.
        """
        ...

    @abstractmethod
    def score_image(self, prompt: str, original_image_url: str, candidate_image_url: str, model_name: str) -> str:
        """
        Uses a VLM to analyze two images and return a structured JSON string with a score.

        Args:
            prompt: The detailed prompt instructing the model how to score.
            original_image_url: The URL of the original image.
            candidate_image_url: The URL of the modified image to be scored.
            model_name: The specific VLM to use (e.g., "gpt-4o").

        Returns:
            A string containing a JSON object with the scoring results.
        """
