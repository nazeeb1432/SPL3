# response_models.py
from pydantic import BaseModel, Field
from typing import Literal, List

class TextInterventionScores(BaseModel):
    """
    A structured evaluation of a single content moderation intervention.
    All scores are on a scale of 1 (worst) to 5 (best).
    """
    intervention_type: Literal["Modify Segments", "Add Warning", "Rewrite"] = Field(
        ..., description="The type of intervention being scored."
    )
    overall_coherence: int = Field(
        ..., ge=1, le=5, description="Score for how logical and readable the final content is. Lower scores for jarring or confusing results."
    )
    content_fidelity: int = Field(
        ..., ge=1, le=5, description="Score for how well the intervention preserves the original, non-sensitive meaning of the content. A full rewrite might have lower fidelity than a small modification."
    )
    predicted_emotional_impact: int = Field(
        ..., ge=1, le=5, description="A safety score. How well does this protect the user from negative emotional impact? A higher score means better protection and a more positive (or neutral) final experience."
    )

class TextInterventionEvaluation(BaseModel):
    """
    The complete evaluation output, containing scores for all interventions
    and the final rationale for the top choice.
    """
    scores: List[TextInterventionScores] = Field(
        ..., description="A list containing the detailed scores for each of the three intervention types."
    )
    rationale: str = Field(
        ..., description="A brief, holistic rationale explaining which intervention offers the best trade-off for this specific user and content, and why."
    )