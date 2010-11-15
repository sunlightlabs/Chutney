from django.conf.urls.defaults import *
from django.conf import settings

from django.contrib import admin
admin.autodiscover()

urlpatterns = patterns('',
    (r'^admin/', include(admin.site.urls)),
    (r'', include('chutney_server.chutney.urls')),
)
if settings.DEBUG:
    import os
    urlpatterns += patterns('',
        (r'^admin_media/(?P<path>.*)$', 'django.views.static.serve', {'document_root': os.path.dirname(admin.__file__) + '/media'}),
    )
    urlpatterns += patterns('',
        (r'^media/(?P<path>.*)$',
            'django.views.static.serve',
            {
                'document_root': settings.MEDIA_ROOT,
                'show_indexes': True
            }
        ),
    )

