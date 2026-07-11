from abc import ABC, abstractmethod
from typing import List, Dict, Any
from ml_models.base import ImageModel

class ImageIntervention(ABC):
    """
    Abstract base class for an image intervention.
    It defines the common interface that all concrete intervention implementations must follow.
    """
    intervention_name = "base_intervention"

    @abstractmethod
    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel, model_name: str = None) -> bytes:
        """
        Applies the intervention to an image.

        Args:
            image_bytes: The byte content of the image to process.
            filters: A list of filter strings or descriptions relevant to the intervention.
            model: An instance of an ImageModel to be used for AI operations.
            model_name: The specific model/version to use for the operation.

        Returns:
            The byte content of the processed image.
        """
        ...
