from __future__ import division, print_function

import os
import re
import csv
import itertools

class CorpMatcher(object):
    TOP_10000_PATH = os.path.abspath(
            os.path.join(os.path.dirname(__file__), "Top10000List.csv"))
    N_GRAPHS = 4
    shortcuts = {
            'ACLU': "American Civil Liberties Union",
            'DCCC': "Democratic Congressional Campaign Cmte",
            'DNC': "Democratic National Cmte",
            'IRS': "Internal Revenue Service",
            'NEA': "National Education Assn",
            'UPS': "United Parcel Service",
            'USPS': "US Postal Service",
            'ITUNES': "Apple Inc",
            'APPLE': "Apple Inc",
            'TARGET': "Target Corp",
            'BP': "BP",
            'MCDONALD S': "McDonald's Corp",
            'SHELL': "Royal Dutch Shell",
            "DELTA": "Delta Airlines",
            "BANANA BR": "Gap Inc",
            "BANANA REP": "Gap Inc",
            "BANANA REPUBLIC": "Gap Inc",
            "KROGER": "KROGER CO",
            "BAJA FRESH": "Wendy's/Arby's Group",
            "OLIVE GARDEN": "Darden Restaurants",
            "RED LOBSTER": "Darden Restaurants",
            "JIFFY LUBE": "Royal Dutch Shell",
            "FLICKR": "Yahoo! Inc",
            "CHEVRON": "Chevron Corp",
            "PIZZA HUT": "Pizza Hut",
            "TGI FRIDAY S": "Carlson Companies",
            "CHILI S": "Brinker International",
            "STAPLES": "Staples Inc",
            "COSTCO": "Costco Wholesale",
            "PAYPAL": "eBay Inc",
            "GOOGLE": "Google Inc",
    }


    def __init__(self):
        self._get_corps()
        self._count_corp_words()

    @classmethod
    def clean(cls, string):
        string = re.sub("[^A-Z0-9 ]", " ", string.upper())
        return re.sub("\s\s+", " ", string.strip())

    @classmethod
    def blacklist(cls, tx):
        words = tx.split()
        for word in words:
            if word in ["TRANSFER", "DEPOSIT", "CHECK", "INTEREST",
                    "MORTGAGE", "DIVIDEND", "ATM"]:
                return True
            if "DIRECT DEP" in tx:
                return True
            return False

    @classmethod
    def strip_numbers(cls, string):
        return re.sub("[0-9]", "", string)

    @classmethod
    def strip_spaces(cls, string):
        return re.sub("\s", "", string)


    def _get_corps(self):
        corps = {}
        with open(self.TOP_10000_PATH) as fh:
            reader = csv.reader(fh, delimiter="\t")
            for row in itertools.islice(reader, 1, None):
                corp = row[3] or row[1]
                corps[self.clean(corp)] = corp
        self.corps = corps

    def _count_corp_words(self):
        self.matches = {}
        for corp in self.corps:
            parts = corp.split()
            for n in range(0, self.N_GRAPHS):
                for i in range(n, len(parts)):
                    word = " ".join(parts[i - n:i+1])
                    self.matches[word] = self.matches.get(word, [])
                    self.matches[word].append(corp)

    def front_match(self, string):
        string = self.clean(string)
        parts = string.split()
        for i in range(1, len(parts)):
            word = " ".join(parts[0:i])
            if len(self.matches.get(word, [])) == 1:
                return self.matches[word][0]
            elif len(self.abbr.get(word, [])) == 1:
                return self.abbr[word][0]
        return None

    def find_match(self, string):
        string = self.clean(string)
        parts = string.split()
        for i in range(self.N_GRAPHS):
            for j in range(i + 1, len(parts)+1):
                word = " ".join(parts[i:j])
                if word in self.matches:
                    if len(self.matches.get(word, [])) == 1:
                        match = self.matches[word][0]
                        if self.distance(string, match) <= 2:
                            return match
                if word in self.shortcuts:
                    return self.shortcuts[word]
        return None

    @classmethod
    def distance(cls, w1, w2):
        p1 = set(w1.split())
        p2 = set(w2.split())
        return len(p1 ^ p2) / len(p1 & p2)

corp_matcher = CorpMatcher()
