from cStringIO import StringIO

from django.utils import simplejson
from django.http import HttpResponse
from django.conf import settings

from chutney.models import corp_matcher, Api

def _json_response(request, json):
    # add padding for jsonp if needed
    callback = request.GET.get('callback', None)
    if callback:
        result = "%s(%s);" % (callback, json)
        content_type = "text/javascript"
    else:
        result = json
        content_type = "text/html" # for debug in browser
        #content_type = "application/json"
    return HttpResponse(result, content_type=content_type)

def search(request):
    """
    Expects a GET variable 'q' which contains a comma separated list of fuzzy
    corporation names to search against.  Returns chutney info for the orgs
    that are identified.
    """
    query = request.GET.get('q', '').split(',')
    matches = []
    for term in query:
        org = corp_matcher.find_single_match(term)
        if org:
            matches.append((term, org))
    return _json_response(request, Api().chutney_info(matches))

def match(request):
    """
    Expects a GET variable 'q' which contains a comma separated list of exact
    corp names.  Returns chutney info for the orgs.
    """
    orgs = [(org, org) for org in request.GET.get('q', '').split(',')]
    return _json_response(request, Api().chutney_info(orgs))

def name_search(request):
    """
    Expects a GET variable 'term' which contains a term to search against.
    Returns a list of all org names that match the term.
    """
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

def assemble_js(request):
    """ 
    Assemble all needed javascript in order.  IE and Chrome don't reliably
    parse cross-script dependencies in dynamic script insertions, so we make
    the insertions static. 
    """
    root = "%sjs/" % (settings.MEDIA_ROOT)
    js = [
        root + "raphael.js",
        root + "g.raphael-min.js",
        root + "g.pie.patched.js",
        root + "g.bar.jeremi.js",
        root + "brisket_charts.js",
        root + "underscore-1.0.4.js",
        root + "jquery.js",
        root + "jquery-ui.js",
        root + "jquery.cookie.js",
        root + "chutney.js",
    ]

    out = StringIO()
    for filename in js:
        with open(filename) as fh:
            out.write(fh.read())
    return HttpResponse(out.getvalue(), content_type="text/javascript")

