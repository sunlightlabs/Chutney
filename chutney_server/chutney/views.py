# Create your views here.
from django.utils import simplejson
from django.http import HttpResponse
from chutney.models import corp_matcher

def search(request):
    query = request.GET.get('q', '').split(',')
    callback = request.GET.get('callback', None)
    results = []
    for term in query:
        results.append([term, corp_matcher.find_match(term)])

    result = simplejson.dumps({'results': results})
    if callback:
        result = "%s(%s);" % (callback, result)
    return HttpResponse(result)



