# This file is the dedicated entrypoint for gevent-based Celery workers.
from gevent import monkey
monkey.patch_all()

# Now, import the Celery app instance from your tasks file
from tasks import app