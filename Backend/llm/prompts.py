"""LLM prompts for filter creation and management"""

FILTER_CREATION_PROMPT = """Convert the given text into a structured filter configuration.
Output only valid JSON matching this structure:
{
    "filter_text": str,  // The text/concept to filter
    "filter_type": str,  // topic|concept|entity|category|emotion|complex
    "content_type": str,  // text|image|all
    "intensity": int,    // 1-5
    "filter_metadata": {
        "context": str,
        "related_terms": list[str],
        "category_specific": dict
    },
    "is_temporary": bool,
    "duration": str      // null|"1 day"|"1 week"|"1 month"
}"""

FILTER_EVALUATION_PROMPT = """Analyze if content matches any of the given filters.
Consider contextual meaning, implications, and related concepts.
Return matched filter indices and confidence scores in a JSON object. Follow the format exactly as shown below.

Example:
Content: "The administration's new economic policy has led to protests"
Filters: [
    {"filter_text": "politics", "filter_metadata": {"context": "political news"}},
    {"filter_text": "economic policy", "filter_metadata": {"context": "finance"}},
    {"filter_text": "protests", "filter_metadata": {"context": "civil unrest"}}
]

For this example, should match all three filters with different confidence. 
The content is a Strong political content (Filter 0),
The content also has direct mention of economic policy (Filter 1),
Finally, Protests mentioned but not detailed (Filter 2).
So, the JSON output will be:
{
    "matched_filter_ids": [0, 1, 2],
    "confidence_scores": {
        "0": 0.85,  
        "1": 0.90,  
        "2": 0.70,
    }
}
"""

LOW_INTENSITY_PROMPT = """
You are given two things: 
1) a content that may contain [TITLE] and [BODY] sections,
2) a list of filters with their corresponding sensitive topics.

Your Job: identify specific words or phrases that match the given filters.
Note that the matching should be based on the context and meaning, not just exact text matches.
Dont be too naive, but also dont be too aggressive.
Return a list of text segments that should be modified, one per line.
Do not add any markers or formatting - just return the raw text segments.
These segments later will be used to add markers around them so that they can be modified in the UI.
Preserve all [TITLE] and [BODY] tags exactly as they appear."""

MEDIUM_INTENSITY_PROMPT = """
You are given two things: 
1) a content that may contain [TITLE] and [BODY] sections,
2) a list of filters with their corresponding sensitive topics.

Your Job: Create a brief warning message (under 100 characters) about this sensitive content. We need to use as neutral a language as possible. something like "based on your preferences, we think you would rather not see this content"
Return only the warning message without any formatting or markers.

Must follow these guidelines:
Preserve all [TITLE] and [BODY] tags and their ending [/TITLE] and [/BODY] exactly as they appear.
Try to make sure that the lenght of the warning is not more than the title ( title is the text content within [Title] and [/Title] tags.)
Try to give a personalized tone, because the warning is crafted for this particular user.
Also, in the warning message, DO NOT specifically mention the filter topics, because thats the thing they want to filter/avoid.
"""

HIGH_INTENSITY_PROMPT = """For the given content that may contain [TITLE] and [BODY] sections,
rewrite the content to remove or neutralize sensitive topics only related to the filters shared below. 
But, preserving the general meaning.
Return only the rewritten text without any formatting or markers.
Preserve all [TITLE] and [BODY] tags and their ending [/TITLE] and [/BODY] exactly as they appear. 
Only rewrite their corresponding content."""



AGGRESSIVE_MODE_PROMPT = """For the given content that may contain [TITLE] and [BODY] sections,
aggressively rewrite the content to fully remove or neutralize all sensitive topics.
Consider all filters together for a comprehensive rewrite.
Return only the rewritten text without any formatting or markers.
Preserve all [TITLE] and [BODY] tags exactly as they appear.
Keep sections between [TITLE] and [BODY] tags intact and only rewrite their content."""

CONVERSATION_COMPLETE = {
    "text": "Your filter has been saved. Would you like to add another?",
    "type": "complete",
    "options": ["Add another filter", "I'm done"]
}



SELECTOR_SYSTEM_PROMPT = """
You are an expert content moderation assistant evaluating intervention strategies. Each intervention type has distinct strengths - your task is to identify which best serves this specific user and content combination.
"""

SELECTOR_USER_PROMPT_TEMPLATE = """
--- CONTEXT ---
**Original Content:**
{text}

**User's Active Filters:**
{filter_descriptions}
**User Sensitivity Level:** {highest_intensity}/5

--- CONTENT ANALYSIS ---
Before evaluating, consider:
- How thoroughly is the sensitive content woven through the text?
- What type of content is this (news, social post, educational)?
- Would partial exposure still cause distress?
- Is the sensitive content essential to the message?

--- INTERVENTION OPTIONS ---

1. **Modify Segments**: Obscures specific triggering words/phrases with CSS blur
   - BEST FOR: Isolated triggers in otherwise valuable content
   - LIMITATION: Context and structure remain visible

2. **Add Warning**: Replaces content with informative warning about what's avoided
   - BEST FOR: Content thoroughly infused with triggers where partial exposure is harmful
   - STRENGTH: 100% reliable protection with user agency
   
3. **Rewrite**: AI rewrites to neutralize triggers while preserving meaning
   - BEST FOR: Content with extractable value beyond triggers
   - LIMITATION: May introduce errors or miss complex triggers

--- EVALUATION AXES (Score 1-5) ---

1. **Overall Coherence**: How logical and readable is the result?
   - Note: Warning messages are coherent by design (clear communication)
   - Blur may create reading flow issues
   - Rewrite quality varies with content complexity

2. **Content Fidelity**: How much useful information is preserved?
   - Consider: For highly sensitive users, NO information may be better than triggering information
   - Warning preserves user agency to choose exposure
   - Partial preservation (blur/rewrite) vs. complete protection trade-off

3. **Predicted Emotional Impact**: Higher score = better protection
   - Sensitivity {highest_intensity}/5
   - Complete removal (warning) eliminates risk
   - Partial interventions may leave residual distress
   - Consider cumulative effect of repeated partial exposures

--- SCORING GUIDANCE ---
**Reframe your thinking:**
- "Add Warning" with high emotional impact score often indicates SUCCESS, not failure
- Low fidelity can be appropriate when safety matters more
- The "best" intervention varies by situation

For sensitivity {highest_intensity}/5:
- If triggers throughout: Warning likely scores highest overall
- If triggers isolated: Modify Segments may suffice  
- If content valuable + triggers extractable: Rewrite may excel

--- INSTRUCTIONS ---
Provide your response as a JSON object conforming to the JSON schema provided:
1. Score each intervention thoughtfully based on this specific content and context
2. Write a concise `rationale` explaining which intervention best balances the trade-offs for THIS particular case
3. Remember that the "best" solution varies - sometimes modification is elegant, sometimes warning is necessary, sometimes rewriting is optimal
4. Remember: High emotional impact scores for warnings indicate they're doing their job - protecting users.
"""




RESPONSE_JSON_SCHEMA = """
Follow this JSON schema exactly when you respond:

{
  "scores": [
    {
      "intervention_type": "Modify Segments",
      "overall_coherence": <1-5>,
      "content_fidelity": <1-5>,
      "predicted_emotional_impact": <1-5>
    },
    {
      "intervention_type": "Add Warning",
      "overall_coherence": <1-5>,
      "content_fidelity": <1-5>,
      "predicted_emotional_impact": <1-5>
    },
    {
      "intervention_type": "Rewrite",
      "overall_coherence": <1-5>,
      "content_fidelity": <1-5>,
      "predicted_emotional_impact": <1-5>
    }
  ],
  "rationale": "<Explain which intervention best serves THIS user's needs and why>"
}

"""


# in prompts.py

IMAGE_SCORER_SYSTEM_PROMPT = """
You are an expert, empathetic, and highly analytical content moderation assistant. Your task is to act as a reward model, providing a detailed, structured evaluation score for a single proposed content intervention. Your analysis must be grounded in the provided context and evaluation axes.
"""

IMAGE_SCORER_USER_PROMPT_TEMPLATE = """
--- CONTEXT ---
**User's Active Filter:** '{filter_description}'
**User's Stated Sensitivity:** {user_sensitivity}/10
**Original Post Text (if any):** {post_text}

--- TASK ---
You are provided with an **Original Image** for context and a single **Transformed Image** which represents a candidate intervention. Your task is to score the Transformed Image based on how well it meets the user's needs.

Please evaluate the **Transformed Image** and provide your response as a single, valid JSON object that strictly follows the specified format.

--- EVALUATION AXES ---
1.  **Overall Coherence (Score 1-10):** How natural and believable is the transformed image? A low score indicates a confusing, artifact-ridden, or visually disruptive result. A high score indicates a seamless and well-executed image.
2.  **Content Fidelity (Score 1-10):** How well does the transformation preserve the essential, non-triggering elements and composition of the original image? A low score means significant, unnecessary information has been lost or altered. A high score indicates that only the triggering element was affected.
3.  **Predicted Emotional Impact (Score 1-10):** Based on the user's filter and sensitivity, how effective is this transformation at reducing potential distress? A higher score means a more positive or neutral emotional impact for this specific user.

--- FINAL SCORE ---
Provide a final **overall_score** (float from 1.0 to 10.0) that synthesizes these three axes into a single judgment of the intervention's success for this user. Also provide a brief **reasoning** for your scores.

**Your response MUST be a valid JSON object in the following format:**
{{
  "coherence_score": <float>,
  "fidelity_score": <float>,
  "impact_score": <float>,
  "overall_score": <float>,
  "reasoning": "<brief explanation for the overall_score>"
}}
"""



DETECTION_PROMPT = """
        You are a precise vision-based object detection assistant. Your task is to analyze the provided image and identify all instances of {filter_text} or similar things.
        Note that the filter_text is a high-level description, and you should look for all relevant instances in the image.
        We will use this to filter out discomforting content for the user.
        You can also find additional metadata that the user provided for the filter in {filter_metadata}.
        Your response MUST be a valid JSON object. For each detected object, provide its bounding box as a list of four integers: [x_min, y_min, x_max, y_max], representing the top-left and bottom-right corners in pixel coordinates.
        
        Return the results in this exact JSON format:
        {{
            "detected_objects": [
              {{
                "label": "{filter_text}",
                "confidence": "high",
                "bounding_box": [150, 200, 350, 400]
              }}
            ],
            "image_dimensions": {{
                "width": {image_width},
                "height": {image_height}
            }}
        }}
        
        Be very precise with the coordinates. x,y should be the top-left corner as percentage of image dimensions.
        If no objects are found, return an empty "detected_objects" array.
        """