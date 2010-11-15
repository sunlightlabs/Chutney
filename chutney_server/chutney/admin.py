from django.contrib import admin
from chutney.models import DebugPage
from django.contrib.admin import ModelAdmin

class DebugPageAdmin(ModelAdmin):
    date_hierarchy = 'created'
    list_filter = ('fixed', 'created')
    list_display = ('id', 'title', 'created', 'link', 'fixed')
    list_display_links = ('id', 'title')
    
    def queryset(self, request):
        qs = super(DebugPageAdmin, self).queryset(request)
        return qs.filter(main_page=True)
admin.site.register(DebugPage, DebugPageAdmin)