from django.conf.urls.defaults import *
from django.views.generic.simple import direct_to_template
from django.conf import settings

urlpatterns = patterns('chutney.views',
    (r'^org_info.json', 'org_info'),
    (r'^names.json', 'name_search'),
    (r'^$', direct_to_template, {
        'template': 'chutney/home.html', 
        'extra_context': {'SERVER_URL': settings.SERVER_URL}
    })
)
