from chutney_server.request_logging.models import Request
from django.core.signals import got_request_exception
from hashlib import md5
import re

def trunc(s):
    return s[:1024] if s is not None else None

def hash(ip):
    h = md5()
    h.update(ip)
    return h.hexdigest()


class RequestLoggingMiddleware():

    def process_request(self, request):
        if not self.should_log(request):
            return None

        if not request.META.has_key('REMOTE_ADDR'):
            request.META['REMOTE_ADDR'] = request.META.get('HTTP_X_REAL_IP', '1.1.1.1')

        page_request = Request.objects.create(
            ip_hash       = hash(request.META.get('REMOTE_ADDR')),
            path          = trunc(request.path),
            query_params  = trunc(request.META.get('QUERY_STRING')),
            referring_url = trunc(request.META.get('HTTP_REFERER')),
            user_agent    = trunc(request.META.get('USER_AGENT')),
        )

        request.page_request_id = page_request.id


    def process_response(self, request, response):
        if not self.should_log(request):
            return response

        page_request = self.get_existing_page_request(request)

        if self.page_request_is_valid(request, page_request):
            # saving will update the responded_at timestamp
            page_request.save()

        return response


    def process_exception(self, request, exception):
        got_request_exception.send(sender=self, request=request)

        if not self.should_log(request):
            return None

        page_request = self.get_existing_page_request(request)

        if self.page_request_is_valid(request, page_request):
            page_request.was_exception = True
            page_request.save()


    def get_existing_page_request(self, request):
        if hasattr(request, 'page_request_id'):
            page_request = Request.objects.get(id=request.page_request_id)

            if page_request:
                return page_request


    def page_request_is_valid(self, request, page_request):
        return \
            page_request \
            and page_request.ip_hash == hash(request.META.get('REMOTE_ADDR')) \
            and page_request.path == request.path \
            and page_request.query_params == request.META.get('QUERY_STRING')


    def should_log(self, request):
        return not re.match(r'(^/media|^/simplepay|.*\.ico$)', request.path)


