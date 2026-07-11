# Gevent monkey patching for high concurrency
# from gevent import monkey
# monkey.patch_all()

import json
import os
import uuid
import logging
import base64
import hashlib
from io import BytesIO
from celery import Celery, group, chord
from ml_models.base import ImageModel
from ml_models.openai_models import OpenAIModel
from ml_models.gemini_models import GeminiModel
from ml_models.grounding_dino_model import GroundingDinoModel # Added local model
from interventions import replacement, stylization, occlusion, blur, shrink, inpainting, warning, selectivestylization, stylize_cubism, stylize_impressionism, stylize_ghibli, stylize_pointillism, selective_stylize_cubism, selective_stylize_impressionism, selective_stylize_ghibli, selective_stylize_pointillism
from utils.storage import storage_manager # Use the singleton instance
from ServerCache import image_cache

# Load environment variables first with override to ensure .env takes precedence
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'), override=True)

from settings import OPENAI_API_KEY, GOOGLE_API_KEY  # optional, but at least triggers load_dotenv()

from llm.prompts import IMAGE_SCORER_SYSTEM_PROMPT, IMAGE_SCORER_USER_PROMPT_TEMPLATE
# ... rest of the file ...




# --- Setup ---
logger = logging.getLogger(__name__)
app = Celery('ImageProcessor', broker='redis://localhost:6379/0', backend='redis://localhost:6379/0')

# Gevent-optimized Celery configuration
app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    # Optimize for high concurrency and API throughput
    worker_prefetch_multiplier=1,  # Prevent worker hoarding tasks
    task_acks_late=True,  # Acknowledge tasks only after completion
    worker_max_memory_per_child=512 * 1024,  # 512MB memory limit per worker (lower for more workers)
    # Connection pooling for better performance
    broker_connection_retry_on_startup=True,
    broker_pool_limit=None,  # Unlimited connections to Redis
)



# A mapping from intervention names to their implementation classes
INTERVENTION_REGISTRY = {
    "stylization": stylization.StylizationIntervention(),  # Keep for backward compatibility
    "stylize_cubism": stylize_cubism.StylizeCubismIntervention(),
    "stylize_impressionism": stylize_impressionism.StylizeImpressionismIntervention(),
    "stylize_ghibli": stylize_ghibli.StylizeAbstractIntervention(),
    "stylize_pointillism": stylize_pointillism.StylizePointillismIntervention(),
    "replacement": replacement.ReplacementIntervention(),
    "occlusion": occlusion.OcclusionIntervention(),
    "blur": blur.BlurIntervention(),
    "shrink": shrink.ShrinkIntervention(),
    "selectivestylization": selectivestylization.SelectiveStylizationIntervention(),  # Keep for backward compatibility
    "selective_stylize_cubism": selective_stylize_cubism.SelectiveStylizeCubismIntervention(),
    "selective_stylize_impressionism": selective_stylize_impressionism.SelectiveStylizeImpressionismIntervention(),
    "selective_stylize_ghibli": selective_stylize_ghibli.SelectiveStylizeGhibliIntervention(),
    "selective_stylize_pointillism": selective_stylize_pointillism.SelectiveStylizePointillismIntervention(),
    "inpainting": inpainting.InpaintingIntervention(),
    "warning": warning.WarningIntervention(),
}

# A mapping from model provider names to their implementation classes
MODEL_REGISTRY = {
    "openai": OpenAIModel(OPENAI_API_KEY),
    "gemini": GeminiModel(GOOGLE_API_KEY),
    "local": GroundingDinoModel(), # Registered as local
    "grounding_dino": GroundingDinoModel(), # Alias
}


# --- Celery Tasks ---

@app.task
def process_image_batch(source_url: str, intervention_names: list, user_context: dict, 
                       model_provider: str, job_id: str) -> list:
    """
    OPTIMIZED: Process multiple interventions for one image in a single task.
    This reduces task overhead and downloads the image only once.
    """
    logger.info(f"Processing batch for {len(intervention_names)} interventions on image: {source_url}")
    
    try:
        # Download image once for all interventions
        original_image_bytes = storage_manager.download_image(source_url)
        model = MODEL_REGISTRY[model_provider]
        
        # CONCURRENT BATCH PROCESSING: Process all interventions simultaneously using gevent
        from gevent import spawn
        from gevent.pool import Pool
        
        def process_intervention_sync(intervention_name):
            try:
                intervention = INTERVENTION_REGISTRY[intervention_name]
                
                # Process the intervention (gevent makes API calls concurrent automatically)
                processed_image_bytes = intervention.apply(
                    image_bytes=original_image_bytes,
                    filters=user_context,
                    model=model,
                )
                
                # Save with job_id for tracking
                filename = f"jobs/{job_id}/{intervention_name}.png"
                processed_url = storage_manager.save(processed_image_bytes, filename)
                logger.info(f"Concurrent Batch: Saved {intervention_name} to {processed_url}")
                
                return {
                    "status": "success",
                    "intervention_name": intervention_name,
                    "processed_url": processed_url,
                    "base64_url": None,  # Deferred
                    "job_id": job_id
                }
                
            except Exception as e:
                logger.error(f"Concurrent Batch: Failed intervention '{intervention_name}': {e}", exc_info=True)
                return {
                    "status": "failed",
                    "intervention_name": intervention_name,
                    "error": str(e),
                    "job_id": job_id
                }
        
        # Run all interventions concurrently with gevent pool
        pool = Pool(len(intervention_names))
        results = pool.map(process_intervention_sync, intervention_names)
        
        return results
        
    except Exception as e:
        logger.error(f"Batch: Failed to download/process image {source_url}: {e}", exc_info=True)
        # Return failed results for all interventions
        return [{
            "status": "failed",
            "intervention_name": name,
            "error": f"Image download failed: {str(e)}",
            "job_id": job_id
        } for name in intervention_names]


@app.task
def process_image_intervention(data: str) -> dict:
    """
    Worker task to apply a single, specified image intervention.
    This task no longer handles caching; caching is managed by the orchestrator.
    It now accepts a job_id to group stored artifacts.
    """
    # 1. Parse and Validate Input
    try:
        request_data = json.loads(data)
        source_url = request_data['url']
        filters = request_data.get('filters', [])
        # print(f"Filters received: {filters}, type(filters)={type(filters)}")
        intervention_name = request_data['intervention_name']
        model_provider = request_data['model_provider']
        job_id = request_data['job_id'] # Expect a job_id from the orchestrator

    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"Failed to parse request data: {e}. Data: {data}")
        return {"error": "Invalid request format", "status": "failed"}

    try:
        # 2. Initialize Components
        intervention = INTERVENTION_REGISTRY[intervention_name]
        model = MODEL_REGISTRY[model_provider]

        # 3. Execute the Workflow
        original_image_bytes = storage_manager.download_image(source_url)
        
        processed_image_bytes = intervention.apply(
            image_bytes=original_image_bytes,
            filters=filters,
            model=model,
        )
        
        # The filename now includes the job_id for better artifact tracking
        filename = f"jobs/{job_id}/{intervention_name}.png"
        processed_url = storage_manager.save(processed_image_bytes, filename)
        logger.info(f"Saved processed image to {processed_url}")

        # 4. Return Result (no caching here)
        base64_url = None # Base64 generation is deferred
        
        return {
            "status": "success",
            "intervention_name": intervention_name,
            "processed_url": processed_url,
            "base64_url": base64_url,
            "job_id": job_id
        }

    except Exception as e:
        logger.error(f"Failed to process intervention '{intervention_name}' for {source_url}: {e}", exc_info=True)
        return {"error": str(e), "original_url": source_url, "status": "failed"}


@app.task
def finalize_workflow(scores: list, generated_results: list, source_url: str, filters: list, job_id: str):
    """
    Final task in the 'rank' mode chain. It receives the scores and the
    original generation results, determines the winner, and caches the result.
    """
    logger.info(f"Finalizing workflow for job_id: {job_id}")
    successful_scores = [s for s in scores if s.get('status') == 'success']
    if not successful_scores:
        logger.error(f"All scoring tasks failed for job_id: {job_id}")
        return {"error": "All scoring tasks failed.", "status": "failed", "job_id": job_id}

    best_score_info = max(successful_scores, key=lambda x: x['score'])
    winning_intervention_name = best_score_info['intervention']
    
    final_result = next(
        (r for r in generated_results if r.get('intervention_name') == winning_intervention_name),
        None
    )

    if not final_result:
        logger.error(f"Could not find matching result for the best score in job_id: {job_id}")
        return {"error": "Could not find matching result for the best score.", "status": "failed", "job_id": job_id}

    # Centralized Cache Set
    if final_result.get('status') == 'success':
        image_cache.set_processed_value_to_cache(
            image_url=source_url, filters=filters, 
            processed_url=final_result['processed_url'], 
            base64_url=final_result.get('base64_url')
        )
        logger.info(f"Cached final result for job {job_id}")

    return final_result


@app.task
def run_scoring_and_find_best_batch(batch_results: list, source_url: str, user_context: dict, score_provider: str, job_id: str, filters: list, scoring_strategy: str = "single_stage"):
    """
    OPTIMIZED: Handle results from batch processing.
    batch_results is a list of intervention results from a single batch task.
    """
    logger.info(f"Running batch scoring for job_id: {job_id}")
    
    # Filter out failed generation results
    successful_results = [r for r in batch_results if r.get('status') == 'success']
    if not successful_results:
        logger.error(f"All batch interventions failed for job_id: {job_id}")
        return {"error": "All batch interventions failed.", "status": "failed", "job_id": job_id}

    # Create scoring tasks for successful results
    scoring_tasks = []
    for result in successful_results:
        scoring_tasks.append(score_intervention.s(
            score_provider=score_provider,
            original_url=source_url,
            candidate_result=result,
            user_context=user_context,
            scoring_strategy=scoring_strategy
        ))
    
    # Create callback to finalize results
    callback = finalize_workflow.s(
        generated_results=successful_results,
        source_url=source_url,
        filters=filters,
        job_id=job_id
    )
    
    # Run scoring in parallel and then finalize
    return chord(scoring_tasks, callback).apply_async()





@app.task
def score_intervention(score_provider: str, original_url: str, candidate_result: dict, user_context: dict, scoring_strategy: str = "single_stage") -> dict:
    """
    Calls a VLM to score a single candidate intervention.
    It now receives the full result dictionary from the generation task.
    """
    intervention_name = candidate_result['intervention_name']
    candidate_url = candidate_result['processed_url']

    try:
        scorer_model = MODEL_REGISTRY[score_provider]
        
        # Prepare context for the prompt template
        filter_description = ", ".join(user_context.get('filter', ['N/A']))
        user_sensitivity = user_context.get('sensitivity', 'N/A')
        # Assuming post_text might be part of user_context, or passed separately
        post_text = user_context.get('post_text', 'N/A')

        # Format the user prompt from the imported template
        user_prompt = IMAGE_SCORER_USER_PROMPT_TEMPLATE.format(
            post_text=post_text,
            filter_description=filter_description,
            user_sensitivity=user_sensitivity
        )
        
        # The system prompt is now also imported
        system_prompt = IMAGE_SCORER_SYSTEM_PROMPT

        if scoring_strategy == "two_stage" and hasattr(scorer_model, "score_image_two_stage"):
             score_json_str = scorer_model.score_image_two_stage(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                original_image_url=original_url,
                candidate_image_url=candidate_url,
            )
        else:
            score_json_str = scorer_model.score_image(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                original_image_url=original_url,
                candidate_image_url=candidate_url,
            )
        score_data = json.loads(score_json_str)
        return {
            "intervention": intervention_name,
            "score": score_data.get("overall_score", 0.0),
            "status": "success"
        }
    except Exception as e:
        logger.error(f"Failed to score intervention '{intervention_name}': {e}", exc_info=True)
        return {"intervention": intervention_name, "score": 0.0, "status": "failed", "error": str(e)}


@app.task(bind=True)
def run_intervention_workflow(self, data: str):
    """
    Primary entry point for all image interventions.
    This task is now fully asynchronous and uses a chain of callbacks
    to manage the workflow instead of blocking with .get().
    """
    # 1. Parse Input
    try:
        request = json.loads(data)
        mode = request.get('mode', 'rank') # Default to ranking mode
        source_url = request['url']
        user_id =request['user_id']
        filters = request.get('filters', [])
        user_context = request.get('user_context', {})
        chosen_filter=user_context['filter_text']
        # print(f"Chosen filter: {chosen_filter},type(chosen_filter)={type(chosen_filter)}")
        chosen_sensitivity=user_context['sensitivity']
    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"Invalid request for run_intervention_workflow: {e}")
        return {"error": "Invalid request format", "status": "failed"}

    # 2. Centralized Cache Check
    # The cache key includes the mode to distinguish between a 'direct' stylization
    # and a 'rank' result that happened to choose stylization.
    # cache_key_parts = (source_url, tuple(sorted(filters)), mode, tuple(sorted(request.get('candidate_names', []))), request.get('intervention_name'))
    # cache_key = hashlib.sha1(str(cache_key_parts).encode()).hexdigest()
    
    cached_result = image_cache.get_processed_value_from_cache(image_url=source_url, filters=[chosen_filter]) # Simplified key for now
    if cached_result and isinstance(cached_result, dict):
        logger.info(f"Returning full workflow result from cache for request {self.request.id}")
        return cached_result

    # 3. Generate Job ID
    filters_str = json.dumps(filters)
    filters_hash = hashlib.sha1(filters_str.encode()).hexdigest()[:8]
    random_part = str(uuid.uuid4())[:8]
    job_id = f"{user_id}_{filters_hash}_{random_part}"
    logger.info(f"Starting new intervention workflow with job_id: {job_id}")

    # 4. Execute Based on Mode using an asynchronous chain
    if mode == 'direct':
        try:
            intervention_name = request['intervention_name']
            payload = {
                "url": source_url,
                "intervention_name": intervention_name,
                "filters": [chosen_filter],
                "model_provider": request.get("generation_provider", "gemini"),
                "job_id": job_id
            }
            # Just run the task. The client that called this workflow will have to
            # get the result from the returned AsyncResult if it needs it.
            process_image_intervention.delay(json.dumps(payload))
        except KeyError:
            logger.error("'intervention_name' is required for 'direct' mode")
            return {"error": "'intervention_name' is required for 'direct' mode", "status": "failed"}

    elif mode == 'rank':
        candidate_names = request.get('candidate_names', [])
        if not candidate_names:
            return {"error": "'candidate_names' is required for 'rank' mode", "status": "failed"}

        # OPTIMIZED: Use batch processing - process all interventions in one task
        logger.info(f"Using BATCH processing for {len(candidate_names)} interventions")
        generation_provider = request.get("generation_provider", "gemini")
        
        # Single batch task instead of multiple individual tasks
        batch_task = process_image_batch.s(
            source_url=source_url,
            intervention_names=candidate_names,
            user_context=user_context,
            model_provider=generation_provider,
            job_id=job_id
        )
        
        # Callback for scoring - now receives a list of results
        score_provider = request.get("score_provider", "openai")
        scoring_strategy = request.get("scoring_strategy", "single_stage")
        callback = run_scoring_and_find_best_batch.s(
            source_url=source_url,
            user_context={"filters": filters, **user_context},
            score_provider=score_provider,
            job_id=job_id,
            filters=[chosen_filter],
            scoring_strategy=scoring_strategy
        )
        
        # Chain: batch generation -> batch scoring
        return (batch_task | callback).apply_async()

    else:
        logger.error(f"Invalid mode specified: {mode}")
        return {"error": f"Invalid mode: {mode}", "status": "failed"}

    # This task now returns immediately after starting the chain.
    # The client can use the task_id to monitor the workflow's final result.
    return {"status": "Workflow started", "job_id": job_id}