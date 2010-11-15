from __future__ import division, print_function

import os
import re
import csv
import itertools
try:
    import hashlib
    md5 = hashlib.md5
except ImportError:
    # for Python << 2.5
    import md5 as md5_lib
    md5 = md5_lib.new()
import urllib3
import logging
# Set logging handler for urllib3, otherwise it fails occasionally for want of
# one
class NullHandler(logging.Handler):
    def emit(self, record):
        pass
logging.getLogger("urllib3.connectionpool").addHandler(NullHandler())
from urlparse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.utils import simplejson

class CorpMatcher(object):
    TOP_10000_PATH = settings.ORG_NAME_FILE
    N_GRAPHS = 4
    shortcuts = {
            "ACLU": "American Civil Liberties Union",
            "AMAZON": "Amazon.com",
            "APPLE": "Apple Inc",
            "AT T": "AT&T Inc",
            "BAJA FRESH": "Wendy's/Arby's Group",
            "BANANA BR": "Gap Inc",
            "BANANA REP": "Gap Inc",
            "BANANA REPUBLIC": "Gap Inc",
            "BKOFAMERICA": "Bank of America",
            "BP": "BP",
            "CHECK": None,
            "CHEVRON": "Chevron Corp",
            "CHILI S": "Brinker International",
            "COSTCO": "Costco Wholesale",
            "CVS": "CVS Caremark Corp",
            "DCCC": "Democratic Congressional Campaign Cmte",
            "DELTA": "Delta Airlines",
            "DNC": "Democratic National Cmte",
            "FLICKR": "Yahoo! Inc",
            "GOOGLE": "Google Inc",
            "HARRIS TEETER": "Ruddick Corp",
            "INTUIT": "Intuit Inc",
            "IRS": "Internal Revenue Service",
            "ITUNES": "Apple Inc",
            "JIFFY LUBE": "Royal Dutch Shell",
            "KROGER": "KROGER CO",
            "MCDONALD S": "McDonald's Corp",
            "NEA": "National Education Assn",
            "NETFLIX": "Netflix Inc",
            "OLIVE GARDEN": "Darden Restaurants",
            "PAYPAL": "eBay Inc",
            "PANERA": "Panera LLC",
            "PIZZA HUT": "Pizza Hut",
            "PUBLIX": "Publix Super Markets", 
            "RACKSPACE": "Rackspace US",
            "RED LOBSTER": "Darden Restaurants",
            "SHELL": "Royal Dutch Shell",
            "SONY": "Sony Corp",
            "SKYPE": "eBay Inc",
            "STAPLES": "Staples Inc",
            "TARGET": "Target Corp",
            "TGI FRIDAY S": "Carlson Companies",
            "TMOBILE": "T-Mobile USA",
            "UPS": "United Parcel Service",
            "USPS": "US Postal Service",
            "VANGUARD": "Vanguard Group",
            "VERIZON": "Verizon Communications",
    }

    def __init__(self):
        corps = {}
        eids = {}
        with open(self.TOP_10000_PATH) as fh:
            reader = csv.reader(fh)
            for eid, corp, amount in reader:
                clean = self.clean(corp)
                corps[clean] = corp
                eids[corp] = eid
        self.eids = eids
        self.corps = corps

        self.matches = {}
        for corp in self.corps:
            parts = corp.split()
            for n in range(0, self.N_GRAPHS):
                for i in range(n, len(parts)):
                    word = " ".join(parts[i - n:i+1])
                    self.matches[word] = self.matches.get(word, [])
                    self.matches[word].append(corp)
        
    @classmethod
    def clean(cls, string):
        string = re.sub("[^A-Z0-9 ]", " ", string.upper())
        return re.sub("\s\s+", " ", string.strip())

    def search(self, string):
        """
        Search for the best set of matches for the given string
        """
        string = self.clean(string)
        parts = string.split()
        best_match = []
        for i in range(self.N_GRAPHS - 1, -1, -1):
            for j in range(i + 1, len(parts) + 1):
                word = " ".join(parts[i:j])
                if word in self.shortcuts:
                    return [self.shortcuts[word]]
                elif word in self.matches:
                    match = self.matches[word]
                    if not best_match or len(match) < len(best_match):
                        best_match = match
        results = []
        for match in best_match:
            dist = self.distance(match, string)
            if dist < 0.6:
                results.append((dist, match))
        results.sort()
        return [r for d,r in results]

    def find_single_match(self, string):
        """
        Search for a single best match for the given string.  Returns None
        if either no matches or multiple matches are found.
        """
        matches = self.search(string)
        if len(matches) == 1:
            return matches[0]
        return None

    @classmethod
    def distance(cls, w1, w2):
        """ 
        Return the Jaccard distance -- the ratio of the number of words that
        are different between the two strings to the sum of all words in
        either.  
        e.g. "fun times", "fun rhymes" => 2 (times, rhymes) / 3 (times, rhymes, fun).
        """
        p1 = set(w1.split())
        p2 = set(w2.split())
        try:
            return len(p1 ^ p2) / len(p1 | p2)
        except ZeroDivisionError:
            return 10000

class Api(object):
    """
    Class encapsulating Transparency Data API calls.
    """
    DEFAULT_CYCLE = settings.ELECTION_CYCLE
    def __init__(self):
        self.api_url = urlparse(settings.AGGREGATES_API_BASE_URL)
        self.pool = urllib3.connection_from_url(settings.AGGREGATES_API_BASE_URL)

    def get_url_json(self, path, cycle=None, limit=None, **params):
        path = "/%s/%s" % (self.api_url.path.strip('/'), path.strip('/'))
        if cycle is None:
            cycle = self.DEFAULT_CYCLE
        if limit is not None:
            params['limit'] = limit
        params['cycle'] = cycle 

        cache_key = md5("/".join((settings.CACHE_PREFIX, "api", path, 
            unicode(sorted(params.items()))))).hexdigest()

        cached = cache.get(cache_key)
        if cached:
            data = cached
        else:
            params['apikey'] = settings.API_KEY
            data = self.pool.get_url(path, params).data
            cache.set(cache_key, data)

        #print(cache_key, bool(cached))

        results = simplejson.loads(data)
        return self.remove_unicode(results)

    def entity_search(self, query):
        query = re.sub("[^A-Za-z0-9\.\/ ]", " ", query)
        query = re.sub("\s+", " ", query).strip()
        return self.get_url_json('entities.json', search=query)

    def entity_metadata(self, entity_id, cycle=None):
        results = self.get_url_json("entities/%s.json" % entity_id, cycle)
        career = results['totals'].keys()
        career.sort()
        results['career'] = {'start': career[1], 'end': career[-1]}
        return results

    def org_party_breakdown(self, entity_id, cycle=None):
        return self.get_url_json('aggregates/org/%s/recipients/party_breakdown.json' % entity_id, cycle)

    # issues this org hired lobbying for
    def org_issues(self, entity_id, cycle=None, limit=None):
        return self.get_url_json('aggregates/org/%s/issues.json' % entity_id, cycle, limit)

    def org_recipients(self, entity_id, cycle=None, limit=None):
        return self.get_url_json('aggregates/org/%s/recipients.json' % entity_id, cycle, limit)

    def remove_unicode(self, data):
        ''' converts a dictionary or list of dictionaries with unicode
        keys or values to plain string keys'''
        if isinstance(data, dict):
            plain = {}
            for k,v in data.iteritems():
                k = self.remove_unicode(k)
                v = self.remove_unicode(v)
                plain[k] = v
            return plain
        if isinstance(data, list):
            plain = []
            for record in data:
                plain.append(self.remove_unicode(record))
            return plain
        if isinstance(data,unicode):
            return str(data)
        return data

    def chutney_info(self, org_matches):
        """
        Get all chutney-relevant info.  Expects a list of (term, org) pairs,
        where org is the name of the organization in question.  Returns a dict
        of the form:
            {term: org_info}
        """
        # Get entity IDs from orgs.
        results = {}
        for term, org in org_matches:
            entity_results = self.entity_search(org)
            # Pull out the closest match (entity_search's stopword elimination can
            # make our exact matches inexact).
            for res in entity_results:
                if res['id'] and corp_matcher.clean(res['name']) == corp_matcher.clean(org):
                    id_ = res['id']
                    results[term] = {
                        'info': res,
                        'party_breakdown': self.org_party_breakdown(id_),
                        'issues_lobbied_for': [a['issue'] for a in self.org_issues(id_)],
                        'recipients': self.org_recipients(id_),
                    }
                    break
        return simplejson.dumps(results, indent=4)

corp_matcher = CorpMatcher()

from django.db import models
class DebugPage(models.Model):
    title = models.TextField(blank=True)
    email = models.EmailField(blank=True)
    description = models.TextField(blank=True)
    
    main_page = models.BooleanField(default=True)
    user_agent = models.CharField(max_length=512, blank=True)
    page = models.TextField(blank=True)
    created = models.DateTimeField(auto_now_add=True)
    
    fixed = models.BooleanField(default=False)
    
    def __str__(self):
        return self.title
    
    def get_absolute_url(self):
        return '/debug/%s/' % self.pk
    
    def link(self):
        return "<a href='%s'>View submission</a>" % self.get_absolute_url()
    link.allow_tags = True
