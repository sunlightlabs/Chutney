jQuery.noConflict();
//if (typeof window.console === "undefined") { window.console = { log: function() {} }; }
(function() {
var $ = jQuery;

var BRISKET_URL = "http://beta.influenceexplorer.com";
//var SERVER_URL = "http://10.13.34.222:8000";
var SERVER_URL = "http://localhost:8000";
var MEDIA_URL = SERVER_URL + "/media";
var INFO_SEARCH_URL = SERVER_URL + "/org_info.json"
var NAME_SEARCH_URL = SERVER_URL + "/names.json"
var API_TIMEOUT = 30 * 1000; // milliseconds

var stylesheets = [
    "http://ajax.googleapis.com/ajax/libs/jqueryui/1.8/themes/south-street/jquery-ui.css",
    SERVER_URL + "/media/css/style.css"
];
var COOKIE_NAME = "chutney";
var COOKIE_DAYS = 365;

var SPINNER = "<img src='" + MEDIA_URL + "/img/spinner.gif' alt='spinner' />";
var scriptsInserted = false;

/**********************************************************
 * Util
 **********************************************************/
function recipientUrl(recipient) {
    return BRISKET_URL + "/politician/" + slugify(recipient.name) + "/" + recipient.id;
}
function organizationUrl(org) {
    return BRISKET_URL + "/organization/" + slugify(org.name) + "/" + org.id;
}

function dollarsToFloat(dollars) {
    dollars = dollars.replace(/[\u2012\u2013\u2014\u2015]/g, "-"); // replace literal dashes 
    dollars = dollars.replace(/[^-0-9\.]/g, "");
    return parseFloat(dollars);
}
function floatToDollars(float) {
    var prefix;
    if (float < 0) {
        prefix = "&ndash;$";
    } else {
        prefix = "$";
    }
    return prefix + Math.abs(float).toFixed(2);
}
function slugify(string) {
    return string.trim().toLowerCase().replace(/[^-a-z0-9]/g, '-');
}
function clean(string) {
    // normalize to all upper-case, symbols replaced with spaces, multi-spaces
    // replaced with single spaces.
    return string.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
// IE lacks "trim"
if (typeof String.trim === "undefined") {
    String.prototype.trim = function () {
        return this.replace(/^\s*/, "").replace(/\s*$/, "");
    }
}

// Largely copied from brisket_charts.js "piechart" implementation
function minipie(div, data, type) {
    var r = Raphael(div);
    var party_colors = {"Republicans": "#E60002", "Democrats": "#186582", "Other": "#DCDDDE"};
    var other_colors = ["#EFCC01", "#F2E388"];
    var slices = [];
    var keys = _.keys(data);
    var total = _(data).chain().values().reduce(0, function(memo, num) {
        return memo + num;
    }).value();

    for (var i = 0; i < keys.length; i++) {
        var key = keys[i];
        var value = data[key];
        var color = (type && type == "party") ? party_colors[key] : other_colors[i];
        var percent = Math.round((value / total) * 100);
        var label = (key || ' ') + ' (' + percent + '%)';
        if (label.length > 1) {
            label = label.substring(0, 1).toUpperCase() + label.substr(1, label.length);
        }
        slices.push({
            value: value,
            label: label,
            color: color
        });
    }

    slices.sort(function(a, b) {
        return b.value - a.value;
    });

    var labels = _.map(slices, function(s){ return s.label });
    var values = _.map(slices, function(s){ return s.value });
    var colors = _.map(slices, function(s){ return s.color });

    var lbl = undefined;

    pie = r.g.piechart(20, 20, 17, values, {
        colors: colors,
        strokewidth: 0
    });
    pie.hover(function() {
        this.sector.stop();
        this.sector.scale(1.2, 1.2, this.cx, this.cy);
        lbl = r.text(30, 50, dollar(this.value.value));
        lbl.attr({"font-weight": 800, "font-size": "12px"});
        lbl.show();

    }, function() {
        this.sector.animate({scale: [1, 1, this.cx, this.cy]}, 500, "bounce");
        lbl.hide();
    });
}
/***************************************************************
* Transaction objects
****************************************************************/
function Tx(name, amount, date, orig, order) {
    this.name = name;
    this.amount = amount;
    this.date = date;
    this.orig = orig;
    this.order = order;
    this.uniqueClass = "id" + order;
}

function mappingIdFor(corp, name) {
    // a mapping ID is a string representing a unique match between a
    // corporation and a transaction string, usable for selectors that want to
    // grab all matching transactions when overriding matches.
    return (corp ? corp.info.id : "unmatched") + slugify(name);
}
function ignorable(tx_string) {
    if (tx_string.search(/(^|\s)(TRANSFER)(?=$|\s)/gi) != -1) {
        return true;
    }
    return false;
}

function cleanTxName(orig) {
    // Take a typical ugly transaction string, nand turn it into a few words
    // that are likely to match the corporation name.
    var string = orig;
    
    // 0. Early outs for things we shouldn't bother with.
    if (ignorable(orig)) {
        return null;
    }
    // 1. Remove HTML tags
    var tmp = document.createElement("div");
    tmp.innerHTML = string;
    string = tmp.textContent||tmp.innerText;

    // 2. Replace special characters and numbers with spaces
    string = string.replace(/[^-A-Z\. ]/gi, ' ');
   // only get rid of .'s if they aren't part of URLs
    string = string.replace(/\.(?!(com|org|net))/gi, ' ');

    // 3. Remove stop words.
    string = string.replace(/(^|\s)(ACCT|AUTH|AUTOMATED|CHECKCARD|DEP|DEPOSIT|DES|ID|INST|ONLINE|POS|PURCHASE|STATEMENT NAME|TX|WITHDRAW|WITHDRAWL|WITHDRWL|WWW|XFER)(?=$|\s)/gi, "");

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
    var docs = [];
    if (window.frames && window.frames.length > 0) {
        for (var i = 0; i < window.frames.length; i++) {
            docs.push(window.frames[i].document);
        }
    } else {
        docs.push(window.document);
    }

    $(docs).find("tr").each(function(index) {
        var params = {};
        $(this).children("td").each(function() {
            var text = $(this).text().replace(/<[\w\/]+>/, "").trim();
            if (text.length > 200) {
                return;
            }
            // Amounts: They have a "$" symbol, and contain no letters, or at
            // least follow a %f.02 pattern.
            if ((text.search(/\$/) != -1 || text.search(/(^|[^\.])\d+\.\d\d($|\s)/) != -1)
                     && text.search(/a-z/i) == -1) {
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
                        var num = parseInt(parts[i]);
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
            // and contain at least one number.
            var textOptions = [text, $(this).attr("title")];
            for (var i = 0; i < textOptions.length; i++) {
                var str = textOptions[i];
                if (str.length > 5 && str.length < 100 && str.search(/[0-9]/) != -1) {
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
    return txParams;
}



/************************************************************************
* Chutney UI
*************************************************************************/
var chutney = {
    txdata: {},
    /*
    *  Load necessary javascript and css, parse transactions, then query API.
    */
    start: function() {
        // TODO Do something special if we are launching from the page where you get the bookmarklet.

        // pull in stylesheets first; give them time to load.
        if (!scriptsInserted) {
            var head = document.getElementsByTagName("head")[0];
            for (var i = 0; i < stylesheets.length; i++) {
                var css = document.createElement("link");
                css.rel = "stylesheet";
                css.type = "text/css";
                css.href = stylesheets[i];
                css.media = "all";
                head.appendChild(css);
            }
            scriptsInserted = true;
        }

        // parse transactions before mucking with DOM
        chutney.parseTransactions();

        // muck with DOM
        chutney.setUpHtml();
        chutney.recipe();
        chutney.queryApi();
    },
    /*
    * Compile a list of parsed transaction names.  Query the chutney API to get
    * corp names.  Display the results.
    */
    queryApi: function() {
        var txdata = chutney.txdata;
        if (txdata.txs.length == 0) {
            return;
        }
        var names = [];
        for (var name in txdata.orginfo) {
            if (name.length > 0) {
                names.push(chutney.nameOrOverride(name));
            }
        }
        // Other than timeouts, we can't get any indication that a JSONP call has
        // failed.  Set up a timeout and present an error dialog if we go over.
        var jsonError = setTimeout(function() {
                chutney.recipeDone = true;
                var div = $(document.createElement("div"));
                div.html("Error communicating with server.");
                div.dialog({
                    buttons: {
                        'Try again': function() {
                            $(this).dialog('close');
                            chutney.start();
                        },
                        'Cancel': function() {
                            $(this).dialog('close');
                        }
                    },
                    modal: true,
                    zIndex: 10000,
                    resizable: false,
                    draggable: false
                });
            }, API_TIMEOUT);
        $.getJSON(INFO_SEARCH_URL + "?callback=?", {'q': names.join(","), 'fuzzy': '1' },
            function(data) {
                clearTimeout(jsonError);
                chutney.recipeDone = true; // stop the blending
                var txdata = chutney.txdata;
                $.each(data, function(name, corp) {
                    txdata.orginfo[chutney.nameOrUnOverride(name)].corp = corp;
                });
                chutney.show();
            }
        );
    },
    /*
    *  Create the overlay that we will display things in
    */
    setUpHtml: function() {
        // A queue of functions to execute after we've loaded everything we need to
        // (e.g. to operate on DOM elements once they've been loaded, such as charts)
        chutney.postLoadQueue = [];
        // frameset hack -- remove framesets and add body.
        if ($("frameset")) {
            chutney.frameset = $("html").children("frameset").remove();
            document.body = document.createElement("body");
            $("html").append(
                $(document.body).html("&nbsp;").css({
                    'overflow': 'auto',
                    'position': 'relative',
                    'height': '100%',
                    'width': '100%',
                    'padding': '0px',
                    'margin': '0px'
                })
            );
            for (var i = 0; i < 100; i++) {
                $(document.body).append("&nbsp;<br />");
            }
        }
        if (chutney.div == undefined) {
            chutney.div = $(document.createElement("div")).attr({'id': "chutney"});
            chutney.div.html([
                "<div class='loading'>", SPINNER, "</div>",
                "<div id='chutney' class='content' style='display: none;'>",
                    "<p class='about'>Some descriptive text and a link back to ",
                        "<a href='http://transparencydata.com'>Transparency Data</a>", 
                        " or <a href='http://beta.influenceexplorer.com'>Influence Explorer</a>",
                    "</p>",
                    "<h2>Your Transactions (<span class='start-date'></span> &ndash;", 
                                            "<span class='end-date'></span>)</h2>",
                    "<div class='viewmode'><h2>View</h2><ul>",
                        "<li>",
                            "<input type='radio' name='viewmode' id='chutney_viewmode_matched' ",
                                " onclick='chutney.setViewMode()' checked />",
                            "<label for='chutney_viewmode_matched'>Matching Transactions ",
                                "(<span class='matchedPercentage'>0</span>%)",
                            "</label>",
                        "</li><li>",
                            "<input type='radio' name='viewmode' id='chutney_viewmode_unmatched' ",
                                " onclick='chutney.setViewMode()' />",
                            "<label for='chutney_viewmode_unmatched'>Non-Matching Transactions ",
                                "(<span class='unmatchedPercentage'>0</span>%)",
                            "</label>",
                        "</li><li>",
                            "<input type='radio' name='viewmode' id='chutney_viewmode_all' ",
                                " onclick='chutney.setViewMode()' />",
                            "<label for='chutney_viewmode_all'>All</label>",
                        "</li></ul>",
                    "</div>",
                    "<div class='transactions'></div>",
                "</div>"].join(""));
            chutney.div.dialog({
                autoOpen: false,
                width: 950,
                minHeight: 500,
                modal: true,
                position: 'top',
                draggable: false,
                resizable: false,
                title: "Chutney",
                close: function() {
                    // rather than trying to rebuild a frameset, just reload the page.
                    if (chutney.frameset) {
                        location.reload(true);
                    }
                }
            });
        }
        if (chutney.txdata.txs.length == 0) {
            $(document.createElement("div"))
                .attr("title", "No transactions found")
                .html("<p>Sorry, we couldn't find any transactions on this page.</p>")
                .dialog({
                    buttons: {
                        shucks: function() {
                            $(this).dialog("close");
                            $(this).remove();
                            chutney.div.dialog("close");
                        }
                    },
                    resizable: false,
                    draggable: false
                });
        } else {
            chutney.div.dialog('open');
            $(window).scrollTop(0);
        }
        if (chutney.frameset) {
            // workaround for firefox scrolling bug
            $("#chutney").css({ height: "100%", scroll: "auto" });
            $("#chutney").append("<br /><br /><br />");
        }
    },
    /*
    * Persist the user-defined overrides as a cookie.
    */
    nameOrOverride: function(txName) {
        if (chutney._overrides == undefined) {
            chutney._readOverridesCookie();
        }
        var ov = chutney._overrides[txName];
        return ov != undefined ? ov : txName;
    },
    nameOrUnOverride: function(name) {
        if (chutney._unOverrides == undefined) {
            chutney._readOverridesCookie();
        }
        var unov = chutney._unOverrides[name];
        return unov != undefined ? unov : name;
    },
    setOverride: function(txName, overrideName) {
        // Remove original reverse match first, in case we are deleting.
        if (!overrideName) {
            var orig = chutney._overrides[txName];
            delete chutney._unOverrides[orig];
            chutney._overrides[txName] = "";
        } else {
            chutney._overrides[txName] = overrideName;
            chutney._unOverrides[overrideName] = txName;
        }
        chutney._writeOverridesCookie();
    },
    _readOverridesCookie: function() {
        chutney._overrides = {};
        chutney._unOverrides = {};
        var cookieData = $.cookie(COOKIE_NAME);
        if (cookieData) {
            var attr = $.cookie(COOKIE_NAME).split(";");
            for (var i = 0; i < attr.length; i++) {
                var parts = attr[i].split("=");
                var a = unescape(parts[0]);
                var b = unescape(parts[1]);
                chutney._overrides[a] = b;
                chutney._unOverrides[b] = a;
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
    *  Pull transactions out of the current page.
    */
    parseTransactions: function() {
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
        } else if (window.location.href.search(/bankofamerica\.com/) != -1) {
            // Special case: bankofamerica.com.  They give us global vars "desc"
            // and "collapseAlt" which we can use instead of the more brittle
            // parsing.
            if (window.desc != undefined && window.collapseAlt != undefined) {
                for (var i = 0; i < desc.length; i++) {
                    var name = cleanTxName(desc[i]);
                    if (name != null) {
                        txdata.txs.push(new Tx(
                            cleanTxName(desc[i]),
                            dollarsToFloat(collapseAlt[i]),
                            $("#row" + i + " td:eq(2)").text().trim(),
                            desc[i],
                            i
                        ));
                    }
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
        // Group transactions by name, and get sum total of them.
        txdata.orginfo = {};
        for (var i = 0; i < txdata.txs.length; i++) {
            var tx = txdata.txs[i];
            if (typeof txdata.orginfo[tx.name] == "undefined") {
                txdata.orginfo[tx.name] = {
                    total: tx.amount,
                    txs: [tx]
                };
            } else {
                txdata.orginfo[tx.name].total += tx.amount;
                txdata.orginfo[tx.name].txs.push(tx);
            }
        }
    },
    drawTxs: function() {
        var corps = chutney.sortedCorps();
        var table = $(document.createElement("table")).attr({
            'cellspacing': 0,
            'class': 'transactions',
        });
        var sortMark = "<span class='ui-icon ui-icon-triangle-2-n-s' style='float: left;'></span>";
        table.append(["<tr><th></th>",
                     "<th onclick='chutney.resortTransactions(\"name\")'>", 
                        chutney.sortBy == 'name' ? sortMark : '', "Name of Transaction</th>",
                     "<th onclick='chutney.resortTransactions(\"match\")'>", 
                        chutney.sortBy == 'match' ? sortMark : '', "Matching organization</th>",
                     "<th onclick='chutney.resortTransactions(\"amount\")'>", 
                        chutney.sortBy == 'amount' ? sortMark : '', 
                        "Amount</th>",
                    "</tr>"].join(""));
        $.each(corps, function(i, name) {
            table.append(chutney.buildTxRow(name));
        });
                        
        $("#chutney .transactions").html(table);
        chutney.setViewMode();
        chutney.doPostLoadQueue();
    },
    resortTransactions: function(sortBy) {
        if (sortBy == chutney.sortBy) {
            chutney.asc = chutney.asc * (-1);
        }
        chutney.sortBy = sortBy;
        chutney.drawTxs();
    },
    sortedCorps: function() {
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
                    chutney.txdata.orginfo[a].total - chutney.txdata.orginfo[b].total
                );
            },
            name: function(a, b) {
                a = a.toLowerCase();
                b = b.toLowerCase();
                return chutney.asc * (a > b ? 1 : a == b ? 0 : -1);
            },
            match: function(a, b) {
                var ca = chutney.txdata.orginfo[a].corp;
                var cb = chutney.txdata.orginfo[b].corp;
                a = (ca ? ca.info.name : a ? a : "").toLowerCase();
                b = (cb ? cb.info.name : b ? b : "").toLowerCase();
                return chutney.asc * (a > b ? 1 : a == b ? 0 : -1);
            }
        }[chutney.sortBy];

        $.each(chutney.txdata.orginfo, function(key, value) { return corps.push(key); });
        corps.sort(sortFunc);
        return corps;
    },
    /*
    * Given a list of transactions from a particular business, build rows to
    * describe the result
    */
    buildTxRow: function(tx_name) {
        var orginfo = chutney.txdata.orginfo[tx_name];
        var corp = orginfo.corp;
        var total_amount = floatToDollars(orginfo.total);

        // build tooltip
        var total_amount_float = 0;
        var tx_tooltip_parts = ["<div class='tx-tooltip'><table>"]
        $.each(orginfo.txs, function(i, tx) {
            tx_tooltip_parts = tx_tooltip_parts.concat(["<tr>",
                "<td>", tx.date, "</td>",
                "<td>", tx.orig, "</td>",
                "<td>", floatToDollars(tx.amount), "</td>",
                "</tr>"]);
        });
        tx_tooltip_parts.push("</table></div>");
        var tx_tooltip = $(tx_tooltip_parts.join(""));
        var tooltipTriggerClass = "tooltip-" + slugify(tx_name);
        chutney.postLoadQueue.push(function() {
            $("." + tooltipTriggerClass + " td:eq(1)").hover(function() {
                var offset = $(this).offset();
                var newOffset = {
                    left: Math.max(50, offset.left),
                    top: offset.top + 30
                };
                //$($(this).children("td")[0]).append(tx_tooltip);
                chutney.div.append(tx_tooltip);
                tx_tooltip.offset(newOffset);
                tx_tooltip.offset(newOffset); // Chrome/safari bug; we have to do this twice
            }, function() {
                $(tx_tooltip).remove();
            });
        });

        var out;
        if (corp) {
            // Matched organization
            var org_url = organizationUrl(corp.info);
            var issues_list = corp.issues_lobbied_for.join(", ");
            var recipient_links = [];
            for (var i = 0; i < Math.min(corp.recipients.length, 4); i++) {
                recipient_links.push("<a href='" + recipientUrl(corp.recipients[i]) + "'>" +
                    corp.recipients[i].name + "</a>");
            }
            if (corp.recipients.length > recipient_links.length) {
                recipient_links.push("<a href='" + org_url + "'>...</a>");
            }
            var split = recipient_links.length / 2;
            var recipients_list = recipient_links.splice(0, recipient_links.length / 2).join(", ") +
                    "<br />" + recipient_links.join(", ");

            var pb = {};
            for (var party in corp.party_breakdown) {
                pb[party] = Math.round(parseFloat(corp.party_breakdown[party][1]));
            }
            var partyBreakdownId = "party" + orginfo.txs[0].uniqueClass;
            chutney.postLoadQueue.push(function() {
                minipie(partyBreakdownId, pb, "party");
            });

            out = ["<tr class='tx matched ", tooltipTriggerClass, "'>",
                        "<td class='caret'>",
                            "<a href='javascript:void(0)' onclick='return chutney.toggleTx(this);'>",
                                "<span class='ui-icon ui-icon-triangle-1-s'></span>",
                            "</a>",
                        "</td>",
                        "<td class='name'>", 
                            tx_name, 
                            " (", orginfo.txs.length, " transaction", orginfo.txs.length > 1 ? "s" : "", ")",
                        "</td>",
                        "<td class='corp-name'>",
                            "<a href='", org_url, "'>", corp.info.name, "</a> ",
                            "<a class='editlink' href='javascript:void(0)' onclick='chutney.openEditor(this, \"", 
                                escape(tx_name), "\");'>edit</a>",
                        "</td>",
                        "<td class='amount'>", total_amount, "</td>",
                    "</tr>",
                    "<tr class='org matched'>",
                        "<td></td>",
                        "<td><b>Issues this organization supports</b><br />", issues_list, "</td>",
                        "<td colspan='2'><b>Politicians this organization supports</b><br />",
                            "<div class='party-breakdown' id='", partyBreakdownId, "'",
                            " onclick='window.location.href=\"", org_url, "\"'></div>",
                            recipients_list,
                        "</td>",
                    "</tr>"].join("");
        } else {
            // Unmatched organization
            out = ["<tr class='tx unmatched ", tooltipTriggerClass, "'>",
                        "<td></td>",
                        "<td class='name'>", 
                            tx_name, 
                            " (", orginfo.txs.length, " transaction", orginfo.txs.length > 1 ? "s" : "", ")",
                        "</td>",
                        "<td class='corp-name'>",
                            "No Matching Organization ",
                            "<a class='editlink' href='javascript:void(0)' onclick='chutney.openEditor(this, \"", 
                                escape(tx_name), "\");'>edit</a>",
                        "</td>",
                        "<td class='amount'>", total_amount, "</td>",
                   "</tr>"].join("");
        }
        return out;
    },
    editMatch: function(txName, newCorp, editor) {
        chutney.setOverride(txName, newCorp);
        var setCorp = function(corp) {
            chutney.txdata.orginfo[txName].corp = corp;
            chutney.drawTxs();
            editor.remove();
        };
        if (newCorp) {
            $.getJSON(INFO_SEARCH_URL + "?callback=?", {q: newCorp, fuzzy: 0},
                function(data) { setCorp(data[newCorp]); }
            );
        } else {
            setCorp(undefined);
        }
    },
    openEditor: function(editLink, escapedName) {
        var tx_name = unescape(escapedName);
        var match;
        if (chutney.txdata.orginfo[tx_name].corp) {
            match = chutney.txdata.orginfo[tx_name].corp.info.name;
        } else {
            match = "";
        }
        var input = $(document.createElement("input")).attr({
            'type': 'text',
            'class': 'edit-match',
            'value': match
        });
        var submit = $(document.createElement("input")).attr({
            'type': 'submit',
            'value': 'fix'
        });
        var removeMatch = $(document.createElement("div")).attr({
                    "style": "text-decoration: underline; cursor: pointer; text-align: center;",
                }).html(
                    "<div style='padding-left: 4em'>" +
                    "<span class='ui-icon ui-icon-trash' style='float: left;'></span>" +
                    "<span style='float: left;'>Remove match</span><br style='clear: both;' /></div>"
                );
        var editor = $(document.createElement("div")).attr('class', 'editor')
            .append(
                // close icon
                $(document.createElement("span")).attr({
                    "class": "ui-icon ui-icon-close",
                    "style": "float: right; cursor: pointer;"
                }).bind("click", function() { $(this).parent().remove() }),
                // label
                "<span class='name'>" + tx_name + "</span>",
                // inputs
                input,
                submit,
                removeMatch
            );
        $(chutney.div).append(editor);

        var doEditMatch = function(val) {
            input.attr("disabled", "disabled")
                 .removeClass("bad-name")
                 .addClass("ui-autocomplete-loading")
                 .autocomplete("option", "disabled", true);
            submit.attr("disabled", "disabled");
            chutney.editMatch(tx_name, val ? val : input.val(), editor);
        };

        removeMatch.bind("click", function() {
            input.val("");
            doEditMatch();
        });
            
        var editLinkOffset = $(editLink).offset();
        var editorOffset = {
            left: Math.max(50, editLinkOffset.left - 150),
            top: editLinkOffset.top + 20
        };
        $(editor).offset(editorOffset);

        input.autocomplete({
            minLength: 2,
            // get list of names from chutney server.
            source: function(request, responseCallback) {
                if (request.term.length > 1) {
                    $.getJSON(NAME_SEARCH_URL + "?callback=?", request, function(data) {
                        responseCallback(data);
                        var cleaned = clean(request.term);
                        for (var i = 0; i < data.length; i++) {
                            if (cleaned == clean(data[i])) {
                                input.removeClass("bad-name");
                                submit.removeAttr("disabled");
                                break;
                            }
                        }
                    });
                }
            }, 
            search: function(event, ui) {
                input.addClass("bad-name");
                submit.attr("disabled", "disabled");
            },
            change: function(event, ui) {
                if (!$(this).hasClass("bad-name") 
                        && !$(this).attr("disabled") 
                        && $(this).val().length > 0) {
                    doEditMatch();
                }
            },
            select: function(event, ui) {
                doEditMatch(ui.item.value);
            }
        }).bind({
            focus: function(event) {
                if ($(this).hasClass("bad-name")) {
                    $(this).autocomplete('search', $(this).val());
                }
            }, 
            keyup: function(event) {
                if ($(this).val().length == 0) {
                    $(this).removeClass("bad-name");
                }
            }
        });
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
        chutney._fixOffset();
        if (chutney.recipeIndex == undefined || chutney.recipeDone) {
            chutney.recipeIndex = 0;
            $("#chutney .loading").prepend("<ul class='recipe'></ul>");
        }
        if (!chutney.recipeDone) {
            $("#chutney .recipe").append("<li>" + chutney.recipes[chutney.recipeIndex] + "</li>");
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
        var tr = $(el).parents(".tx").next().toggle();
        $(el).find(".ui-icon").toggleClass("ui-icon-triangle-1-s ui-icon-triangle-1-e");
    },
    setViewMode: function() {
        if ($("#chutney_viewmode_matched").is(':checked')) {
            $("#chutney .matched").show();
            $("#chutney .unmatched").hide();
        } else if ($("#chutney_viewmode_unmatched").is(':checked')) {
            $("#chutney .matched").hide();
            $("#chutney .unmatched").show();
        } else {
            $("#chutney .matched").show();
            $("#chutney .unmatched").show();
        }
        $("#chutney .transactions tr").removeClass("even");
        $("#chutney .transactions tr.tx:visible").filter(":even").addClass("even");
        $("#chutney .transactions tr.even + tr.org").addClass("even");
    },
    drawTotals: function() {
        var totalMatched = 0;
        var total = 0;
        $.each(chutney.txdata.orginfo, function(name, orginfo) {
            if (orginfo.corp) {
                totalMatched += Math.abs(orginfo.total);
            }
            total += Math.abs(orginfo.total);
        });
        $("#chutney .matchedPercentage").html(Math.round(totalMatched / total * 100));
        $("#chutney .unmatchedPercentage").html(Math.round((total - totalMatched) / total * 100));
        $("#chutney .start-date").html(chutney.txdata.txs[chutney.txdata.txs.length - 1].date.trim());
        $("#chutney .end-date").html(chutney.txdata.txs[0].date.trim());


    },
    /*
    *  Do that UI magic.
    */
    doPostLoadQueue: function() {
        for (var i = 0; i < chutney.postLoadQueue.length; i++) {
            chutney.postLoadQueue[i]();
        }
        chutney.postLoadQueue = [];
    },
    show: function() {
        $("#chutney .loading").hide();
        $("#chutney .content").show();
        chutney.drawTotals();
        chutney.drawTxs();
        chutney._fixOffset(); // one more time...
    }
}

window.chutney = chutney;

})();
