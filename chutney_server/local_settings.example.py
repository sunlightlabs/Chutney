DEBUG = True
TEMPLATE_DEBUG = DEBUG

ADMINS = (
    ('Your Name', 'you@example.com'),
)
CACHE_BACKEND = "memcached://127.0.0.1:11211/?timeout=604800"
# The chutney server's address
SERVER_URL = "http://localhost:8000"
# Must be absolute URL; used by JS in bookmarklet's context.
MEDIA_URL = "http://localhost:8000/media/"
# Sunlight API key
API_KEY = " your sunlight API key here "
