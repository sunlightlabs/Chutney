jQuery.noConflict();
// Define window.console in case we forget to remove a console.log call.
//if (typeof window.console === "undefined") { window.console = { log: function() {} }; }
(function() {
var $ = jQuery;

// CHUTNEY_SERVER_URL, CHUTNEY_MEDIA_URL and CHUTNEY_BRISKET_URL are defined in
// the Django method that assembles the javascripts.
var INFO_SEARCH_URL = CHUTNEY_SERVER_URL + "/org_info.json"
var NAME_SEARCH_URL = CHUTNEY_SERVER_URL + "/names.json"
var API_TIMEOUT = 30 * 1000; // milliseconds

var stylesheets = [
    CHUTNEY_MEDIA_URL + "css/style.css"
];
var COOKIE_NAME = "chutney";
var COOKIE_DAYS = 365;

var SPINNER = "<img src='" + CHUTNEY_MEDIA_URL + "/img/spinner.gif' alt='spinner' />";
var scriptsInserted = false;

/**********************************************************
 * Util
 **********************************************************/
function outboundLink(url, text) {
    return "<a href='" + url + "' target='_blank'>" + text + "</a>";
}
function recipientUrl(recipient) {
    return CHUTNEY_BRISKET_URL + "/politician/" + slugify(recipient.name) + "/" + recipient.id;
}
function organizationUrl(org) {
    return CHUTNEY_BRISKET_URL + "/organization/" + slugify(org.name) + "/" + org.id;
}

function dollarsToFloat(dollars) {
    dollars = dollars.replace(/[\u2012\u2013\u2014\u2015]/g, "-"); // replace literal dashes 
    dollars = dollars.replace(/[^-0-9\.]/g, "");
    return parseFloat(dollars);
}
function floatToDollars(floatVal) {
    var prefix;
    if (floatVal < 0) {
        prefix = "&ndash;$";
    } else {
        prefix = "$";
    }
    var parts = /(\d+)\.(\d+)/.exec(Math.abs(floatVal).toFixed(2));
    var intVal = parts[1]; 
    var dec = intVal.length < 5 ? "." + parts[2] : "";
    var commify = /(\d+)(\d{3})/;
    while (commify.test(intVal)) {
        intVal = intVal.replace(commify, '$1' + ',' + '$2');
    }
    return [prefix, intVal, dec].join("");
}
function slugify(string) {
    return string.trim().toLowerCase().replace(/[^-a-z0-9]/g, '-');
}
function clean(string) {
    // normalize to all upper-case, symbols replaced with spaces, multi-spaces
    // replaced with single spaces.
    return string.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function closeIcon(callback) {
    return $(document.createElement("a")).attr({
            "style": "height: 18px; position: absolute; right: 0.3em; top: 0.3em;",
            "role": "button",
            "unselectable": "on",
            "href": "javascript:void(0)"
        }).append($(document.createElement("span")).attr({
            "class": "ui-icon ui-icon-closethick"
        })).bind("click", function() { callback(); return false; });
}
function popupDiv(contents, offsetParent, parent, left, top) {
    $(parent).append(contents);
    var offset = $(offsetParent).offset();
    var newOffset = {
        left: Math.max(50, offset.left + left),
        top: offset.top + top
    };
    $(contents).offset(newOffset);
    $(contents).offset(newOffset); // Chrome/safari bug; must do this twice
    $(contents).hide();
    $(contents).slideDown();
}

// IE lacks "trim"
if (typeof String.trim === "undefined") {
    String.prototype.trim = function () {
        return this.replace(/^\s*/, "").replace(/\s*$/, "");
    }
}

var PARTY_COLORS = {"Republicans": "#E60002", "Democrats": "#186582", "Other": "#DCDDDE"};
function minipie(div, data, large) {
    // data should be a mapping of { party: amount }

    // check to make sure it isn't empty.
    var empty = true;
    for (var party in PARTY_COLORS) {
        if (data[party]) {
            empty = false;
            break;
        }
    }
    if (empty) {
        return;
    }

    var r = Raphael(div);
    var slices = []
    $.each(PARTY_COLORS, function(key, color) {
        slices.push({
            'color': color,
            // without a minimum value, things get funny
            'value': data[key] ? data[key] : 0.01,
            'name': key
        });
    });
    slices.sort(function(a, b) { return b.value - a.value });
    var values = [];
    var colors = [];
    var names = [];
    var sum = 0;
    $.each(slices, function(i, s) {
        values.push(s.value);
        colors.push(s.color);
        names.push(s.name);
        sum += s.value;
    });

    var lbl = undefined;
    if (large) {
        pie = r.g.piechart(65, 65, 50, values, {
            colors: colors,
            strokewidth: 0,
            legend: names,
            legendpos: 'east'
        });
    } else {
        pie = r.g.piechart(20, 20, 17, values, {
            colors: colors,
            strokewidth: 0
        });
    }
    pie.hover(function() {
        this.sector.stop();
        if (large) {
            this.sector.scale(1.1, 1.1, this.cx, this.cy);
            lbl = r.text(65, 130, (Math.round(this.value.value / sum * 1000) / 10) + '%');
        } else {
            this.sector.scale(1.2, 1.2, this.cx, this.cy);
            lbl = r.text(30, 50, floatToDollars(this.value.value));
        }
        lbl.attr({"font-weight": 800, "font-size": "12px"});
        lbl.show();
    }, function() {
        this.sector.animate({scale: [1, 1, this.cx, this.cy]}, 500, "bounce");
        lbl.hide();
    });
    pie.click(function() {
        lbl.hide();
    });
}

/*
* Compile a list of parsed transaction names.  Query the chutney API to get
* corp names. 
*
* Arguments:
*   queryNames: an array of names to query
*   successCallback(orgs, queryNameToOrgName): a function called on success.
*       `orgs` is a mapping of {orgName: Org object}
*       `queryNameToOrgName` is a mapping of
*           { given query name: resolved orgName }
*   errorCallback: function called on timeout
*   fuzzy: if '0', will do exact name searches.  If '1' or undefined, do fuzzy
*          name searches.
*/
function queryApi(queryNames, successCallback, errorCallback, fuzzy) {
    // Other than timeouts, we can't get any indication that a JSONP call has
    // failed.  Set up a timeout and present an error dialog if we go over.
    var jsonError = setTimeout(errorCallback, API_TIMEOUT);

    $.getJSON(INFO_SEARCH_URL + "?callback=?", {
            'q': queryNames.join(","), 
            'fuzzy': fuzzy == undefined ? '1' : fuzzy
        },
        function(data) {
            clearTimeout(jsonError);
            var orgs = {};
            var queryNameToOrgName = {};
            var txnameToOrgName = {};
            for (var i = 0; i < queryNames.length; i++) {
                var qname = queryNames[i];
                var corp = data[qname];
                var orgName = corp ? corp.info.name : qname;
                if (orgs[orgName] == undefined) {
                    orgs[orgName] = new Org(corp);
                }
                queryNameToOrgName[qname] = orgName;
            }
            successCallback(orgs, queryNameToOrgName);
        }
    );
}
/***************************************************************
* Transaction and organization objects
****************************************************************/
function Tx(name, amount, date, orig, order) {
    this.name = name;
    this.amount = Math.abs(amount);
    this.date = date;
    this.orig = orig;
    this.order = order;
}
var OrgInstanceCount = 0;
function Org(corp) {
    this.corp = corp;
    this.txs = [];
    this.txNames = [];
    this.amount = 0;
    this.uniqueClass = "org-" + OrgInstanceCount;
    OrgInstanceCount += 1;
}
Org.prototype = {
    addTxs: function(txs) {
        for (var i = 0; i < txs.length; i++) {
            this.txs.push(txs[i]);
            this.amount += txs[i].amount;
            if ($.inArray(txs[i].name, this.txNames) == -1) {
                this.txNames.push(txs[i].name);
            }
        }
    }
}

/************************************************************
* Detecting and parsing transactions
*************************************************************/

function ignorable(tx_string) {
    if (tx_string.search(/(^|\s)(TRANSFER)(?=$|\s)/gi) != -1) {
        return true;
    }
    return false;
}

function cleanTxName(orig) {
    // Take a typical ugly transaction string, and turn it into a few words
    // that are likely to match the corporation name.
    // 0. Early outs for things we shouldn't bother with.
    if (ignorable(orig)) {
        return null;
    }
    var string = orig;
    // 1. Remove HTML tags
    var tmp = document.createElement("div");
    tmp.innerHTML = string;
    string = tmp.textContent||tmp.innerText;

    // 2. Replace special characters and numbers with spaces
    string = string.replace(/[^-A-Z\. ]/gi, ' ');
   // only get rid of .'s if they aren't part of URLs
    string = string.replace(/\.(?!(com|org|net))/gi, ' ');

    // 3. Remove stop words.
    string = string.replace(/(^|\s)(ACCT|AUTH|AUTOMATED|CHECK CARD|CHECKCARD|DEBIT CARD|DEBITCARD|DEBIT|DEP|DEPOSIT|DES|ID|INST|ONLINE|POS|PURCHASE|STATEMENT NAME|TX|VISA|WITHDRAW|WITHDRAWL|WITHDRWL|WITHDRAWAL|WWW|XFER)(?=$|\s)/gi, "");

    // 4. Remove extraneous whitespace.
    string = string.trim().replace(/\s+/g, ' ');

    // 5. Keep only the first couple of words, and make the cases nice.
    var parts = string.split(' ');
    var result = "";
    for (var i = 0; i < parts.length && result.length < 14; i++) {
        if (parts[i].length > 1 
                && result.search(parts[i]) == -1
                && parts[i].search(/^TH$/) == -1) {
            var word;
            if (parts[i].search(/\./) != -1 || parts[i].search(/^(of|the|in|to)$/g) != -1) {
                // all lower case -- URLs or small words
                word = parts[i].toLowerCase();
            } else if (parts[i].length <= 3 && parts[i].search(/^(INC)$/g) == -1) {
                // all upper case -- acronyms
                word = parts[i].toUpperCase();
            } else {
                // initial capitals
                word = parts[i].substring(0, 1).toUpperCase() + parts[i].substring(1).toLowerCase();
            }
            result += " " + word;
        }
    }
    string = result.trim();
    return string;
}
function autoDetectTxs() {
    // Look through the page and try to find any transactions that might appear
    // there.  Assume that transactions will be found in <tr>'s, with one row
    // per transaction, and a date, amount, and description in <td>'s contained
    // within the <tr>.  Read the source for all the nitty-gritty decision
    // rules.
    var txParams = [];
    // Parse all frames if we are in a frameset.
    var docs = [window.document];
    if (window.frames && window.frames.length > 0) {
        for (var i = 0; i < window.frames.length; i++) {
            try {
                docs.push(window.frames[i].document);
            } catch (error) {}
        }
    }

    $(docs).find('table').each(function() {
        var descIndex = $(this).find('tr:has(th),tr:first-child').eq(0).children(':contains(Description)').index();
        $(this).find("tr").each(function(index) {
            var params = {};
            $(this).children("td").each(function() {
                var text = $(this).text().replace(/<[\w\/]+>/, "").trim();
                if (text.length > 200) {
                    return;
                }
                // Amounts: They either have a "$" symbol, and contain no letters,
                // or follow a %f.02 pattern.
                if ((text.search(/\$/) != -1 || text.search(/(^|[^\.])\d+\.\d\d($|\s)/) != -1)
                         && text.search(/a-z/i) == -1 && text != '$') {
                    var f = dollarsToFloat(text);
                    if (params.amount == undefined || f < params.amount) {
                        params.amount = f;
                    }
                    return;
                }
                // Dates: they either contain a textual month name, or are composed
                // only of numbers in valid date ranges and joining chars such as
                // "-" and "/".
                var pot_date;
                if (text.search(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i) != -1 && 
                            text.replace(/\s/g, "").length <= "September30,2010".length) {
                    pot_date = text;
                } else if (text.search(/[^-0-9\/\s]/) == -1 && 
                            text.replace(/[^0-9]/g, "").length <= "20100530".length) {
                    pot_date = text;
                }
                if (pot_date) {
                    // Loop through numbers, and ensure that each one present is in
                    // a valid range.
                    var parts = pot_date.split(/[^0-9]/);
                    var badNum = false;
                    var numCount = 0;
                    for (var i = 0; i < parts.length; i++) {
                        try {
                            var num = parseInt(parts[i], 10); // force base-10, otherwise zero-prefixed days will be assumed to be octal
                            if (num < 1 || (num > 31 && num < 1980) || (num > 2100)) {
                                badNum = true;
                                break;
                            } else if (!isNaN(num)) {
                                numCount += 1;
                            }
                        } catch(err) {
                            continue;
                        }
                    }
                    if (!badNum && numCount > 0) {
                        var trimmed = text.trim();
                        if (trimmed) {
                            params.date = trimmed;
                        }
                    }
                    return;
                }
                // Transaction strings: They're between 5 and 100 characters long,
                // and (contain at least one number OR they're in a field with class
                // 'desc' OR they're in a column with a title containing the word
                // 'Description') and contain at least one character
                var $this = $(this);
                var textOptions = [text, $this.attr("title")];
                for (var i = 0; i < textOptions.length; i++) {
                    var str = textOptions[i];
                    if (str.length > 5 && str.length < 100 && (str.search(/[0-9]/) != -1 || $this.hasClass('desc') || $this.index() == descIndex) && str.search(/[a-zA-Z]/) != -1) {
                        params.orig = str;
                        return;
                    }
                }
            });
            if (params.date && params.amount && params.orig) {
                params.name = cleanTxName(params.orig);
                if (params.name) {
                    txParams.push(params);
                }
            }
        });
    });
    return txParams;
}



/************************************************************************
* Chutney UI
*************************************************************************/
var chutney = {
    txdata: {},
    /*
    *  Load necessary javascript and css
    */
    start: function() {
        // Load css
        if (!scriptsInserted) {
            var time = (new Date()).getTime();
            var head = document.getElementsByTagName("head")[0];
            for (var i = 0; i < stylesheets.length; i++) {
                var css = document.createElement("link");
                css.rel = "stylesheet";
                css.type = "text/css";
                css.href = stylesheets[i] + "?" + time;
                css.media = "all";
                head.appendChild(css);
            }
            scriptsInserted = true;
        }

        if (document.location.href.indexOf(CHUTNEY_SERVER_URL) != -1 && document.location.href.indexOf('debug') == -1) {
            $("<div class='chutney-dialog chutney-error' style='width: 400px; display: none;'>")
                .html("<h1>Chutney bookmarklet</h1><p>This is a bookmarklet, not a link &ndash; " +
                      "to use it, drag that " +
                      "'chutney' up to your bookmarks toolbar, or " +
                      "right-click on it and choose \"Bookmark " +
                      "this\".</p><br /><p>After adding the bookmarklet, go to a " +
                      "site with bank transactions and click on it, and you'll " +
                      "see what those transactions are influencing!</p>" +
                      "<div class='chutney-close'>Got it</div>")
                .appendTo(document.body)
                .overlay({
                    close: '.chutney-close',
                    mask: {
                        color: '#2b2922',
                        loadSpeed: 200,
                        opacity: 0.9
                    },
                    oneInstance: false,
                    fixed: false,
                    load: true
                });
            return;
        } else {
            chutney.run();
            }
    },
    run: function() {
        // parse transactions before any mucking with the DOM
        chutney.parseTxs();
        
        // Commence DOM mucking.
        chutney.setUpHtml();
        if (chutney.txdata.txs.length == 0) {
            // No transactions found -- display message then exit.
            chutney.div.overlay().close();
            setTimeout(function() {
                $("<div class='chutney-dialog chutney-error' style='width: 400px; display: none;'>")
                    .html("<h1>No transactions found</h1><p>Sorry, we couldn't find any transactions on this page.</p><div class='chutney-close'>Shucks</div>")
                    .appendTo(document.body)
                    .overlay({
                        close: '.chutney-close',
                        mask: {
                            color: '#2b2922',
                            loadSpeed: 200,
                            opacity: 0.9
                        },
                        oneInstance: false,
                        fixed: false,
                        load: true
                    })
            }, 500);
            return;
        } 
        chutney.recipe();
        // Get names for the API query -- map txnames to corp names 
        var queryNameToTxName = {};
        // txnames that have been overridden to have no match.
        var blankedTxNames = [];
        var queryNames = [];
        for (var txname in chutney.txdata.txnames) {
            var qname = chutney.getOverride(txname);
            if (qname) {
                queryNameToTxName[qname] = txname;
                queryNames.push(qname);
            } else {
                blankedTxNames.push(txname);
            }
        }
        queryApi(queryNames,
            function(orgs, queryNameToOrgName) {
                // Success!
                $.each(queryNameToOrgName, function(queryName, orgName) {
                    var txname = queryNameToTxName[queryName];
                    orgs[orgName].addTxs(chutney.txdata.txnames[txname]);
                });
                // add explicit blanks
                $.each(blankedTxNames, function(i, txname) {
                    orgs[txname] = new Org();
                    orgs[txname].addTxs(chutney.txdata.txnames[txname]);
                });

                chutney.txdata.orgs = orgs;
                chutney.recipeDone = true; // stop the blending
                $(".chutney-loading").hide();
                $(".chutney-content").show();
                chutney.drawTotals();
                chutney.drawTxs();
            }, 
            chutney.apiTimeout
        );
    },
    apiTimeout: function() {
        // Error -- timeout                
        chutney.recipeDone = true;
        chutney.div.overlay().close();
        setTimeout(function() {
            var div = $("<div class='chutney-dialog chutney-error' style='display: none; width: 400px;'>");
            div.html("<p>Error communicating with server.</p><div class='chutney-close'>Got it</div>")
            .appendTo(document.body)
            .overlay({
                close: '.chutney-close',
                mask: {
                    color: '#2b2922',
                    loadSpeed: 200,
                    opacity: 0.9
                },
                oneInstance: false,
                fixed: false,
                load: true
            });
        }, 500);
    },            
    /*
    *  Create the overlay in which we will display things
    */
    setUpHtml: function() {
        // A queue of functions to execute after we've loaded everything we
        // need to (e.g. to operate on DOM elements once they've been loaded,
        // such as charts)
        chutney.postLoadQueue = [];
        // frameset hack -- remove framesets and add body.
        if ($("frameset").length > 0) {
            chutney.frameset = $("html").children("frameset").remove();
            document.body = document.createElement("body");
            $("html").append(
                  $(document.body).html("&nbsp;").attr("class", "chutney")
            );
            $("html").css("overflow", "auto");
        }
        if (chutney.div == undefined) {
            chutney.div = $(["<div id='chutney' class='chutney-dialog' style='display: none; width: 950px; min-height: 500px;'>",
                "<div class='chutney-loading'>", SPINNER, "</div>",
                "<div class='chutney-content' style='display: none;'>",
                    "<div id='chutneyHeader'>",
                        "<div id='headerDetails'>",
                            "<a href='javascript:void(0)' class='chutney-close'>Close</a>",
                            "<span class='chutney-header-text'><span class='chutney-header-nonlink'>See a problem? Help us out by </span><a href='javascript:void(0)' onclick='chutney.debugMessage();' class='chutney-scrape'> reporting it now.</a></span>",
                        "</div>",
                        "<h1>Checking Influence</h1>",
                        "<div class='clear'></div>",
                    "</div>",
                    
                    "<div class='chutney-main-content'>",
                        "<div id='chutney-feature'>",
                            "<div id='chutneyDescription'>",
                                "<p class='chutney-about'>Checking Influence is based off of ",
                                	outboundLink("http://influenceexplorer.com", "Influence Explorer"),
                                	" and is a project of the ",
                                	outboundLink("http://sunlightfoundation.com", "Sunlight Foundation"),
                                	". All figures based off of the 2010 election cycle. For more information, see the ",
                                	outboundLink("http://checking.influenceexplorer.com", "Checking Influence home page"),
                                	".",
                                "</p>",
                            "</div>",
                            "<div id='chutneyChart'>",
                                "<h3>Total party donations weighted by your purchase amounts</h3>",
                                "<p class='chutney-about' id='chutney-chartAbout'></p>",
                                "<div class='chutney-party-breakdown-large' id='partyorg-overall'></div>",
                            "</div>",
                            "<div class='clear'></div>",
                        "</div>",
                        "<div id='chutney_mainContent'>",
                        "<h2>Your Transactions (<span class='chutney-start-date'></span> &ndash; ", 
                                                "<span class='chutney-end-date'></span>)</h2>",
                        "<div class='chutney-viewmode'><span id='filterTitle'>View</span><ul>",
                            "<li>",
                                "<input type='radio' class='radio' name='viewmode' id='chutney_viewmode_matched' ",
                                    " onclick='chutney.setViewMode();' checked />",
                                "<label for='chutney_viewmode_matched'>Matching Transactions ",
                                    "<span class='percent'>(<span class='chutney-matched-percentage'>0</span>%)</span>",
                                "</label>",
                            "</li><li>",
                                "<input type='radio' class='radio' name='viewmode' id='chutney_viewmode_unmatched' ",
                                    " onclick='chutney.setViewMode();' />",
                                "<label for='chutney_viewmode_unmatched'>Non-Matching Transactions ",
                                    "<span class='percent'>(<span class='chutney-unmatched-percentage'>0</span>%)</span>",
                                "</label>",
                            "</li><li>",
                                "<input type='radio' class='radio' name='viewmode' id='chutney_viewmode_all' ",
                                    " onclick='chutney.setViewMode();' />",
                                "<label for='chutney_viewmode_all'>All</label>",
                            "</li></ul>",
                            "<div class='clear'></div>",
                        "</div>",
                        "<div class='chutney-transactions'></div>",
                    "</div>",
                    "</div>",
                    "<div class='chutney-message'></div>",
                "</div>",
                "<div id='chutney-footer'>",
                    "<a href='javascript:void(0)' class='chutney-close'>Close</a>",
                    "<div class='clear'></div>",
                "</div>",
            "</div>"].join("")).appendTo(document.body);
            // hack to hide other things that may be covering up our dialog
            $('[style*=z-index]').not('#chutney,#exposeMask').each(function() {
                var $this = $(this);
                if (parseInt($this.css('z-index')) > 9990) {
                    $this.css('z-index', 9990);
                }
            })
            /* enable debugging */
            var debug = chutney.div.find('.chutney-header-text');
            CHUTNEY_DEBUG || debug.remove();
        } else {
            $('#chutney').removeData('overlay');
        }
        $(window).scrollTop(0);
        if ($.browser.mozilla && chutney.frameset) {
            // hack to work around firefox issue
            var overlayDiv = $('<div>').css({'top': '0', 'width': '100%', 'height': '100%', 'overflow': 'auto', 'display': 'none'});
            $('body').append(overlayDiv);
            chutney.div.remove().appendTo(overlayDiv);
            chutney.div.css({'display': 'block', 'margin-left': 'auto', 'margin-right': 'auto', 'margin-top': '20px', 'margin-bottom': '20px'})
            $('body').css('height', '100%');
        } else {
            var overlayDiv = chutney.div;
        }
        overlayDiv.overlay({
            onClose: function() {
                $('#exposeMask').unbind('click.closeDiv');
                if (chutney.frameset) {
                    // rather than trying to rebuild a frameset, just
                    // reload the page on close.
                    location.reload(true);
                }
            },
            close: '.chutney-close',
            closeOnClick: false,
            mask: {
                color: '#2b2922',
                loadSpeed: 200,
                opacity: 0.9
            },
            oneInstance: false,
            fixed: false,
            load: true
        });
        $('#exposeMask').bind('click.closeDiv', function() { overlayDiv.overlay().close(); });
        
        // part 2 of firefox hack
        if ($.browser.mozilla && chutney.frameset) {
            overlayDiv.css('top', 0);
            var mask = $('#exposeMask');
            if (mask.height() < chutney.div.height()) {
                mask.addClass('chutney-height-hack');
            }
        }
    },

    /*
    * Persist the user-defined overrides.
    */
    getOverride: function(txName) {
        if (chutney._overrides == undefined) {
            chutney._readOverridesCookie();
        }
        var ov = chutney._overrides[txName];
        return ov != undefined ? ov : txName;
    },
    setOverride: function(txName, overrideName) {
        if (!overrideName) {
            chutney._overrides[txName] = "";
        } else {
            chutney._overrides[txName] = overrideName;
        }
        chutney._writeOverridesCookie();
    },
    _readOverridesCookie: function() {
        chutney._overrides = {};
        var cookieData = $.cookie(COOKIE_NAME);
        if (cookieData) {
            var attr = $.cookie(COOKIE_NAME).split(";");
            for (var i = 0; i < attr.length; i++) {
                var parts = attr[i].split("=");
                var a = unescape(parts[0]);
                var b = unescape(parts[1]);
                chutney._overrides[a] = b;
            }
            // refresh cookie
            chutney._writeOverridesCookie();
        }
    },
    _writeOverridesCookie: function() {
        var escaped = [];
        for (var name in chutney._overrides) {
            escaped.push(escape(name) + "=" + escape(chutney._overrides[name]));
        }
        $.cookie(COOKIE_NAME, escaped.join(";"), { expires: COOKIE_DAYS });
    },

    /*
    *  Pull transactions out of the current page; store them in chutney.txdata.
    */
    parseTxs: function() {
        var txdata = chutney.txdata;
        txdata.txs = [];
        if (window.location.href.search(/mint\.com/) != -1 ||
                window.location.href.search(/mint\.html/) != -1) {
            // Special case: mint.com.  Use mint's parsed strings rather than ours.
            $("#transaction-list-body > tr").each(function(index) {
                var description = $(this).children("td[title]");
                if (ignorable(description.attr("title"))) {
                    return;
                }
                txdata.txs.push(new Tx( 
                    description.text(),
                    dollarsToFloat($(this).children("td.money").text()),
                    $(this).children("td.date").text(),
                    description.attr("title"),
                    index
                ));
            });
        } else if (window.location.href.search(/bankofamerica\.com/) != -1 && 
                window.desc != undefined && window.collapseAlt != undefined) {
            // Special case: bankofamerica.com.  They give us global vars "desc"
            // and "collapseAlt" which we can use instead of the more brittle
            // parsing.
            var cleanDate = function(str) {
                if (str.search([0-9]) != -1) {
                    return str.trim();
                } else {
                    return "";
                }
            };
            for (var i = 0; i < desc.length; i++) {
                var name = cleanTxName(desc[i]);
                if (name != null) {
                    txdata.txs.push(new Tx(
                        name,
                        dollarsToFloat(collapseAlt[i]),
                        // still have to parse for dates though
                        cleanDate($("#row" + i + " td:eq(2)").text()),
                        desc[i],
                        i
                    ));
                }
            }
        } else {
            // Otherwise, attempt to auto-detect all transactions in the page.
            var txParams = autoDetectTxs();
            for (var i = 0; i < txParams.length; i++) {
                txdata.txs.push(new Tx(
                    txParams[i].name,
                    txParams[i].amount,
                    txParams[i].date,
                    txParams[i].orig,
                    i
                ));
            }
        }
        // Group transactions by name.
        txdata.txnames = {};
        $.each(txdata.txs, function(i, tx) {
            if (typeof txdata.txnames[tx.name] == "undefined") {
                txdata.txnames[tx.name] = [tx];
            } else {
                txdata.txnames[tx.name].push(tx);
            }
        });
    },
    /**
     * Redraw and display the whole transaction table.
     */
    drawTxs: function() {
        $(".chutney-tx-tooltip").remove();
        $(".chutney-editor").remove();
        var corps = chutney.sortedOrgNames();
        var table = $(document.createElement("table")).attr({
            'cellspacing': 0,
            'class': 'chutney-transactions'
        });
        var sortClass = ' chutney-sort-' + (chutney.asc > 0 ? 'asc': 'desc');
        table.append(["<tr><th></th>",
                     "<th class='chutney-sort", chutney.sortBy == 'name' ? sortClass : '',
                        "' onclick='chutney.sortTransactions(\"name\"); return false;'>Name of Transaction</th>",
                     "<th class='chutney-sort", chutney.sortBy == 'match' ? sortClass : '',
                        "' onclick='chutney.sortTransactions(\"match\"); return false;'>Matching organization</th>",
                     "<th class='chutney-sort", chutney.sortBy == 'amount' ? sortClass : '',
                        "' onclick='chutney.sortTransactions(\"amount\"); return false;'>Amount</th>",
                    "</tr>"].join(""));
        chutney.totalPb = {};
        chutney.sums = {'matched': 0, 'total': 0};
        $.each(corps, function(i, orgName) {
            table.append(chutney.buildTxRow(orgName));
        });
        
        chutney.postLoadQueue.push(function() {
            $('#partyorg-overall').html('');
            minipie('partyorg-overall', chutney.totalPb, true);
        });
        
        chutney.div.find('.chutney-main-content #chutney-chartAbout').html(
            'Checking Influence identified political activity for ' + floatToDollars(chutney.sums['matched']) + ' out of the ' + floatToDollars(chutney.sums['total']) + ' listed on your bank statement.'
        );
                        
        $(".chutney-transactions").html(table);
        chutney.setViewMode();
        for (var i = 0; i < chutney.postLoadQueue.length; i++) {
            chutney.postLoadQueue[i]();
        }
        chutney.postLoadQueue = [];

    },
    /**
     * Assemble a single row, representing all transactions for a given org.
     */
    buildTxRow: function(orgName) {
        var org = chutney.txdata.orgs[orgName];


        // assemble transaction name parts
        var tx_names = org.txNames.join(", ");
        var tx_desc_td = ["<td class='chutney-name secondColumn' title='Click to see transaction details'>",
                            "<a href='javascript:void(0)'><span class='transactionName'>",
                                tx_names,"</span>", "<span class='transactionNumber'>", org.txs.length, " transaction",
                                                org.txs.length > 1 ? "s" : "</span>",
                            
                            "<span class='ui-icon ui-icon-plus'></span>",
                            "</a>", 
                          "</td>"].join("");
        var tx_amt_td = ["<td class='chutney-amount fourthColumn'>", floatToDollars(org.amount), "</td>"].join("");
        var tx_edit_link = ["<a class='chutney-editlink' href='javascript:void(0)' ",
                                "onclick='chutney.openEditor(this, \"", 
                                    escape(orgName), "\"); return false;'>edit</a>",].join("");
        // build transaction expansion click thing
        var tooltipTriggerClass = "chutney-tooltip-" + slugify(orgName);
        chutney.postLoadQueue.push(function() {
            $("." + tooltipTriggerClass + " td:eq(1)").click(function() {
                $(".chutney-tx-tooltip").remove();
                var tx_tooltip = $(document.createElement("div")).attr("class", "chutney-tx-tooltip").append(
                        closeIcon(function() { $(".chutney-tx-tooltip").remove(); }),
                        chutney.orgTxTable(org)
                );
                popupDiv(tx_tooltip, $(this), chutney.div, 0, 25);
            });
        });

        var out;
        if (org.corp) {
            // Matched organization
            var org_url = organizationUrl(org.corp.info);
            var issues_list = org.corp.issues_lobbied_for.join(", ");
            var recipient_links = [];
            for (var i = 0; i < Math.min(org.corp.recipients.length, 4); i++) {
                recipient_links.push(outboundLink(recipientUrl(org.corp.recipients[i]), org.corp.recipients[i].name));
            }
            if (org.corp.recipients.length > recipient_links.length) {
                recipient_links.push(outboundLink(org_url, "..."));
            }
            var split = recipient_links.length / 2;
            var recipients_list = recipient_links.splice(0, recipient_links.length / 2).join(", ") +
                    "<br />" + recipient_links.join(", ");

            var pb = {};
            var totalGiven = 0;
            for (var party in org.corp.party_breakdown) {
                pb[party] = Math.round(parseFloat(org.corp.party_breakdown[party][1]));
                totalGiven += pb[party];
                
                var totalVal = pb[party] * org.amount;
                chutney.totalPb[party] ? chutney.totalPb[party] += totalVal : chutney.totalPb[party] = totalVal;
            }
            var partyBreakdownId = "party" + org.uniqueClass;
            chutney.postLoadQueue.push(function() {
                minipie(partyBreakdownId, pb);
            });
            
            chutney.sums['matched'] += org.amount;
            chutney.sums['total'] += org.amount;

            out = ["<tr class='chutney-tx chutney-matched ", tooltipTriggerClass, " ", org.uniqueClass, " chutney-expanded'>",
                        "<td class='chutney-carat firstColumn'>",
                            "<a href='javascript:void(0)' onclick='chutney.toggleTx(this); return false;'>",
                                "<span class='ui-icon ui-icon-triangle-1-s'></span>",
                            "</a>",
                        "</td>",
                        tx_desc_td,
                        "<td class='chutney-corp-name thirdColumn'>",
                            outboundLink(org_url, org.corp.info.name),
                            "<span class='totalGiven'> Total given: ", floatToDollars(totalGiven), "</span>",
                            tx_edit_link,
                        "</td>",
                        tx_amt_td,
                    "</tr>",
                    "<tr class='chutney-org chutney-matched ", org.uniqueClass, "'>",
                        "<td></td>",
                        "<td class='secondColumn'><h3>Issues this organization has lobbied</h3>", 
                            "<span class='issuesList'>",
                                issues_list ? issues_list : "<div class='chutney-no-activity'>No lobbying activity.</div>", 
                            "</span>",
                        "</td>",
                        "<td class='specialColumn' colspan='2'><h3>Politicians this organization supports</h3>",
                            "<div class='chutney-party-breakdown' id='", partyBreakdownId, "'></div>",
                            "<span class='recipientsList'>",
                                recipients_list,
                            "</span>",
                        "</td>",
                    "</tr>"].join("");
        } else {
            // Unmatched organization
            chutney.sums['total'] += org.amount;
            out = ["<tr class='chutney-tx chutney-unmatched ", tooltipTriggerClass, " ", org.uniqueClass, "'>",
                        "<td class='firstColumn'></td>",
                        tx_desc_td,
                        "<td class='chutney-corp-name thirdColumn'>",
                            "No Matching Organization ",
                            tx_edit_link,
                        "</td>",
                        tx_amt_td,
                   "</tr>"].join("");
        }
        return out;
    },
    /**
     * Sorting of transactions
     */
    sortTransactions: function(sortBy) {
        if (sortBy == chutney.sortBy) {
            chutney.asc = chutney.asc * (-1);
        }
        chutney.sortBy = sortBy;
        chutney.drawTxs();
    },
    sortedOrgNames: function() {
        if (chutney.asc == undefined) {
            chutney.asc = 1;
        }
        if (chutney.sortBy == undefined) {
            chutney.sortBy = 'amount';
        }
        var corps = [];
        var sortFunc = {
            amount: function(a, b) {
                return chutney.asc * (
                    chutney.txdata.orgs[a].amount - chutney.txdata.orgs[b].amount
                );
            },
            name: function(a, b) {
                a = a.toLowerCase();
                b = b.toLowerCase();
                return chutney.asc * (a > b ? 1 : a == b ? 0 : -1);
            },
            match: function(a, b) {
                var ca = chutney.txdata.orgs[a].corp;
                var cb = chutney.txdata.orgs[b].corp;
                a = (ca ? ca.info.name : a ? a : "").toLowerCase();
                b = (cb ? cb.info.name : b ? b : "").toLowerCase();
                return chutney.asc * (a > b ? 1 : a == b ? 0 : -1);
            }
        }[chutney.sortBy];

        $.each(chutney.txdata.orgs, function(key, value) { return corps.push(key); });
        corps.sort(sortFunc);
        return corps;
    },
    /**
     * Change the association between an orgName and a corp.
     */
    editMatch: function(oldOrgName, newOrgName, editor) {
        var orgs = chutney.txdata.orgs;

        var setCorp = function(newOrg) {
            // class names of elements to flash after change
            var flash = [];

            var oldOrg = orgs[oldOrgName];
            delete orgs[oldOrgName];
            if (newOrg == undefined) {
                // Split this org out into individual transaction names.
                $.each(oldOrg.txs, function(i, tx) {
                    if (orgs[tx.name] == undefined) {
                        orgs[tx.name] = new Org();
                    }
                    orgs[tx.name].addTxs([tx]);
                    flash.push(orgs[tx.name].uniqueClass);
                });
            } else {
                // Just rename the corp.
                if (orgs[newOrgName] == undefined) {
                    // keep the old org, it has the tx's already
                    oldOrg.corp = newOrg.corp;
                    orgs[newOrgName] = oldOrg;
                } else {
                    // An org with newOrgName already exists.  Add our tx's to it.
                    orgs[newOrgName].addTxs(oldOrg.txs);
                }
                flash.push(orgs[newOrgName].uniqueClass);
            }
            
            // Persist the new definitions.
            $.each(oldOrg.txs, function(i, tx) {
                chutney.setOverride(tx.name, newOrgName);
            });

            // Refresh UI
            chutney.drawTxs();
            editor.remove();
            chutney.fixOddEvenRows();
            $("#chutney").find(
                $.map(flash, function(c) { return "." + c; }).join(", ") 
            ).effect("highlight", {}, 3000);
        };

        if (newOrgName) {
            queryApi([newOrgName], 
                 function(data) { setCorp(data[newOrgName]); },
                 chutney.apiTimeout,
                 '0'
            );
        } else {
            setCorp(undefined);
        }
    },
    openEditor: function(editLink, escapedName) {
        $(".chutney-editor").remove();
        var orgName = unescape(escapedName);
        var org = chutney.txdata.orgs[orgName];
        var match = org.corp ? org.corp.info.name : "";
        var input = $(document.createElement("input")).attr({
            'type': 'text',
            'class': 'chutney-edit-match',
            'value': match
        });
        var submit = $(document.createElement("input")).attr({
            'type': 'submit',
            'value': 'fix'
        });
        var removeMatch;
        if (org.corp) {
            removeMatch = $(document.createElement("div")).attr({
                }).html(
                    "<span id='chutney-removeTransaction'>Can't find the right match? <a href='#'>Mark as a non-matching transaction.</a></span>"
                );
        } else {
            removeMatch = "";
        }
        var editor = $(document.createElement("div")).attr('class', 'chutney-editor')
            .append(
                // close icon
                closeIcon(function() { $(".chutney-editor").remove(); }),
                // label
                $("<div id='enityEditor'>" ).append(
                    org.txs.length > 1 ? "<span style='font-weight: bold;'>Find the company that fits your transactions best: </span>" : "<span style='font-weight: bold;'>Find the company that fits your transaction best: </span>",
                    // inputs
                    input,
                    submit,
                    removeMatch
                ), 
                chutney.orgTxTable(org)
            );

        popupDiv(editor, $(editLink).parent(), $(editLink).parent(), -100, 20);

        // enclosure used by the remove link and autocomplete
        var doEditMatch = function(val) {
            input.attr("disabled", "disabled")
                 .removeClass("chutney-bad-name")
                 .addClass("ui-autocomplete-loading")
//                 .autocomplete("option", "disabled", true);
            submit.attr("disabled", "disabled");
            chutney.editMatch(orgName, val ? val : input.val(), editor);
        };
        if (removeMatch) {
            removeMatch.bind("click", function() {
                input.val("");
                doEditMatch();
                return false;
            });
        }
        input.autocomplete(
            NAME_SEARCH_URL,
            {
                dataType: 'jsonp',
                parse: function(data) { return $.map(data, function(el) { return {data: [el, el], value: el, result: el } }) },
                minLength: 2,
                // get list of names from chutney server.
                /* source: function(request, responseCallback) {
                    if (request.term.length > 1) {
                        $.getJSON(NAME_SEARCH_URL + "?callback=?", request, function(data) {
                            responseCallback(data);
                            var cleaned = clean(request.term);
                            for (var i = 0; i < data.length; i++) {
                                if (cleaned == clean(data[i])) {
                                    input.removeClass("chutney-bad-name");
                                    submit.removeAttr("disabled");
                                    break;
                                }
                            }
                        });
                    }
                }, */ 
                search: function(event, ui) {
                    input.addClass("chutney-bad-name");
                    submit.attr("disabled", "disabled");
                },
                change: function(event, ui) {
                    if (!$(this).hasClass("chutney-bad-name") 
                            && !$(this).attr("disabled") 
                            && $(this).val().length > 0) {
                        doEditMatch();
                    }
                },
                select: function(event, ui) {
                    doEditMatch(ui.item.value);
                }
            }
        ).bind({
            focus: function(event) {
                if ($(this).hasClass("chutney-bad-name")) {
                    $(this).autocomplete('search', $(this).val());
                }
            }, 
            keyup: function(event) {
                if ($(this).val().length == 0) {
                    $(this).removeClass("chutney-bad-name");
                }
            }
        });
        submit.bind('click', function() { doEditMatch(input.val()) })
    },
    // hack to fix a bug where the dialog displays off screen
    _fixOffset: function () {
        var offset = $(chutney.div).parents(".ui-dialog").offset();
        if (offset.top < 0) {
            $(chutney.div).parents(".ui-dialog").offset({
                top: 0,
                left: offset.left
            });
        }
    },
    /*
    * Engage the waiting user with humor
    */
    recipes: ["chopping &frac12; cup fresh mint&hellip;", 
        "adding a bunch of fresh cilantro&hellip;", 
        "crushing in 1 green chile&hellip;", 
        "1&frac12; tablespoons of onion&hellip;", 
        "3 tablespoons lemon&hellip;", 
        "salt&hellip;", 
        "blending&hellip;"],
    recipe: function() {
        //chutney._fixOffset();
        if (chutney.recipeIndex == undefined || chutney.recipeDone) {
            chutney.recipeIndex = 0;
            $(".chutney-loading").prepend("<ul class='chutney-recipe'></ul>");
        }
        if (!chutney.recipeDone) {
            //$(".chutney-recipe").append("<li>" + chutney.recipes[chutney.recipeIndex] + "</li>");
            if (chutney.recipeIndex + 1 < chutney.recipes.length) {
                chutney.recipeIndex += 1;
            }
            setTimeout(chutney.recipe, 1500);
        } else {
            // reset and exit
            chutney.recipeDone = false;
            return;
        }
    },
    toggleTx: function(el) {
        var thisTr = $(el).parents(".chutney-tx");
        thisTr.toggleClass("chutney-expanded chutney-collapsed")
        var tr = thisTr.next().toggle();
        $(el).find(".ui-icon").toggleClass("ui-icon-triangle-1-s ui-icon-triangle-1-e");
    },
    setViewMode: function() {
        if ($("#chutney_viewmode_matched").is(':checked')) {
            $(".chutney-matched").show();
            $(".chutney-unmatched").hide();
        } else if ($("#chutney_viewmode_unmatched").is(':checked')) {
            $(".chutney-matched").hide();
            $(".chutney-unmatched").show();
        } else {
            $(".chutney-matched").show();
            $(".chutney-unmatched").show();
        }
        // Fix background overlay height to suit our new height.
        $(window).resize();
        chutney.fixOddEvenRows();
    },
    fixOddEvenRows: function() {
        $(".chutney-transactions tr").removeClass("chutney-even");
        $(".chutney-transactions tr.chutney-tx:visible").filter(":even").addClass("chutney-even");
        $(".chutney-transactions tr.chutney-even + tr.chutney-org").addClass("chutney-even");
    },
    orgTxTable: function(org) {
        var table_parts = ["<table>"]
        $.each(org.txs, function(i, tx) {
            table_parts = table_parts.concat(["<tr>",
                "<td>", tx.date, "</td>",
                "<td>", tx.orig, "</td>",
                "<td>", floatToDollars(tx.amount), "</td>",
                "</tr>"]);
        });
        table_parts.push("</table>");
        return table_parts.join("");
    },
    drawTotals: function() {
        var totalMatched = 0;
        var total = 0;
        $.each(chutney.txdata.orgs, function(name, org) {
            if (org.corp) {
                totalMatched += Math.abs(org.amount);
            }
            total += Math.abs(org.amount);
        });
        $(".chutney-matched-percentage").html(Math.round(totalMatched / total * 100));
        $(".chutney-unmatched-percentage").html(Math.round((total - totalMatched) / total * 100));
        $(".chutney-start-date").html(chutney.txdata.txs[chutney.txdata.txs.length - 1].date.trim());
        $(".chutney-end-date").html(chutney.txdata.txs[0].date.trim());


    },
    debugMessage: function() {
        $('#chutney .chutney-message').hide().html([
            "<h2>Report a Problem</h2>",
            "<div class='chutney-message-content'>If Checking Influence either isn't displaying correctly, or ",
                "isn't recognizing transactions you think it should recognize, please consider submitting a bug report to us. ",
                "Please be aware that submitting a bug report will send us both the message you write about your problem ",
                "<em>and</em> a snapshot of your banking site so that we can diagnose the nature of the problem. ",
                "<strong>This means that unlike normal, day-to-day use of Checking Influence, which is completely anonymous, ",
                "use of this bug-reporting feature will submit personally identifiable information to Sunlight staff.</strong> ",
                "We will make an effort to strip account numbers and transaction amounts, but some information such as your ",
                "name will likely remain in the information that is submitted to Sunlight.<br /><br />",
                "If you wish to submit an error report, you may provide further details as well as your contact information in the fields below. ",
                "All form fields are optional.",
                "<form onsubmit='return false;' class='chutney-debug-form'>",
                    "<label for='chutney-debug-email'>Email address:</label>",
                    "<input type='text' id='chutney-debug-email' name='email' />",
                    "<label for='chutney-debug-description'>Description of problem:</label>",
                    "<textarea id='chutney-debug-description' name='description'></textarea>",
                    "<br /><br /><input type='button' value='Submit Report' onclick='chutney.debug();' />",
                "</form>",
            "</div>"
        ].join("")).slideDown('fast');
        $('#chutney .chutney-main-content').slideUp('fast');
        $('#chutney .chutney-header-nonlink').hide();
        $('#chutney .chutney-scrape').hide().after('<a class="chutney-back" href="javascript:void(0)" onclick="chutney.hideDebug()">Back to Transactions</a>')
    },
    hideDebug: function() {
        $('.chutney-scrape,.chutney-main-content,#chutney .chutney-header-nonlink').slideDown('fast');
        $('.chutney-back').remove();
        $('.chutney-message').html('');
    },
    debug: function(doc, callback, main) {
        if (!doc || !doc.location) doc = document;
        
        if (typeof main == 'undefined') main = true;
        
        var page = $(doc).find('html').clone();
        page.find('script[src*=' + CHUTNEY_SERVER_URL + '],link[href*=' + CHUTNEY_SERVER_URL + '],#chutney,#exposeMask').remove();
        
        var pathname = doc.location.pathname;
        if (pathname && pathname.charAt(pathname.length - 1) != '/') {
            var pathparts = pathname.split('/');
            if (pathparts.length > 1) {
                var pathname = pathparts.slice(0, -1).join('/') + '/';
            } else {
                var pathname = pathname + '/';
            }
        }
        var href = doc.location.protocol + '//' + doc.location.host + pathname;
        page.find('head').append('<base href="' + href + '" />');
        
        page.find('link,script').each(function() {
            var $this = $(this);
            var attr = $this.attr('href') ? 'href' : 'src';
            var url = $this.attr(attr);
            
            if (!url) return;
            
            if (url.split('://').length <= 1) {
                if (url.charAt(0) == '/') {
                    $this.attr(attr, doc.location.protocol + '//' + doc.location.host + url);
                } else {
                    $this.attr(attr, href + url);
                }
            }
        })
        
        if (chutney.frameset && chutney.frameset.get(0).ownerDocument == doc) {
            page.find('body').remove();
            page.append(chutney.frameset);
        }
        
        var postMessage = function() {
            var description = chutney.div.find('.chutney-message textarea[name=description]').val();
            if (!description) description = "";
            
            var email = chutney.div.find('.chutney-message input[name=email]').val();
            if (!email) email = "";
            $.post(CHUTNEY_SERVER_URL + '/debug/', {'title': document.title, 'page': '<!DOCTYPE html><html>' + page.html() + '</html>', 'email': email, 'description': description, 'main_page': main}, function(data) {
                if (callback) {
                    callback(data);
                }
                if (main) {
                    $('#chutney .chutney-message-content').html('Your report has been submitted, and has been given a tracking ID of <strong>' + data + '</strong>.')
                }
            })
        }
        
        if (page.find('frame').length > 0) {
            var frameCount = 0;
            var frames = page.find('frame');

            frames.each(function(idx, frame) {
                var iframe = $('<iframe>').css('display', 'none').appendTo($('body'));
                iframe.load(function() {

                    var cd = iframe.get(0).contentDocument;

                    if (cd) {

                        chutney.debug(cd, function(id) {
                            $(frame).attr('src', CHUTNEY_SERVER_URL + '/debug/' + id + '/');
                            
                            frameCount += 1;

                            if (frameCount == frames.length) {
                                postMessage();
                            }
                        }, false)
                    }
                });
                iframe.attr('src', $(frame).attr('src'));
            })
        } else {
            page.find('body').anonymizeNumbers();
            postMessage();
        }
    }
}

window.chutney = chutney;

})();
