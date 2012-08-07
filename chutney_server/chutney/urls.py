from django.conf.urls.defaults import *
from django.views.generic.simple import direct_to_template
from django.conf import settings

urlpatterns = patterns('chutney.views',
    url(r'^chutney.js$', 'assemble_js', {'debug': False}, name='chutney.js'),
    url(r'^org_info.json', 'org_info', name='chutney.org_info.json'),
    url(r'^names.json', 'name_search', name='chutney.names.json'),
    url(r'^debug/$', 'debug_create', name='chutney.debug_create'),
    url(r'^debug/(?P<id>\d+)/$', 'debug_view', name='chutney.debug_view'),
    url(r'^survey/$', direct_to_template, {'template': 'survey.html', 'extra_context': {'IE_MEDIA_URL': settings.IE_MEDIA_URL}}, name='survey'),
    url(r'^$', direct_to_template, {
        'template': 'chutney/home.html', 
        'extra_context': {'SERVER_URL': settings.SERVER_URL, 'FORCE_HTTPS': settings.FORCE_HTTPS, 'IE_MEDIA_URL': settings.IE_MEDIA_URL, 'IE_BASE_URL': 'http://influenceexplorer.com/', 'DATA_BASE_URL': 'http://data.influenceexplorer.com'}
    }, name='home')
)
