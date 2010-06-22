# Create your views here.
from django.utils import simplejson
from django.http import HttpResponse
from chutney.models import corp_matcher

import api

def get_search_results(request):
    query = request.GET.get('q', '').split(',')
    results = {}
    for term in query[0:10]:
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
#        entity_info = api.entity_metadata(id_)
#        entity_info['totals'] = entity_info['totals'][api.DEFAULT_CYCLE]

        results[term] = {
            'info': entity,
            'party_breakdown': party_breakdown,
            'issues_lobbied_for': issues_lobbied_for,
        }
    return results

def search(request):
    callback = request.GET.get('callback', None)
    json = simplejson.dumps({'results': get_search_results(request)}, indent=4)
    if callback:
        result = "%s(%s);" % (callback, json)
    return HttpResponse(result)

