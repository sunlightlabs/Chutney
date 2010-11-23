from django.db import models

class Request(models.Model):
    requested_at   =  models.DateTimeField(auto_now_add=True)
    responded_at   =  models.DateTimeField(auto_now=True)

    was_exception  =  models.BooleanField()

    ip_hash        =  models.CharField(max_length=32)
    path           =  models.CharField(max_length=1024)
    query_params   =  models.CharField(max_length=1024)
    referring_url  =  models.CharField(max_length=1024, null=True)
    user_agent     =  models.CharField(max_length=1024, null=True)
