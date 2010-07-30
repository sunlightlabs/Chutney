import re
import csv
import random

from django.core.management.base import BaseCommand
from django.conf import settings
from django.db import connection

class Command(BaseCommand):
    args = ''
    help = """Reload the canonical list of organization names and entity ID's from the database."""

    def handle(self, *args, **kwargs):
        cursor = connection.cursor()
        cursor.execute("""
            SELECT e.id, e.name, agg.contributor_amount 
            FROM matchbox_entity e LEFT JOIN agg_entities agg 
                                          ON e.id=agg.entity_id 
            WHERE e.type='organization' AND 
                  agg.cycle=-1 ORDER BY agg.contributor_amount DESC
            LIMIT 10000""")

        results = cursor.fetchall()

        with open(settings.ORG_NAME_FILE, 'w') as fh:
            writer = csv.writer(fh)
            for result in results:
                writer.writerow(result)
