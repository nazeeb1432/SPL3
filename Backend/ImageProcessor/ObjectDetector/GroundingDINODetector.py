import cv2
import torch
import numpy as np
from .ObjectDetector import ObjectDetector
from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection, BitsAndBytesConfig


class GroundingDINODetector(ObjectDetector):
    def __init__(self):
        super().__init__()
        self.model_id = "IDEA-Research/grounding-dino-base"
        self.processor = AutoProcessor.from_pretrained(self.model_id)
        self.model = None
        # Choose the best available device: CUDA (GPU) > MPS (Apple Silicon) > CPU
        if torch.cuda.is_available():
            self.device = "cuda"
            print("\033[32m[INFO] Using CUDA GPU for inference\033[0m")
            self.bnb_config = self._get_bits_and_bytes_config()
            self.model = AutoModelForZeroShotObjectDetection.from_pretrained(self.model_id, quantization_config=self.bnb_config).to(self.device)
        elif hasattr(torch, 'mps') and torch.backends.mps.is_available():
            self.device = "mps"
            print("\033[33m[INFO] Using MPS (Apple Silicon) for inference\033[0m")
            self.model = AutoModelForZeroShotObjectDetection.from_pretrained(self.model_id).to(self.device)
        else:
            self.device = "cpu"
            print("\033[31m[WARNING] Using CPU for inference - this will be slow!\033[0m")
            self.model = AutoModelForZeroShotObjectDetection.from_pretrained(self.model_id).to(self.device)
        

    
    def _get_bits_and_bytes_config(self):
        return BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.bfloat16,
        )
    
    def _quantize_inputs(self, inputs):
        inputs['pixel_values'] = inputs['pixel_values'].to(torch.bfloat16)
    
    def _format_filters(self, filters):
        formatted_filters = []
        for filter in filters:
            if filter[-1] != ".":
                filter += "."
            filter = filter.lower()
            formatted_filters.append(filter)
        return [" ".join(formatted_filters)]

    def _get_obj_boxes(self, outputs, image, input_ids):
        height, width, _ = image.shape
        postprocessed_outputs = self.processor.post_process_grounded_object_detection(outputs,
                                                                        input_ids=input_ids,
                                                                        target_sizes=[(height, width)],
                                                                        threshold=0.3,
                                                                        text_threshold=0.1)
        results = postprocessed_outputs[0]
        boxes = results['boxes'].tolist()
        return [[int(coordinate) for coordinate in box] for box in boxes]
    
    def detect(self, image, filters):
        try:
            formatted_filters = self._format_filters(filters)
            inputs = self.processor(images=image, text=formatted_filters, return_tensors="pt").to(self.device)
            
            # Handle quantization differently depending on device
            if self.device == "cuda":
                self._quantize_inputs(inputs)
                with torch.no_grad():
                    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                        outputs = self.model(**inputs)
            elif self.device == "mps":
                # MPS doesn't support bfloat16 the same way - use regular inference
                with torch.no_grad():
                    outputs = self.model(**inputs)
            else:
                # CPU inference
                with torch.no_grad():
                    outputs = self.model(**inputs)
                    
            return self._get_obj_boxes(outputs, image, inputs.input_ids)
        except Exception as e:
            print(f"Object detection error: {e}")
            return None