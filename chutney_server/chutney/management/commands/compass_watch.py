import os

from django.core.management.base import BaseCommand
from django.conf import settings
from django.db import connection

class Command(BaseCommand):
    args = ''
    help = """Starts the compass sass compiler in 'watch' mode for the directory `%s/css/sass/`, compiling changes to the sass files whenever they change.  Requires compass to be installed.""" % settings.MEDIA_ROOT

    def handle(self, *args, **kwargs):
        os.system("cd %s/css/sass/ ; compass watch" % settings.MEDIA_ROOT)
