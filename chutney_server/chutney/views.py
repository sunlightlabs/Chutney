# Create your views here.
from django.utils import simplejson
from django.http import HttpResponse
from django.conf import settings
from django.core.cache import cache
try:
    import hashlib
    md5 = hashlib.md5
except ImportError:
    # for Python << 2.5
    import md5 as md5_lib
    md5 = md5_lib.new()

from chutney.models import corp_matcher

import urllib3
import logging
class NullHandler(logging.Handler):
    def emit(self, record):
        pass
logging.getLogger("urllib3.connectionpool").addHandler(NullHandler())

from urlparse import urlparse

class Api(object):
    DEFAULT_CYCLE = "-1"
    retries = 3

    def __init__(self):
        self.api_url = urlparse(settings.AGGREGATES_API_BASE_URL)
        self.pool = urllib3.connection_from_url(settings.AGGREGATES_API_BASE_URL)

    def close(self):
        self.pool.close()

    def get_url_json(self, path, cycle=None, limit=None, **params):
        path = "/%s/%s" % (self.api_url.path.strip('/'), path.strip('/'))
        if cycle is None:
            cycle = self.DEFAULT_CYCLE
        if limit is not None:
            params.update({'limit': limit})
        params.update({'cycle': cycle, 'apikey': settings.API_KEY})

        response = self.pool.get_url(path, params)
        results = simplejson.loads(response.data)

        return self.remove_unicode(results)

    def entity_search(self, query):
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

def _json_response(request, json):
    # add padding for jsonp if needed
    callback = request.GET.get('callback', None)
    if callback:
        result = "%s(%s);" % (callback, json)
        content_type = "text/javascript"
    else:
        result = json
        content_type = "application/json"
    return HttpResponse(result, content_type=content_type)

def search(request):
    api = Api()
    org_id = request.GET.get('id', None)

    key = md5("/".join((settings.CACHE_PREFIX, 
        "search.json", 
        request.GET.get('q') or ""))).hexdigest()
    cached = cache.get(key)
    if cached is not None and (not request.GET.has_key('nocache')):
        print "Serving from cache"
        return _json_response(request, cached)

    if org_id:
        entity = api.entity_metadata(org_id)
        entity['query'] = org_id
        entities = [entity]
    else:
        query = request.GET.get('q', '').split(',')
        print query
        entities = []
        for term in query:
            org = corp_matcher.find_match(term)
            print org
            if not org: 
                continue
            entity_results = api.entity_search(org)
            for res in entity_results:
                if res['id'] and corp_matcher.clean(res['name']) == corp_matcher.clean(org):
                    res['query'] = term
                    entities.append(res)
                    break
        print entities

    results = {}
    for entity in entities:
        id_ = entity['id']
        results[entity['query']] = {
            'info': entity,
            'party_breakdown': api.org_party_breakdown(id_),
            'issues_lobbied_for': [a['issue'] for a in api.org_issues(id_)],
            'recipients': api.org_recipients(id_),
        }
    json = simplejson.dumps(results)
    cache.set(key, json, settings.CACHE_TIMEOUT)
    return _json_response(request, json)

def name_search(request):
    term = request.GET.get('term', "")
    clean_terms = corp_matcher.clean(term).split()
    orgs = []
    for name in corp_matcher.corps.keys():
        for term in clean_terms:
            if term not in name:
                break
        else:
            orgs.append(corp_matcher.corps[name])
    return _json_response(request, simplejson.dumps(orgs))
