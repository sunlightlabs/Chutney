from django.conf.urls.defaults import *
from django.views.generic.simple import direct_to_template
from django.conf import settings

urlpatterns = patterns('chutney.views',
    url(r'^chutney.js$', 'assemble_js', name='chutney.js'),
    url(r'^org_info.json', 'org_info', name='chutney.org_info.json'),
    url(r'^names.json', 'name_search', name='chutney.names.json'),
    url(r'^$', direct_to_template, {
        'template': 'chutney/home.html', 
        'extra_context': {'SERVER_URL': settings.SERVER_URL, 'FORCE_HTTPS': settings.FORCE_HTTPS}
    }, name='home')
)
