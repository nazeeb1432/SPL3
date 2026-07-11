import json
import sys
sys.path.append("..")
from openai import OpenAI
from typing import List, Dict, Any
from .ObjectDetector import GroundingDINODetector
from FilterUtils import get_best_filter
# from FilterUtils import get_random_interventions
# from CartoonImager import make_image_cartoonish, make_image_cartoonish_gpt_image, make_image_replacement_gemini
from ServerCache import image_cache
# from tasks import run_intervention_workflow

# singletons
image_detector = GroundingDINODetector()
cartoonish_filter = ["cartoonish."]
edit_or_replace_filter = ["edit."]

class ImageProcessor:
    def __init__(self):
        self.client = OpenAI()

    # def get_intervention_type_for_image(self, best_filter_name, best_filter_coverage, filters) -> str:
    def get_intervention_type_for_image(self, best_filter_object) -> str:
        # Get the actual filter from the filter list basef on the best_filter name
        # image_content_filter = [f for f in filters if f.filter_text == best_filter_name][0]
        # return "overlay" if image_content_filter.intensity > 0.5 else "blur"
        return "edit_to_replace"
    
    def get_deffered_image_result(self, image_url, filters):
        return image_cache.get_processed_value_from_cache(image_url=image_url, filters=filters)

    async def process_image(self, image_url: str, filters: List[Dict[str, Any]], user_id: str, post_metadata: Dict[str, Any], post_text: str = None):
        """
        Processes an image by finding the best filter and dispatching the appropriate intervention workflow.
        Now works with a list of full filter objects.
        """
        filter_result = await get_best_filter(filters, image_url, include_interventions=True)
        print(f"\033[92m' Filter Result: {filter_result} \033[0m")
        if not filter_result or not filter_result.best_filter:
            return {"image_url": image_url, "intervention_type": None}
        
        best_filter_object = filter_result.best_filter
        recommended_interventions = filter_result.recommended_interventions
        top3_interventions = filter_result.top3_interventions
        next2_interventions = filter_result.next2_interventions

        intervention_type = self.get_intervention_type_for_image(best_filter_object)
        
        # The 'filters' payload for the task should be a list of full filter objects
        # to preserve all metadata.
        filters_for_task = filters
        print(type(filters_for_task))
        serialized_filters = [f.__dict__ for f in filters_for_task] #filters_for_task  #
        print(type(serialized_filters))
        print(f"\033[92m' Here! Here! Here! \033[0m")
        if intervention_type == "edit_to_replace":
            # This is the main path for complex, AI-driven interventions.
            # We use the 'rank' mode to decide between multiple options.
            
            # Determine candidate interventions intelligently
            intervention_defined = post_metadata.get('image_intervention', False)
            if intervention_defined:
                # If intervention is predefined in post metadata, use it
                print(f"Image Intervention defined in post metadata: {intervention_defined}")
                candidate_interventions = [intervention_defined]
            else:
                # Use the top3 interventions recommended by the LLM
                if top3_interventions:
                    candidate_interventions = top3_interventions
                    print(f"Using top3 LLM recommended interventions for '{best_filter_object.filter_text}': {candidate_interventions}")
                else:
                    # Fallback to random selection if no recommendations
                    # candidate_interventions = get_random_interventions(count=3)
                    candidate_interventions = ["stylization", "replacement", "occlusion"]
                    print(f"No LLM recommendations, using random interventions: {candidate_interventions}")
            
            payload = {
                "mode": "rank",
                "url": image_url,
                "user_id": user_id,
                # "filters": serialized_filters,  # Pass the full filter object(s)
                "candidate_names": candidate_interventions,
                "user_context": {
                    "filter_text": best_filter_object.filter_text,
                    "sensitivity": best_filter_object.intensity,
                    "metadata": best_filter_object.filter_metadata,
                    "top3_interventions": top3_interventions,
                    "next2_interventions": next2_interventions
                }
            }
            from tasks import run_intervention_workflow
            run_intervention_workflow.delay(json.dumps(payload))
            return {
                "image_url": image_url,
                "best_filter_name": best_filter_object.filter_text,
                "intervention_type": intervention_type,
                "status": "DEFERRED",
                "filters": [best_filter_object.filter_text],
                "top3_interventions": top3_interventions,
                "next2_interventions": next2_interventions,
                "all_recommended_interventions": recommended_interventions
            }

        else:
            # Fallback or other direct intervention types can be handled here
            # For example, a simple stylization without ranking.
            payload = {
                "mode": "direct",
                "url": image_url,
                "user_id": user_id,
                "intervention_name": "stylization",
                "filters": serialized_filters,
            }
            from tasks import run_intervention_workflow
            run_intervention_workflow.delay(json.dumps(payload))
            return {
                "image_url": image_url,
                "best_filter_name": best_filter_object['filter_text'],
                "intervention_type": "stylization",
                "status": "DEFERRED",
                "filters": serialized_filters
            }

