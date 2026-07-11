from typing import Dict, Any, Optional
from .base import ImageIntervention, ImageModel
import logging

logger = logging.getLogger(__name__)

class StylizeImpressionismIntervention(ImageIntervention):
    """
    Implements the Impressionism stylization intervention.
    """
    intervention_name = "stylize_impressionism"

    def _get_style_prompts(self, filter_description: str, sensitivity: Optional[int] = None) -> Dict[str, str]:
        """
        Build style prompts that (a) mitigate user-specific triggers, (b) preserve factual integrity,
        and (c) keep outputs coherent. `sensitivity` is 1–5 (higher => stronger mitigation).
        """
        # Clamp sensitivity and prepare text fragment
        if sensitivity is not None:
            sensitivity = max(1, min(5, int(sensitivity)))
            sens_line = f"- Sensitivity: {sensitivity}/5 (higher => stronger intervention)\n"
            # Intensity phrases for SPECIAL FOCUS lines
            soft = "gently" if sensitivity <= 2 else ("clearly" if sensitivity == 3 else "strongly")
            hard = "visibly" if sensitivity <= 3 else "aggressively"
        else:
            sens_line = ""
            soft, hard = "clearly", "visibly"

        base = (
            "You are an expert AI image editor specializing in therapeutic content transformation."
            "Your role is to balance artistic integrity with the user's emotional safety.\n\n"
            "CONTEXT:\n"
            f"- User trigger: '{filter_description}'.\n"
            f"{sens_line}"
            "GOAL:\n"
            "- Reinterpret the image in the requested style to reduce the trigger’s salience while preserving the scene’s meaning and composition.\n\n"
            "- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object."
            "EVALUATION GUARDRAILS (must satisfy all):\n"
            "- Coherence: output remains readable and logically consistent.\n"
            "- Factual integrity: preserve real objects, layout, and relationships; add no new elements; do not hallucinate text or objects.\n"
            "- Emotional impact: minimize residual visibility of the trigger for this user; when uncertain, prefer over-mitigation.\n\n"
            "GENERAL INSTRUCTIONS:\n"
            "- Apply the style to the entire image for cohesion.\n"
            "- SPECIAL FOCUS: handle elements matching the trigger as specified below for the chosen style.\n"
            "- FINAL OUTPUT: Generate only the transformed image file. Do not include any text, captions, or commentary.\n"
        )

        impressionism = (
            "STYLE: Impressionism\n"
            "STYLE REQUIREMENTS:\n"
            "- Use visible, broken brushstrokes and emphasis on light/atmosphere over edge fidelity.\n"
            "- Employ vibrant, naturalistic colors placed side-by-side; avoid hard outlines.\n"
            "- Preserve original composition and subject placement.\n\n"
            f"SPECIAL FOCUS:\n"
            f"- Areas containing '{filter_description}' should be rendered with the softest edges and most dissolved detail, {soft} blending into surrounding light/color to reduce recognizability.\n"
        )

        return {
            "impressionism": f"{base}\n{impressionism}",
        }

    def apply(self, image_bytes: bytes, filters: Dict[str, Any], model: ImageModel) -> bytes:
        """
        Applies a randomly selected stylization intervention.

        Args:
            image_bytes: The byte content of the image to process.
            filters: A dictionary containing the user's filter description.
            model: The AI model instance to use for editing.

        Returns:
            The byte content of the stylized image.
        """

        filter_description = filters.get('filter_text')
        sensitivity = filters.get('sensitivity')
        # Define the available styles and their prompts
        style_prompts = self._get_style_prompts(filter_description, int(sensitivity))
        available_styles = list(style_prompts.keys())

        # Randomly select a style for this application to ensure diversity
        chosen_style = "impressionism"
        
        # Get the detailed, high-quality prompt for the chosen style
        prompt = style_prompts[chosen_style]

        print(f"Applying stylization: chosen style is '{chosen_style}'")
        
        return model.edit_image(image_bytes, prompt)