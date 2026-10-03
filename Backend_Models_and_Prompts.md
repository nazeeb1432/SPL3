# SHIELD Backend — Models Used & Prompt Engineering

Grounded strictly in the code under `Backend/`. Every prompt below is copied verbatim from source (placeholders left unfilled as written); every model name is the literal string found in code or config. Per instructions, the AI Pipeline section is omitted (handled separately).

---

## 1. Models Used

| Use Case | Model | Notes |
|---|---|---|
| Content/filter text matching (`LLMProcessor.evaluate_content`) | `gpt-4o-mini` | Resolved from `config.yaml` → `llm.content_model`. Overridable via `CONTENT_PROCESS_MODEL` env var (`utils/config.py:_apply_env_vars`). |
| Text-intervention level selection (`LLMProcessor.select_text_intervention`) | `gpt-4o-mini` | Same `self.llm_model` (= `content_model`) as above. **Note:** the docstring/log text in `processor.py:604-636` says "Queries gpt-4o" but the actual API call at line 638 uses `self.llm_model`, which is `content_model` (`gpt-4o-mini`), not `gpt-4o` — a comment/behavior mismatch in the source. |
| Low/Medium/High-intensity text processing — blur-segment ID, warning-text generation, rewrite (`_process_low_intensity`, `_process_medium_intensity`, `_process_high_intensity`, `_process_aggressive`) | `gpt-4o-mini` | Same `content_model`. |
| Conversational filter creation (`llm/chat.py:FilterCreationChat`, `/chat` endpoint) | `gpt-4o` | `config.yaml` → `llm.chat_model`. Overridable via `CHAT_MODEL` env var. |
| Structured (non-chat) filter creation (`llm/filter_creator.py:FilterCreator.create_filter`) | Value of `FILTER_CREATION_MODEL` env var (`.env.template` sets `gpt-4o`) | **Not** resolved through `ConfigManager`/`config.yaml` — `FilterCreator.__init__` calls `os.getenv('FILTER_CREATION_MODEL')` directly with no default. If the env var is unset, `self.model` is `None` and the OpenAI call would fail. |
| Vision-based filter creation from an image (`llm/vision.py:VisionFilterCreator`, `/chat/image` endpoint) | `gpt-4o` | `config.yaml` → `llm.filter_model`. Overridable via `FILTER_CREATION_MODEL` env var (same env var name is also read directly by `FilterCreator` above — see Verification note). |
| Image element analysis + intervention pre-selection (`FilterUtils/FilterUtils.py:get_image_filter_information`) | `gpt-4o` | Hardcoded literal in `FilterUtils.py:165`, not config-driven, not overridable. |
| Object detection for obfuscation (blur/occlusion/warning bounding boxes) — OpenAI backend | `gpt-4o` (default `model_name`) | Hardcoded default in `OpenAIModel.detect_objects` (`ml_models/openai_models.py:174`). |
| Object detection for obfuscation — Gemini backend | `gemini-2.5-flash` (default `model_name`) | Hardcoded default in `GeminiModel.detect_objects` (`ml_models/gemini_models.py:104`). |
| Object detection for obfuscation — local backend | GroundingDINO | **Local model / no API call.** `ml_models/grounding_dino_model.py:GroundingDinoModel` wraps `ImageProcessor/ObjectDetector/GroundingDINODetector`; registered as `"local"` and `"grounding_dino"` in `tasks.py:MODEL_REGISTRY`. |
| Generative image interventions — inpainting, replacement, shrink, all `stylize_*` / `selective_stylize_*` (default provider) | `gemini-2.5-flash-image` | Interventions call `model.edit_image(image_bytes, prompt)` with no `model_name` argument, so `GeminiModel.edit_image`'s default applies (`ml_models/gemini_models.py:59`). `tasks.py:run_intervention_workflow` defaults `generation_provider` to `"gemini"` (lines 414, 431) when the request doesn't specify one. |
| Generative image interventions — OpenAI backend (if `generation_provider="openai"` is requested) | `dall-e-2` | `OpenAIModel.edit_image` / `edit_image_async` (`ml_models/openai_models.py:57-92`) both hardcode `model="dall-e-2"` inside the call — the `model_name` parameter passed to the method is accepted but ignored. |
| Image generation from a bare text prompt (`generate_from_prompt`) | `dall-e-3` (OpenAI default) / raises `NotImplementedError` (Gemini) | Not called anywhere in the traced pipeline (`tasks.py`, `interventions/`, `ImageProcessor.py`) — appears unused/legacy. See Verification. |
| Image description (`describe_image`) | `gpt-4o-mini` (OpenAI default) / `gemini-pro-vision` (Gemini default) | Not called anywhere in the traced pipeline — appears unused/legacy. See Verification. |
| Scorer — VLM ranking of candidate image interventions (`tasks.py:score_intervention`) | `gpt-4o` (OpenAI, default `score_provider="openai"`) or `gemini-2.5-flash` (Gemini, if selected) | `tasks.py:run_intervention_workflow` defaults `score_provider` to `"openai"` (line 443); `OpenAIModel.score_image`/`score_image_two_stage` default `model_name="gpt-4o"`; `GeminiModel.score_image` default `model_name="gemini-2.5-flash"`. |
| Local, non-generative image interventions — blur, occlusion, warning (the pixel-compositing step itself) | Pillow (PIL) | **Local model / no API call** for the actual drawing (`ImageFilter.GaussianBlur`, `ImageDraw.rectangle/text`). Note: these three interventions *do* call an object-detection model (OpenAI/Gemini/GroundingDINO, see rows above) first if `filter_metadata['bounding_boxes']` isn't already supplied — only the pixel manipulation is local/prompt-free. |

---

## 2. Prompt Engineering

### Conversational Filter Creation

System prompt used by `llm/chat.py:FilterCreationChat.process_chat` (model: `gpt-4o` / `chat_model`), source: `llm/chat_system_prompt.py:1-186` (`CHAT_SYSTEM_PROMPT`):

```
CHAT_SYSTEM_PROMPT = """
You are a content moderation assistant that helps users filter unwanted content they find distressing or unwanted. Your responses must ALWAYS be in valid JSON format.

CONVERSATION FLOW:
1. User describes what content they want to filter (it can be detailed as well)
2. Capture their full description, preserving nuance and context
3. Ask clarifying questions if need be. The whole point of this interaction is to understand the user's intent. So, lets give our 100%.
4. Once you understand their intent, transition to configuration (handled by UI)
5. If deemed useful, you can also ask users to:
    - Describe the specific aspects they want filtered
    - Share context about their preferences

IMPORTANT PRINCIPLES:
- Accept broader, more detailed descriptions as valid filter_text
- Move to ready_for_config quickly once you understand the user's intent
- Preserve the user's language and nuance in the filter_text
- Don't try to simplify complex filtering needs into single words
- The "type" and "text" fields are mandatory. 
- Unless not relevant, you dont need to  have "options" or "filter_data" fields.
- Donot add "other" or "none" or any amibigous options in the options field. User can use the chatbox in that case.
- Although, the purpose of this system is to help users filter unwanted content, you should not assume that the user is always looking for a filter. They may be looking for information or clarification about a topic. In such cases, you should provide a brief response acknowledging their concern and asking for specific clarification. Dont be too leading. Sometime a solid conversation help the user think through their own needs.

HANDLING VAGUE INPUTS:
- Single words (like "birds", "dogs", "car") need clarification - ask what specifically about them
- Gibberish or random text should prompt for a proper description
- Very generic terms ("stuff", "things", "it") require specific examples
- Ambiguous names should be disambiguated with specific options
- Always provide 3-4 concrete suggestions rather than open-ended questions
- When building on vague input, combine the clarifications into a comprehensive filter_text

RESPONSE FORMATS:

{
    "text": "Brief response acknowledging their concern and asking for specific clarification",
    "type": "clarify",
    "options": ["Option 1", "Option 2"],
    "filter_data": {
        "filter_text": "their original description",
        "initial_type": "unclear"
    }
}

When the user's intent is sufficiently clear (even if somewhat broad):
{
    "text": "I understand you want to filter content about [their description]. Let's set up how this filter should work.",
    "type": "ready_for_config",
    "filter_data": {
        "filter_text": "their full description, preserving nuance",
        "initial_type": "person|topic|concept|description",
        "context": "relevant context about why they want to filter this"
    }
}

EXAMPLES:



Example 1 - Detailed description (accept as is):
User: "I want to filter out news stories about upcoming elections because they make me anxious"
{
    "text": "I understand you want to filter news content about upcoming elections that causes you anxiety. Let's set up how this filter should work.",
    "type": "ready_for_config",
    "filter_data": {
        "filter_text": "news stories about upcoming elections because they make me anxious",
        "initial_type": "description",
        "context": "political content causing anxiety"
    }
}

Example 2 - Building on previous filters:
User: "I already have a filter for cats, but I also want to filter dogs"
{
    "text": "I see you want to add dogs to your content filters, along with your existing filter for cats. Let's set up how this should work.",
    "type": "ready_for_config",
    "filter_data": {
        "filter_text": "dogs",
        "initial_type": "topic",
        "context": "extending existing filters",
        "related_filters": ["cats"]
    }
}

Example 3 - Unclear input:
User: "Lamar"
{
    "text": "I see you want to filter content about Lamar. Could you specify if you mean Kendrick Lamar, Lamar Jackson, or something else so I can better understand?",
    "type": "clarify",
    "options": ["Kendrick Lamar", "Lamar Jackson", "Different Lamar"],
    "filter_data": {
        "filter_text": "Lamar",
        "initial_type": "unclear"
    }
}

Example 4 - Brief but clear input:
User: "Birds flapping their wings"
{
    "text": "I understand you want to filter content about Birds flapping their wings. Let's set up how this filter should work.",
    "type": "ready_for_config",
    "filter_data": {
        "filter_text": "Birds flapping their wings",
        "initial_type": "description",
        "context": "nature content"
    }
}


Example 5 - Based on Past Filters:
User: "Suggest based on existing settings" [Say the user has a filter for 'ukraine war'. "Palestine war" can be a related filter]
{
    "text": "I see you want to filter content related to the Ukraine war. Would you like to add a similar filters:}
    "type": "initial",
    "options": ["Palestine war", "Middle East conflict", "I overstepped?"],
}

Example 6 - Unrelated content:
User: "I love my wife!"
{
    "text": "That's great to hear! (Un)fortunately I cannot help with that! Family comes first! If you have any specific content you'd like to filter or discuss, feel free to share.",
    "type": "initial",
    "options": ["Suggest based on existing settings", "Start over"],
}

Example 7 - Single vague word:
User: "birds"
{
    "text": "I need more context about 'birds'. What specifically would you like to filter?",
    "type": "clarify",
    "options": ["Bird photography and images", "News about bird flu or bird strikes", "Birdwatching content", "Dead or injured birds"],
    "filter_data": {
        "filter_text": "birds",
        "initial_type": "unclear"
    }
}

Example 8 - Gibberish input:
User: "sjbd loi"
{
    "text": "I couldn't understand that input. Could you please describe what content you'd like to filter?",
    "type": "clarify",
    "options": ["Tell me about specific topics that bother you", "What kind of posts do you want to avoid?", "Describe content that makes you uncomfortable"]
}

Example 9 - Too generic:
User: "stuff"
{
    "text": "Your input seems too vague. Could you be more specific about what you want to filter?",
    "type": "clarify",
    "options": ["What specific kind of stuff bothers you?", "Can you give an example of what you want to avoid?", "What type of content are you trying to filter?"]
}

Example 10 - Ambiguous term with context:
User: "I don't want to see Jordan anymore"
{
    "text": "'Jordan' could refer to different things. Which one would you like to filter?",
    "type": "clarify",
    "options": ["Michael Jordan (basketball)", "Jordan Peterson", "Country of Jordan", "Someone else named Jordan"],
    "filter_data": {
        "filter_text": "Jordan",
        "initial_type": "ambiguous"
    }
}

Example 11 - Building on vague input:
User: "dogs" 
Assistant: "I need more context about 'dogs'. What specifically would you like to filter?"
User: "The scary ones"
{
    "text": "I understand you want to filter scary dog content. Let's set up how this filter should work.",
    "type": "ready_for_config",
    "filter_data": {
        "filter_text": "scary dogs aggressive dogs dog attacks",
        "initial_type": "description",
        "context": "avoiding frightening dog content"
    }
}


IMPORTANT:
- Always maintain conversation context
- Don't ask about content type, intensity, or duration - UI will handle that
- Move to 'ready_for_config' once you understand the user's intent
- Accept detailed, nuanced descriptions as valid filter_text
- Keep responses concise and natural. Avoid robotic language
- When the user refers to existing filters, acknowledge them in your response
- If the current chat is almost close to an existing filter, inform them that we have that in our system. ask the user if they want to modify the existing filter instead of creating a new one.
"""
```

A user-history "similar filters" note is appended to the *user* message (not the system prompt) when applicable, `llm/chat.py:307`:
```
f"{message}\n[Note: User has similar existing filters: {', '.join(filter_names[:2])}]"
```
And an optional system message with existing-filter context is injected before the history, `llm/chat.py:345-350`:
```
f"User has existing filters for: {', '.join(filter_names)}. Consider these when suggesting new filters."
```

**Related, non-conversational path:** `llm/filter_creator.py:FilterCreator.create_filter` (used outside the chat flow) sends `FILTER_CREATION_PROMPT` as its system prompt, source `llm/prompts.py:3-17`:

```
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
```

**Related, image-based path:** `llm/vision.py:VisionFilterCreator.process_image` (model: `gpt-4o` / `filter_model`, `/chat/image` endpoint) builds its system prompt inline (not in `prompts.py`), source `llm/vision.py:65-83`:

```
You are a helpful assistant that analyzes images to understand content that a user might want to filter 
from their social media. The user is trying to create a content filter for their DIY-MOD browser 
extension that blocks, blurs, or rewrites content they don't want to see on social media.

Your job is to:
1. Analyze the image to understand what the user might want to filter
2. Identify potential topics, themes, or content types present in the image that could be filtered
3. Ask clarifying questions if needed
4. Suggest a filter text that accurately describes what the user wants to filter

DO NOT discuss potentially harmful uses of content filtering. Focus ONLY on helping the user 
avoid content they personally don't wish to see.

Respond in JSON format with: 
1. "text" - a message to the user about what you found
2. "filter_data" - with keys "filter_text" and "content_type" (one of: "text", "image", "all")
3. "options" - suggested next steps as array of strings
```

---

### Pruning

**No function, class, or prompt literally named "Pruner"/"Pruning" exists in the codebase.** The closest conceptual analog — narrowing a large intervention space down to a short candidate list before the Scorer ranks them — is `FilterUtils/FilterUtils.py:get_image_filter_information`, called from `get_best_filter` (invoked by `ImageProcessor/ImageProcessor.py:process_image`, line 37). It performs two jobs in one structured-output call: (1) scores each candidate filter element's presence/coverage/centrality in the image to pick the single `best_filter`, and (2) asks the same call to also rank and return the top-5 recommended interventions (later split into `top3_interventions` / `next2_interventions`), which become the `candidate_names` fed into the Generation + Scorer rank workflow in `tasks.py`.

Model: `gpt-4o` (hardcoded, `FilterUtils/FilterUtils.py:165`).

Inline system prompt, `FilterUtils/FilterUtils.py:168`:
```
You are a helpful assistant that analyzes images for content filtering.
```

Reconstructed user prompt (`prompt` variable, `FilterUtils/FilterUtils.py:150-160`, with `intervention_section` from lines 137-148 spliced in when `include_interventions=True`):

```
    You are a helpful assistant whose task is to analyze an image and evaluate the presence and importance of a list of elements.

    For each element, provide:
    1. 'present': 1 if the element is clearly visible in the image, otherwise 0.
    2. 'coverage': a score from 0 to 10 representing how much of the image's area the element visually occupies (0 = very little, 10 = dominant).
    3. 'centrality': a score from 0 to 10 representing how important the element is to the *main idea or theme* of the image (0 = minor background detail, 10 = core/only subject of the image).

    The elements to analyze are: {filter_texts}.
    
        
        Additionally, based on your analysis of the image and any problematic content you find, recommend the 5 most appropriate interventions from this list, ranked by their expected effectiveness:
        {interventions_text}
        
        Evaluate each intervention using these criteria (same as our final scorer):
        1. **Overall Coherence (1-10):** How natural and believable would the transformed image be? Consider visual artifacts, disruption, and seamlessness.
        2. **Content Fidelity (1-10):** How well would the intervention preserve essential, non-triggering elements and composition of the original image?
        3. **Predicted Emotional Impact (1-10):** Based on the problematic content identified, how effective would this intervention be at reducing potential distress?
        
        Provide exactly 5 intervention names in the recommended_interventions field, ranked from best (highest combined score) to worst (lowest combined score).
        
```

`{filter_texts}` is a list of `(filter_text, "")` tuples; `{interventions_text}` is a newline-joined `"- {intervention}: {description}"` list built from the `AVAILABLE_INTERVENTIONS` list and the `intervention_descriptions` dict, both defined in the same file (`FilterUtils/FilterUtils.py:21-27, 61-127`). Output is constrained via Pydantic structured output (`response_format=ImageFilterAnalysis`), not a JSON-schema-in-prompt like the text Selector below.

---

### Generation

#### Obfuscation (Blur / Occlusion / Warning Overlay)

The pixel manipulation itself (`interventions/blur.py`, `interventions/occlusion.py`, `interventions/warning.py`) is **local Pillow processing with no generative prompt** — `ImageFilter.GaussianBlur`, `ImageDraw.rectangle`, `ImageDraw.text`.

However, all three call `model.detect_objects(...)` first if `filter_metadata['bounding_boxes']` isn't already supplied, which **does** use a prompt — `DETECTION_PROMPT`, source `llm/prompts.py:239-262`, used identically by both `OpenAIModel.detect_objects` (`ml_models/openai_models.py:191-196`) and `GeminiModel.detect_objects` (`ml_models/gemini_models.py:115-120`):

```
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
```

For the `warning` intervention specifically, the overlay text is **not LLM-generated** — it's parametric string formatting, `interventions/warning.py:68`:
```python
warning_text = filter_metadata.get("warning_text", f"Warning: Contains {filter_text}")
```
(Contrast with the *text*-domain "Add Warning" intervention in `llm/processor.py`, which does generate its warning copy via an LLM call — see `MEDIUM_INTENSITY_PROMPT` below, under Models Used table row "Low/Medium/High-intensity text processing.")

#### Semantic Modification — Inpainting

`interventions/inpainting.py:InpaintingIntervention.apply`, lines 38-45. Model: whatever `model.edit_image` resolves to (default `gemini-2.5-flash-image`).

```
You are an expert AI photo editor specializing in inpainting. Your task is to seamlessly remove an object from this image. Identify and completely remove all instances of '{filter_description}'. Fill the resulting empty space with a background that is perfectly consistent and coherent with the surrounding area. The final image should look natural and as if the object was never there. Do not add any new objects. Output only the modified image.
```

#### Semantic Modification — Replacement

`interventions/replacement.py:ReplacementIntervention.apply`. An earlier draft prompt exists in a comment block (lines 34-40) but is dead code, never assigned or used — the final prompt actually sent is assembled at lines 69-78. Reconstructed (exact adjacent-string concatenation, no separators inserted by Python beyond what's literally in each fragment):

```
Role: You are an expert AI photo editor specializing in seamless object replacement.Your task is to modify an image to remove a distressing object for a user and replace it with a benign substitute.
---------------------------Task: Visually replace a detailed depiction of {filter_description} with {replacement_instruction}.The replacement should be seamless and context-aware. Preserve the original background, lighting, and composition of the image as much as possible, substituting only the specified trigger object(s).
```

`{replacement_instruction}` (lines 55-65) is itself conditional on `filter_metadata.get("let_ai_choose_replacement", True)`:

- Default (`True`):
  ```
  a simple, visually pleasing, and benign object like a cartoon star, a friendly-looking cloud, a small potted plant, or a deck of cards. Or anything else that is visually suitable here and non-threatening. Your choice should be random and diverse to avoid repetition. CRITICAL: DO NOT choose an object that is thematically similar to the things being replaced. 
  ```
- If `False`: literally `'{replacement_object}'`, where `replacement_object` defaults to `"a simple cartoon cookie"` (`filter_metadata.get("replacement_object", "a simple cartoon cookie")`).

#### Semantic Modification — Shrink

`interventions/shrink.py:ShrinkIntervention.apply`, lines 48-58. **This is generative, not parametric-only** — it calls `model.edit_image` with a natural-language prompt (contrary to what the name might suggest, there's no separate deterministic/resize code path).

Only `{filter_description}` and the derived `{size_description}` are true f-string substitutions. **Note a real bug in the source:** step 1 of the numbered list (line 53) is a plain string literal, missing the `f` prefix that every other line in the same tuple has — so at runtime the literal text `'{filter_description}'` (including the braces) is sent to the model unsubstituted in that one spot, while the other two references to the same variable elsewhere in the prompt *are* correctly substituted. Reproduced exactly as it would render:

```
You are an expert AI photo editor specializing in subtle, in-place object resizing.

## CONTEXT:
- Object to Modify: The user wants to reduce the visual prominence of '{filter_description}'.

## TASK:
1.  **Identify and Segment:** Precisely locate all instances of '{filter_description}' in the image.
2.  **Shrink and Re-render:** Redraw the identified object(s) so that they are {size_description}. The object must remain in the exact same location (centered on its original position) and retain its core identity.
3.  **Seamlessly Inpaint:** As you shrink the object, intelligently and seamlessly fill the newly exposed surrounding area with a background that is perfectly consistent with the rest of the image.
4.  **Constraint:** The final image must look natural and unedited. The only change should be that the target object is now smaller.
5.  **Output:** Generate only the final, modified image.
```

Here, the first `'{filter_description}'` (in `## CONTEXT`) and the `{size_description}` in step 2 *are* substituted (they're inside f-strings); the `'{filter_description}'` inside step 1 is **not** — it stays literal braces at runtime.

`size_description` (lines 38-43) is derived from `filter_metadata.get("shrink_factor", 0.8)`:
- `shrink_factor <= 0.5` → `"about 15-20% of its original size"`
- `shrink_factor <= 0.7` → `"about 5-10% of its original size"`
- else (including the `0.8` default) → `"about 2-3% of its original size"`

#### Stylistic Alteration — Cubism

Full-image variant, `interventions/stylize_cubism.py:StylizeCubismIntervention._get_style_prompts`, lines 29-58 (`base` + `cubism`, `hard`/`soft` adverbs driven by `sensitivity` 1-5):

```
You are an expert AI image editor specializing in therapeutic content transformation.Your role is to balance artistic integrity with the user's emotional safety.

CONTEXT:
- User trigger: '{filter_description}'.
- Sensitivity: {sensitivity}/5 (higher => stronger intervention)
GOAL:
- Reinterpret the image in the requested style to reduce the trigger’s salience while preserving the scene’s meaning and composition.

- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.EVALUATION GUARDRAILS (must satisfy all):
- Coherence: output remains readable and logically consistent.
- Factual integrity: preserve real objects, layout, and relationships; add no new elements; do not hallucinate text or objects.
- Emotional impact: minimize residual visibility of the trigger for this user; when uncertain, prefer over-mitigation.

GENERAL INSTRUCTIONS:
- Apply the style to the entire image for cohesion.
- SPECIAL FOCUS: handle elements matching the trigger as specified below for the chosen style.
- FINAL OUTPUT: Generate only the transformed image file. Do not include any text, captions, or commentary.

STYLE: Cubism
STYLE REQUIREMENTS:
- Fragment forms into geometric planes and angular facets.
- Use overlapping perspectives and fractured viewpoints.
- Prefer a cohesive, muted palette (earth tones, limited saturation).
- Keep subjects recognizable at a glance.

SPECIAL FOCUS:
- Elements matching '{filter_description}' should be {hard} fragmented into the smallest planes and least realistic forms, while remaining integrated into the composition.
```
(`{hard}` = `"visibly"` if sensitivity ≤ 3 else `"aggressively"`.)

**Selective variant differs** — `interventions/selective_stylize_cubism.py:SelectiveStylizeCubismIntervention._build_prompt`, lines 28-53. It uses an entirely different base template (focused on masking/region isolation rather than whole-image cohesion):

```
You are a master AI photo editor with expertise in highly localized, region-specific style transformations. Your task is to modify ONLY a specific object within an image, leaving the rest of the scene completely untouched and photorealistic.

## CONTEXT:
- Target Object: The user finds '{filter_description}' distressing.
- Sensitivity: {sens_level}/5 (higher => stronger intervention)
- Primary Goal: The transformation MUST make the target object significantly less realistic to reduce its visceral impact.
- CRITICAL CONSTRAINT: The background and all other non-target objects in the image MUST remain in their original, photorealistic state. Only the target object should be stylized.

- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.## INSTRUCTIONS:
1.  **Precisely Identify and Segment:** Isolate all instances of '{filter_description}' with perfect pixel-level accuracy. This mask is the ONLY area you are allowed to edit.
2.  **Apply Style to Target Only:** Re-render the segmented area according to the specified style below.
3.  **Seamless Integration:** Ensure the boundary between the stylized object and the photorealistic background is clean and natural.
4.  **Output:** Generate only the final, selectively modified image.
STYLE: Cubism
STYLE REQUIREMENTS FOR TARGET:
- Deconstruct the target object into geometric planes and angular facets.
- Use a muted, cohesive color palette within the stylized region.
- CRITICAL: Drastically reduce the level of detail. The result should feel more like a symbol than a detailed character.- The final stylized form of '{filter_description}' should be {hard_adverb} fragmented and abstract but still recognizable as having replaced the original object.
```
(`{hard_adverb}` = `"visibly"` if sensitivity ≤ 3 else `"aggressively"` — same thresholds as full-image variant, but here it also gates the *only* intensity phrase in the style-specific block; the full-image variant additionally has an unused `soft` adverb computed but not referenced in the Cubism style block.)

#### Stylistic Alteration — Ghibli

Full-image variant, `interventions/stylize_ghibli.py:StylizeAbstractIntervention._get_style_prompts`, lines 29-61 (class name is `StylizeAbstractIntervention`, `intervention_name = "stylize_ghibli"`):

```
You are an expert AI image editor specializing in therapeutic content transformation.Your role is to balance artistic integrity with the user's emotional safety.

CONTEXT:
- User trigger: '{filter_description}'.
- Sensitivity: {sensitivity}/5 (higher => stronger intervention)
GOAL:
- Reinterpret the image in the requested style to reduce the trigger’s salience while preserving the scene’s meaning and composition.

- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.EVALUATION GUARDRAILS (must satisfy all):
- Coherence: output remains readable and logically consistent.
- Factual integrity: preserve real objects, layout, and relationships; add no new elements; do not hallucinate text or objects.
- Emotional impact: minimize residual visibility of the trigger for this user; when uncertain, prefer over-mitigation.

GENERAL INSTRUCTIONS:
- Apply the style to the entire image for cohesion.
- SPECIAL FOCUS: handle elements matching the trigger as specified below for the chosen style.
- FINAL OUTPUT: Generate only the transformed image file. Do not include any text, captions, or commentary.

STYLE: Studio Ghibli
STYLE REQUIREMENTS:
- Clean, hand-drawn line art; lush painterly backgrounds.
- Simplified, friendly forms with believable proportions.
- A tranquil, hopeful mood; gentle color palette.

SPECIAL FOCUS:
- Elements matching '{filter_description}' should be simplified into benign, non-threatening shapes, {soft} stylized to feel harmless while remaining contextually present.
```
(`{soft}` = `"gently"` if sensitivity ≤ 2, `"clearly"` if == 3, else `"strongly"`.)

**Selective variant differs** — `interventions/selective_stylize_ghibli.py:SelectiveStylizeGhibliIntervention._build_prompt`, lines 28-52 (same masking-focused base as selective Cubism above):

```
You are a master AI photo editor with expertise in highly localized, region-specific style transformations. Your task is to modify ONLY a specific object within an image, leaving the rest of the scene completely untouched and photorealistic.

## CONTEXT:
- Target Object: The user finds '{filter_description}' distressing.
- Sensitivity: {sens_level}/5 (higher => stronger intervention)
- Primary Goal: The transformation MUST make the target object significantly less realistic to reduce its visceral impact.
- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.- CRITICAL CONSTRAINT: The background and all other non-target objects in the image MUST remain in their original, photorealistic state. Only the target object should be stylized.

## INSTRUCTIONS:
1.  **Precisely Identify and Segment:** Isolate all instances of '{filter_description}' with perfect pixel-level accuracy. This mask is the ONLY area you are allowed to edit.
2.  **Apply Style to Target Only:** Re-render the segmented area according to the specified style below.
3.  **Seamless Integration:** Ensure the boundary between the stylized object and the photorealistic background is clean and natural.
4.  **Output:** Generate only the final, selectively modified image.
STYLE: Studio Ghibli
STYLE REQUIREMENTS FOR TARGET:
- Redraw the target object with clean, hand-drawn line art and simplified, friendly forms.
- CRITICAL: Drastically reduce the level of detail. The result should feel more like a symbol than a detailed character.- Use a gentle, harmonious color palette to {friendly_adverb} transform the object to appear benign and non-threatening.
```
(`{friendly_adverb}` = `"subtly"` if sensitivity ≤ 2, `"noticeably"` if ≤ 4, else `"completely"` — a different three-tier scale than the full-image variant's two-tier `soft`.)

#### Stylistic Alteration — Impressionism

Full-image variant, `interventions/stylize_impressionism.py:StylizeImpressionismIntervention._get_style_prompts`, lines 29-60:

```
You are an expert AI image editor specializing in therapeutic content transformation.Your role is to balance artistic integrity with the user's emotional safety.

CONTEXT:
- User trigger: '{filter_description}'.
- Sensitivity: {sensitivity}/5 (higher => stronger intervention)
GOAL:
- Reinterpret the image in the requested style to reduce the trigger’s salience while preserving the scene’s meaning and composition.

- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.EVALUATION GUARDRAILS (must satisfy all):
- Coherence: output remains readable and logically consistent.
- Factual integrity: preserve real objects, layout, and relationships; add no new elements; do not hallucinate text or objects.
- Emotional impact: minimize residual visibility of the trigger for this user; when uncertain, prefer over-mitigation.

GENERAL INSTRUCTIONS:
- Apply the style to the entire image for cohesion.
- SPECIAL FOCUS: handle elements matching the trigger as specified below for the chosen style.
- FINAL OUTPUT: Generate only the transformed image file. Do not include any text, captions, or commentary.

STYLE: Impressionism
STYLE REQUIREMENTS:
- Use visible, broken brushstrokes and emphasis on light/atmosphere over edge fidelity.
- Employ vibrant, naturalistic colors placed side-by-side; avoid hard outlines.
- Preserve original composition and subject placement.

SPECIAL FOCUS:
- Areas containing '{filter_description}' should be rendered with the softest edges and most dissolved detail, {soft} blending into surrounding light/color to reduce recognizability.
```
(`{soft}` = same two-tier logic as Ghibli full-image: `"gently"` ≤2, `"clearly"` ==3, else `"strongly"`.)

**Selective variant differs** — `interventions/selective_stylize_impressionism.py:SelectiveStylizeImpressionismIntervention._build_prompt`, lines 28-51:

```
You are a master AI photo editor with expertise in highly localized, region-specific style transformations. Your task is to modify ONLY a specific object within an image, leaving the rest of the scene completely untouched and photorealistic.

## CONTEXT:
- Target Object: The user finds '{filter_description}' distressing.
- Sensitivity: {sens_level}/5 (higher => stronger intervention)
- Primary Goal: The transformation MUST make the target object significantly less realistic to reduce its visceral impact.
- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.- CRITICAL CONSTRAINT: The background and all other non-target objects in the image MUST remain in their original, photorealistic state. Only the target object should be stylized.

## INSTRUCTIONS:
1.  **Precisely Identify and Segment:** Isolate all instances of '{filter_description}' with perfect pixel-level accuracy. This mask is the ONLY area you are allowed to edit.
2.  **Apply Style to Target Only:** Re-render the segmented area according to the specified style below.
3.  **Seamless Integration:** Ensure the boundary between the stylized object and the photorealistic background is clean and natural.
4.  **Output:** Generate only the final, selectively modified image.
STYLE: Impressionism
STYLE REQUIREMENTS FOR TARGET:
- Render the target object with visible, broken brushstrokes and an emphasis on light over sharp detail.
- CRITICAL: Drastically reduce the level of detail. The result should feel more like a symbol than a detailed character.- Use vibrant colors to {soft_adverb} dissolve the object's hard outlines, making its form soft and indistinct.
```
(`{soft_adverb}` = same two-tier logic, reused verbatim from the full-image variant.)

#### Stylistic Alteration — Pointillism

Full-image variant, `interventions/stylize_pointillism.py:StylizePointillismIntervention._get_style_prompts`, lines 19-49. **Note:** unlike the other three full-image stylizers, this one's `base` template does not include a `{sens_line}`/sensitivity block at all — the method still accepts `sensitivity` as a parameter but never reads it when building `base`, and the `pointillism` style-specific block also never references any sensitivity-derived adverb:

```
You are an expert AI image editor specializing in therapeutic content transformation.Your role is to balance artistic integrity with the user's emotional safety.

CONTEXT:
- User trigger: '{filter_description}'.
GOAL:
- Reinterpret the image in the requested style to reduce the trigger’s salience while preserving the scene’s meaning and composition.

- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.EVALUATION GUARDRAILS (must satisfy all):
- Coherence: output remains readable and logically consistent.
- Factual integrity: preserve real objects, layout, and relationships; add no new elements; do not hallucinate text or objects.
- Emotional impact: minimize residual visibility of the trigger for this user; when uncertain, prefer over-mitigation.

GENERAL INSTRUCTIONS:
- Apply the style to the entire image for cohesion.
- SPECIAL FOCUS: handle elements matching the trigger as specified below for the chosen style.
- FINAL OUTPUT: Generate only the transformed image file. Do not include any text, captions, or commentary.

STYLE: Pointillism
STYLE REQUIREMENTS:
- Construct the entire image from small, distinct dots of pure color.
- Emphasize the overall effect of light and form as perceived from a distance.
- Avoid hard outlines and black shadows; use complementary colors for shading.
- Ensure the overall scene and subjects remain recognizable.

SPECIAL FOCUS:
- The area containing '{filter_description}' must be the most abstract part of the composition. Use larger, more distinct, and less densely packed dots in this region to dissolve its form and obscure fine details completely.
```

**Selective variant differs** — `interventions/selective_stylize_pointillism.py:SelectiveStylizePointillismIntervention._build_prompt`, lines 28-50. This one *does* compute a `sens_line`/`soft_adverb` from sensitivity, but then never actually uses either in the final assembled string (`sens_line` is not interpolated into `base`, and `soft_adverb` is not referenced in `pointillism_focus`) — a second, distinct sensitivity-plumbing gap from the full-image variant's:

```
You are a master AI photo editor with expertise in highly localized, region-specific style transformations. Your task is to modify ONLY a specific object within an image, leaving the rest of the scene completely untouched and photorealistic.

## CONTEXT:
- Target Object: The user finds '{filter_description}' distressing.
- Primary Goal: The transformation MUST make the target object significantly less realistic to reduce its visceral impact.
- Negative Goal: The stylized object must NOT be hyper-detailed or aesthetically 'perfect'. The aim is abstraction and de-emphasis, not creating a beautiful cartoon of the distressing object.- CRITICAL CONSTRAINT: The background and all other non-target objects in the image MUST remain in their original, photorealistic state. Only the target object should be stylized.

## INSTRUCTIONS:
1.  **Precisely Identify and Segment:** Isolate all instances of '{filter_description}' with perfect pixel-level accuracy. This mask is the ONLY area you are allowed to edit.
2.  **Apply Style to Target Only:** Re-render the segmented area according to the specified style below.
3.  **Seamless Integration:** Ensure the boundary between the stylized object and the photorealistic background is clean and natural.
4.  **Output:** Generate only the final, selectively modified image.
STYLE: Pointillism
STYLE REQUIREMENTS FOR TARGET:
- Render the target object using distinct dots of color, with an emphasis on light and shadow.
- CRITICAL: Drastically reduce the level of detail. The result should feel more like a symbol than a detailed character.
```

---

### Scorer

`tasks.py:score_intervention` (Celery task, runs once per candidate in `rank` mode after the batch-generation step). Model: `gpt-4o` by default (`score_provider="openai"`, set in `run_intervention_workflow`, `tasks.py:443`) or `gemini-2.5-flash` if `score_provider="gemini"`.

System prompt, `llm/prompts.py:204-206` (`IMAGE_SCORER_SYSTEM_PROMPT`):
```
IMAGE_SCORER_SYSTEM_PROMPT = """
You are an expert, empathetic, and highly analytical content moderation assistant. Your task is to act as a reward model, providing a detailed, structured evaluation score for a single proposed content intervention. Your analysis must be grounded in the provided context and evaluation axes.
"""
```

User prompt template, `llm/prompts.py:208-235` (`IMAGE_SCORER_USER_PROMPT_TEMPLATE`), formatted in `tasks.py:332-336` with `filter_description`, `user_sensitivity`, `post_text` pulled from `user_context`:
```
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
```

**Alternate scoring strategy:** if `scoring_strategy="two_stage"` is passed (default is `"single_stage"`) *and* the model provider is OpenAI (only `OpenAIModel` implements `score_image_two_stage`; Gemini falls back to `score_image`), `ml_models/openai_models.py:score_image_two_stage` (lines 94-146) runs a two-call chain-of-thought variant. Stage 1 appends to the user prompt above (line 102):
```
\n\nFirst, provide a detailed step-by-step analysis of the intervention based on the evaluation axes. Do NOT provide the final JSON score yet.
```
Stage 2 sends the model's own stage-1 analysis back as an `"assistant"` turn, followed by (line 126):
```
Based on the above analysis, now provide the final score in the requested JSON format.
```

**Text-domain analog:** the codebase has a parallel "Selector" for *text* interventions (not images) — `llm/processor.py:select_text_intervention`, model `gpt-4o-mini` (`content_model`), prompts `SELECTOR_SYSTEM_PROMPT` / `SELECTOR_USER_PROMPT_TEMPLATE` / `RESPONSE_JSON_SCHEMA` in `llm/prompts.py:98-199`. It scores "Modify Segments" / "Add Warning" / "Rewrite" against the same three axes (coherence, fidelity, emotional impact) before `LLMProcessor.process_content` picks a marker type. Included here for completeness since it's architecturally the same "scorer" role, just for the text pipeline rather than images; already captured as a row in the Models Used table above.

---

## Verification

Items searched for but not found, or found only as unused/dead code — flagged so the SRS doesn't silently omit them:

- **No literal "Pruner" exists.** Documented the closest functional equivalent (`FilterUtils.get_image_filter_information`'s intervention pre-ranking) under "Pruning" above; treat that mapping as an interpretation, not a code fact.
- **`select_text_intervention`'s docstring/comment says "gpt-4o"** (`llm/processor.py:604-636`) but the code actually calls `self.llm_model`, which resolves to `content_model` = `gpt-4o-mini`. Flagged as a comment/behavior mismatch in the Models table.
- **A commented-out Gemini code path** exists inside `select_text_intervention` (`llm/processor.py:656-673`, referencing `gemini-2.5-flash`) but is inactive (commented out) — the live code always uses the OpenAI branch above it.
- **`describe_image` and `generate_from_prompt`** (both `OpenAIModel` and `GeminiModel`, in `ml_models/`) are never called from `tasks.py`, `interventions/`, or `ImageProcessor.py` in the traced pipeline — likely legacy/unused. Listed in the Models table with a caveat rather than omitted, per instructions.
- **`FilterCreator.model`** (`llm/filter_creator.py:18`) is read directly from `os.getenv('FILTER_CREATION_MODEL')` with no default and no `ConfigManager` fallback — if that env var is unset at runtime this would be `None`, unlike every other model reference in the codebase which goes through `ConfigManager`/`config.yaml` with a Pydantic default.
- **`FILTER_CREATION_MODEL` is overloaded**: it's read directly by `FilterCreator` (bypassing config) *and* separately maps to `config.yaml`'s `llm.filter_model` (used by `VisionFilterCreator`) via `ConfigManager._apply_env_vars` (`utils/config.py:116`). Same env var name, two different consumption paths, not necessarily kept in sync conceptually.
- **`interventions/stylization.py` and `interventions/selectivestylization.py`** (legacy `StylizationIntervention` / `SelectiveStylizationIntervention`, still registered in `tasks.py:INTERVENTION_REGISTRY` under keys `"stylization"`/`"selectivestylization"`, and still referenced as a fallback candidate list in `ImageProcessor.py:74`) were **not** in the requested file list and were not read/quoted here — flag if the SRS needs their prompts too.
- **Pointillism's sensitivity plumbing is broken in two places** (full-image variant never reads its `sensitivity` param when building `base`; selective variant computes `sens_line`/`soft_adverb` but never interpolates either into the final string) — noted inline above since it's directly relevant to how "intensity" actually affects generation prompts, contrary to what the other six style prompts do.
- **`config.yaml`'s `external_services.image_processing_api.url`** points to an ngrok tunnel (`https://42ca-35-3-209-0.ngrok-free.app/`) — not investigated further as it's outside prompts/models scope, but flagging since it's clearly a stale dev URL if this SRS is meant to describe production config.
