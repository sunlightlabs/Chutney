# Create your views here.
from django.utils import simplejson
from django.http import HttpResponse
from django.conf import settings

from chutney.models import corp_matcher

import urllib3
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

        results = None
        exception = None
        for i in range(self.retries):
            try:
                response = self.pool.get_url(path, params)
                results = simplejson.loads(response.data)
                break
            except urllib3.TimeoutError, e:
                print "Retrying", path, "...."
                exception = e
                continue
            except urllib3.MaxRetryError, e:
                raise
        else:
            raise exception or Exception("No results.")

        return self.remove_unicode(results)

    def entity_search(self, query):
        return self.get_url_json('entities.json', search=query)

    def entity_metadata(self, entity_id, cycle=None):
        results = self.get_url_json("entities/%s.json" % entity_id, cycle)
        career = results['totals'].keys()
        career.sort()
        results['career'] = {'start': career[1], 'end': career[-1]}

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

def get_search_results(request):
    query = request.GET.get('q', '').split(',')
    results = {}
    api = Api()
    for term in query:
        org = corp_matcher.find_match(term)
        if not org:
            continue

        # get entity id...  TODO: include entity ID in our local DB.
        entity_results = [r for r in api.entity_search(org) if r['id']]

        for res in entity_results:
            if corp_matcher.clean(res['name']) == corp_matcher.clean(org):
                entity = res
                break
        else:
            continue

        id_ = entity['id']
        party_breakdown = api.org_party_breakdown(id_)
        issues_lobbied_for = [a['issue'] for a in api.org_issues(id_)]
        recipients = api.org_recipients(id_)

        results[term] = {
            'info': entity,
            'party_breakdown': party_breakdown,
            'issues_lobbied_for': issues_lobbied_for,
            'recipients': recipients,
        }
    return results

def search(request):
    callback = request.GET.get('callback', None)
    json = simplejson.dumps({'results': get_search_results(request)}, indent=4)
    if callback:
        result = "%s(%s);" % (callback, json)
    return HttpResponse(result)

