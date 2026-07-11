import os
import requests
import boto3
from botocore.exceptions import NoCredentialsError
from botocore import config
from io import BytesIO
import uuid

from dotenv import load_dotenv
from pathlib import Path

# Load the .env file from the project root
load_dotenv(dotenv_path=Path(__file__).resolve().parents[1] / ".env")

class _StorageManager:
    """
    Manages the storage of image files, either locally or on AWS S3.
    This is a singleton class.
    """

    def __init__(self):
        # Configuration is now read directly from environment variables
        self.use_s3 = os.getenv('USE_S3', 'true').lower() in ('true', '1', 't')
        self.s3_client = None
        if self.use_s3:
            self.bucket_name = os.getenv('AWS_STORAGE_BUCKET_NAME')
            if not self.bucket_name:
                raise ValueError("AWS_STORAGE_BUCKET_NAME is not set, but S3 storage is requested.")

            try:
                client_config = config.Config(max_pool_connections=50)
                self.s3_client = boto3.client(
                    's3',
                    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
                    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
                    region_name=os.getenv('AWS_S3_REGION_NAME', 'us-east-1'),
                    config=client_config
                )
            except NoCredentialsError:
                raise ValueError("AWS credentials not found.")

    def download_image(self, url: str) -> bytes:
        """Downloads an image from a URL and returns its byte content."""
        response = requests.get(url)
        response.raise_for_status()
        return response.content

    def save(self, image_bytes: bytes, filename: str) -> str:
        """
        Saves the image bytes to the configured storage (S3 or local)
        and returns the URL.
        """
        # The decision to use S3 is now based on the instance's configuration
        if self.use_s3 and self.s3_client:
            return self._upload_to_s3(image_bytes, filename)
        else:
            return self._save_locally(image_bytes, filename)

    def _upload_to_s3(self, image_bytes: bytes, filename: str) -> str:
        """Uploads image bytes to S3 and returns the public URL."""
        file_obj = BytesIO(image_bytes)
        self.s3_client.upload_fileobj(
            file_obj,
            self.bucket_name,
            filename,
            ExtraArgs={'ContentType': 'image/png'}
        )
        region = os.getenv('AWS_S3_REGION_NAME', 'us-east-1')
        return f"https://{self.bucket_name}.s3.{region}.amazonaws.com/{filename}"

    def _save_locally(self, image_bytes: bytes, filename: str) -> str:
        """Saves image bytes locally and returns a file URL."""
        local_dir = "temp/uploads"
        os.makedirs(local_dir, exist_ok=True)
        local_path = os.path.join(local_dir, filename)
        
        with open(local_path, "wb") as f:
            f.write(image_bytes)
            
        # Assuming the backend runs on localhost:8001 as per original file
        return f"http://localhost:8001/{local_path}"

# Create a single, globally available instance of the storage manager.
# Other parts of the app will import this instance directly.
storage_manager = _StorageManager()
