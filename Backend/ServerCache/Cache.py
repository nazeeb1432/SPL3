from abc import ABC, abstractmethod

class Cache(ABC):
    @abstractmethod
    def get(self, key, default=None) -> any:
        pass

    @abstractmethod
    def set(self, key, value) -> bool:
        pass
    
    @abstractmethod
    def __contains__(self, key) -> bool:
        pass

    @abstractmethod
    def delete(self, key) -> bool:
        pass
