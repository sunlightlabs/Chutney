from django.http import HttpResponse

def cors_allow_all(orig_func):
    def new_func(request, *args, **kwargs):
        if request.method == 'OPTIONS':
            response = HttpResponse()
            response['Access-Control-Allow-Origin'] = '*'
            response['Access-Control-Allow-Methods'] = '*'
            response['Access-Control-Allow-Headers'] = '*'
            response['Access-Control-Max-Age'] = '172800'
        else:
            response = orig_func(request, *args, **kwargs)
            response['Access-Control-Allow-Origin'] = '*'
        return response
    return new_func