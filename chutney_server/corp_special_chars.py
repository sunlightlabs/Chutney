import re
from chutney.models import corp_matcher as cm

present = set()
for corp in sorted(cm.corps.values()):
    result = re.sub("[-A-Za-z0-9\.\/ ]", "", corp)
    if result:
        print [result, corp]
        for c in result:
            present.add(c)

print "".join(present)

