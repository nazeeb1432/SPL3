
from typing import List, Dict, Any
from .base import ImageIntervention, ImageModel

class ReplacementIntervention(ImageIntervention):
    """
    Implements the object replacement intervention.
    It replaces a specified object in an image with a simple cartoon.
    """
    intervention_name = "replacement"

    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel) -> bytes:
        """
        Applies the replacement intervention.

        Args:
            image_bytes: The byte content of the image to process.
            filters: A list of descriptions of objects to be replaced.
            model: The AI model instance to use for editing.
        Returns:
            The byte content of the edited image.
        """
        if not filters:
            raise ValueError("Replacement intervention requires at least one filter description.")

        # For this intervention, we use the first filter as the target for replacement.
        # print(f"Applying replacement intervention with filters: {filters}. Type: {type(filters)}"   ) 
        filter_description = filters.get('filter_text')
        filter_metadata = filters.get('filter_metadata', {})
        filter_intensity = filters.get('intensity', 1.0)
        replacement_object = filter_metadata.get("replacement_object", "a simple cartoon cookie")


        # prompt = (
        #     f"Visually replace a detailed depiction of {filter_description} "
        #     f"with a simple version of {replacement_object}."
        #     f"The replacement should be seamless and context-aware. "
        #     f"Preserve the original background, lighting, and composition of the image as much as possible, "
        #     f"substituting only the specified trigger object(s)."
        # )        



        filter_description = filters.get('filter_text')
        filter_metadata = filters.get('filter_metadata', {})
        user_sensitivity = filters.get('intensity', 1.0)

        # --- NEW: Flags to control the prompt's behavior ---
        # Flag 1: Let the AI choose a diverse, benign replacement
        let_ai_choose_replacement = filter_metadata.get("let_ai_choose_replacement", True)
        # Flag 2: Let the AI use additional user context for a more personalized edit
        use_full_user_context = filter_metadata.get("use_full_user_context", False)

        # --- Logic for the replacement object instruction ---
        if let_ai_choose_replacement:
            # GOAL: Diversity and Safety. Avoid contextual similarity to the trigger.
            # We explicitly tell the model to pick something from a safe, diverse list.
            replacement_instruction = (
                "a simple, visually pleasing, and benign object like a cartoon star, a friendly-looking cloud, a small potted plant, or a deck of cards. Or anything else that is visually suitable here and non-threatening. "
                "Your choice should be random and diverse to avoid repetition. "
                f"CRITICAL: DO NOT choose an object that is thematically similar to the things being replaced. "
            )
        else:
            # If the flag is false, use the user-defined or default object
            replacement_instruction = f"'{replacement_object}'"


        # --- Assembling the Final Prompt ---
        prompt = (
            f"Role: You are an expert AI photo editor specializing in seamless object replacement."
            f"Your task is to modify an image to remove a distressing object for a user and replace it with a benign substitute.\n"
            f"---------------------------"
            f"Task: Visually replace a detailed depiction of {filter_description} "
            f"with {replacement_instruction}."
            f"The replacement should be seamless and context-aware. "
            f"Preserve the original background, lighting, and composition of the image as much as possible, "
            f"substituting only the specified trigger object(s)."
        )

        return model.edit_image(image_bytes, prompt)
