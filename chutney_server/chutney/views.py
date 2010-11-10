from cStringIO import StringIO
import urllib2

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
        #content_type = "text/html" # for debug in browser
        content_type = "application/json"
    return HttpResponse(result, content_type=content_type)

def org_info(request):
    """
    Expects a GET variable 'q' which contains a comma separated list of corp
    names.  If the 'fuzzy=1' parameter is provided, treat the names as fuzzy
    strings to search against.  Returns chutney info for the orgs that are
    identified.
    """
    query = request.GET.get('q', '').split(',')
    fuzzy = request.GET.get('fuzzy', '0')
    if fuzzy == '1':
        orgs = []
        for term in query:
            org = corp_matcher.find_single_match(term)
            if org:
                orgs.append((term, org))
    else:
        orgs = [(org, org) for org in query]

    return _json_response(request, Api().chutney_info(orgs))

def name_search(request):
    """
    Expects a GET variable 'term' which contains a term to search against.
    Returns a list of all org names that match the term.
    """
    term = request.GET.get('term', "")
    clean_terms = corp_matcher.clean(term).split()
    orgs = set()
    for name in corp_matcher.corps.keys():
        for term in clean_terms:
            if term not in name:
                break
        else:
            orgs.add(corp_matcher.corps[name])

    if len(orgs) > 50:
        if term in orgs:
            orgs = [term]
        else:
            orgs = []
    else:
        orgs = list(orgs)
    return _json_response(request, simplejson.dumps(orgs))

def assemble_js(request):
    """ 
    Assemble all needed javascript in order.  IE and Chrome don't reliably
    parse dynamic script insertions in order, so we construct a single js to
    insert.
    """
    root = "%sjs/" % (settings.MEDIA_ROOT)
    js = [
        root + "jquery.min.js",
        root + "raphael-min.js",
        root + "g.raphael-min.js",
        root + "g.pie-min.js",
        root + "jquery.tools.min.js",
        root + "jquery.cookie.js",
        root + "chutney.js",
    ]

    protocol = 'https' if settings.FORCE_HTTPS or request.is_secure() else 'http'
    out = StringIO()
    out.write("var CHUTNEY_ELECTION_CYCLE = %i;" % settings.ELECTION_CYCLE)
    out.write("var CHUTNEY_SERVER_URL = '%s://%s';" % (protocol, request.META['HTTP_HOST']))
    out.write("var CHUTNEY_BRISKET_URL = '%s';" % settings.BRISKET_URL)
    out.write("var CHUTNEY_MEDIA_URL = '%s://%s/media/';" % (protocol, request.META['HTTP_HOST']))
    for filename in js:
        #print "... adding", filename
        if filename.startswith("http"):
            fh = urllib2.urlopen(filename)
            out.write(fh.read())
        else:
            with open(filename) as fh:
                out.write(fh.read())
        out.write("\n\n")
    
    return HttpResponse(out.getvalue(), content_type="text/javascript")

