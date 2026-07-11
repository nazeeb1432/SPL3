import redis
from ServerCache import Cache

class RedisCache(Cache):
    def __init__(self, host='localhost', port=6379, default_timeout=3600):
        self.default_timeout = default_timeout
        self._conn = redis.Redis(host=host, port=port, decode_responses=True)
    
    def get(self, key, default=None) -> any:
        try:
            value = self._conn.get(key)
            if value is None:
                return default
            return value
        except:
            return default
    
    def set(self, key, value):
        if not isinstance(key, str) or not isinstance(value, str):
            return False
        try:
            self._conn.set(key, value, ex=self.default_timeout)
            return True
        except:
            return False

    def __contains__(self, key):
        if not isinstance(key, str):
            return False
        try:
            return self._conn.exists(key)
        except:
            return False
    
    def delete(self, key):
        if not isinstance(key, str):
            return False
        try:
            self._conn.delete(key)
            return True
        except:
            return False
    
    def publish(self, channel, message):
        """Publish a message to a Redis channel for pub/sub"""
        try:
            return self._conn.publish(channel, message)
        except Exception as e:
            print(f"Error publishing to Redis channel {channel}: {e}")
            return 0