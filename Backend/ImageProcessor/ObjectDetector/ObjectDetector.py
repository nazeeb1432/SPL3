from abc import ABC, abstractmethod

class ObjectDetector(ABC):
    def __init__(self):
        pass

    @abstractmethod
    def detect(self, image, filters):
        '''This method should take an image (OpenCV object) and 
        a list of strings and return a bounding box of detected objects.'''
        pass
