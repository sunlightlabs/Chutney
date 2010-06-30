from django.conf.urls.defaults import *
from django.conf import settings

urlpatterns = patterns('',
    (r'^%s/js/chutney.js' % settings.MEDIA_URL[1:-1], 'chutney.views.assemble_js'),
    (r'', include('chutney_server.chutney.urls')),
)
if settings.DEBUG:
    urlpatterns += patterns('',
        (r'^%s/(?P<path>.*)$' % settings.MEDIA_URL[1:-1],
            'django.views.static.serve',
            {
                'document_root': settings.MEDIA_ROOT,
                'show_indexes': True
            }
        ),
    )

