from django.conf.urls.defaults import *
from django.views.generic.simple import direct_to_template
from django.conf import settings

urlpatterns = patterns('chutney.views',
    (r'^search.json', 'search'),
    (r'^names.json', 'name_search'),
    (r'^$', direct_to_template, {
        'template': 'chutney/home.html', 
        'extra_context': {'SERVER_URL': settings.SERVER_URL}
    })
)
