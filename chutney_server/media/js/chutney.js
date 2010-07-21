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
var TxPrototype = {
    setCorp: function(corp) {
        this.corp = corp;
        if (corp != undefined) {
            var pb = this.corp.party_breakdown;
            r = pb.Republicans != undefined ? parseFloat(pb.Republicans[1]) : 0;
            d = pb.Democrats != undefined ? parseFloat(pb.Democrats[1]) : 0;
            o = pb.Other != undefined ? parseFloat(pb.Other[1]) : 0;
            var total = r + d + o;
            // party breakdown proportional to transaction amount (dubious?)
            this.party_breakdown = {
                'Republicans': this.amount * (r / total),
                'Democrats': this.amount * (d / total),
                'Other': this.amount * (o / total)
            };
        } else {
            delete this.party_breakdown;
        }
    },
    getMappingId: function() {
        return mappingIdFor(this.corp, this.name);
    },
    getCorpUrl: function() {
        if (!this.corp) {
            return;
        } else {
            return organizationUrl(this.corp.info);
        }
    },
    getMatchName: function() {
        var override = chutney.overrides[this.name];
        return override != undefined ? override : this.name;
    }
}
function Tx(name, amount, date, orig, order) {
    this.name = name;
    this.amount = amount;
    this.date = date;
    this.orig = orig;
    this.order = order;
    var tx = this;
    this.setCorp();
    this.uniqueClass = "id" + order;
}
Tx.prototype = TxPrototype;

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
        chutney.setUpData();
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
        for (var name in txdata.tx_names) {
            if (chutney.overrides[name] != undefined) {
                if (chutney.overrides[name].length > 0) {
                    names.push(chutney.overrides[name]);
                }
            } else {
                if (name.length > 0) {
                    names.push(name);
                }
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
                txdata.corps = data;
                for (var i = 0; i < chutney.txdata.txs.length; i++) {
                    var tx = txdata.txs[i];
                    if (txdata.corps[tx.getMatchName()] != undefined) {
                        tx.setCorp(txdata.corps[tx.getMatchName()]);
                    }
                }
                chutney.show();
            }
        );
    },
    /*
    * Set up the data structures we will use.
    */
    setUpData: function() {
        if (chutney.txdata == undefined) {
            chutney.txdata = {};
        }
        if (chutney.overrides == undefined) {
            chutney.overrides = {}
            var cookieData = $.cookie(COOKIE_NAME);
            if (cookieData) {
                var attr = $.cookie(COOKIE_NAME).split(";");
                for (var i = 0; i < attr.length; i++) {
                    var parts = attr[i].split("=");
                    chutney.overrides[unescape(parts[0])] = unescape(parts[1]);
                }
                // refresh cookie
                chutney.writeOverridesCookie();
            }

        }
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
            chutney.div.html(
                "<div class='loading'>" + SPINNER + "</div>" +
                "<div id='chutney' class='content' style='display: none;'>" +
                    "<p class='about'>Some descriptive text and a link back to " +
                        "<a href='http://transparencydata.com'>Transparency Data</a>" + 
                        " or <a href='http://beta.influenceexplorer.com'>Influence Explorer</a>" +
                    "</p>" +
                    "<div class='viewmode'>" +
                        "<input type='radio' name='viewmode' id='chutney_viewmode_matched' " +
                            " onclick='chutney.setViewMode()' checked />" +
                        "<label for='chutney_viewmode_matched'>Matching Transactions " +
                            "(<span id='matchedPercentage'>0</span>%)" +
                        "</label>" +
                        "<input type='radio' name='viewmode' id='chutney_viewmode_unmatched' " +
                            " onclick='chutney.setViewMode()' />" +
                        "<label for='chutney_viewmode_unmatched'>Non-Matching Transactions " +
                            "(<span id='unmatchedPercentage'>0</span>%)" +
                        "</label>" +
                        "<input type='radio' name='viewmode' id='chutney_viewmode_all' " +
                            " onclick='chutney.setViewMode()' />" +
                        "<label for='chutney_viewmode_all'>All</label>" +
                    "</div>" +
                    "<div class='transactions'></div>" +
                "</div>");
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
    writeOverridesCookie: function() {
        var escaped = [];
        for (var name in chutney.overrides) {
            escaped.push(escape(name) + "=" + escape(chutney.overrides[name]));
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
        txdata.tx_names = {};
        for (var i = 0; i < txdata.txs.length; i++) {
            var tx = txdata.txs[i];
            if (typeof txdata.tx_names[tx.name] == "undefined") {
                txdata.tx_names[tx.name] = {
                    total: tx.amount,
                    txs: [tx]
                };
            } else {
                txdata.tx_names[tx.name].total += tx.amount;
                txdata.tx_names[tx.name].txs.push(tx);
            }
        }
    },
    drawTxs: function() {
        var table = $(document.createElement("table")).attr({
            'cellspacing': 0,
            'class': 'transactions',
        });
        table.append("<tr><th></th><th>Name of Transaction</th><th>Matching organization</th><th>Amount</th></tr>");
                        
        // sort corp names by amount.
        var corps = [];
        $.each(chutney.txdata.tx_names, function(key, value) { return corps.push(key); });
        corps.sort(function(a, b) {
            return chutney.txdata.tx_names[a].total - chutney.txdata.tx_names[b].total;
        });
        // Add rows to tables
        $.each(corps, function(i, name) {
            table.append(chutney.buildTxRow(name));
        });


        $("#chutney .transactions").html(table);
    },
    /*
    * Given a list of transactions from a particular business, build rows to
    * describe the result
    */
    buildTxRow: function(tx_name) {
        var corp = chutney.txdata.corps[tx_name];
        var tx_list = chutney.txdata.tx_names[tx_name].txs;
        var total_amount = floatToDollars(chutney.txdata.tx_names[tx_name].total);

        // build tooltip
        var total_amount_float = 0;
        var tx_tooltip_parts = ["<div class='tx-tooltip'><table>"]
        $.each(tx_list, function(i, tx) {
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
            $("." + tooltipTriggerClass).hover(function() {
                var offset = $(this).offset();
                var newOffset = {
                    left: Math.max(50, offset.left),
                    top: offset.top + 22
                };
                chutney.div.append(tx_tooltip);
                tx_tooltip.offset(newOffset);
                tx_tooltip.offset(newOffset); // Chrome/safari bug; we have to do this twice
                console.log(tx_tooltip);
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

            var pb = {};
            for (var party in corp.party_breakdown) {
                pb[party] = Math.round(parseFloat(corp.party_breakdown[party][1]));
            }
            var partyBreakdownId = "party" + tx_list[0].uniqueClass;
            chutney.postLoadQueue.push(function() {
                minipie(partyBreakdownId, pb, "party");
            });

            out = ["<tr class='tx matched ", tooltipTriggerClass, "'>",
                        "<td class='caret'> ^ </td>",
                        "<td class='name'>", 
                            tx_name, 
                            " (", tx_list.length, " transaction", tx_list.length > 1 ? "s" : "", ")",
                        "</td>",
                        "<td class='corp-name'>",
                            "<a href='", org_url, "'>", corp.info.name, "</a> ",
                            "<span class='edit' onclick='chutney.edit(\"", escape(tx_name), "\");'>",
                                "edit", 
                            "</span>",
                        "</td>",
                        "<td class='amount'>", total_amount, "</td>",
                    "</tr>",
                    "<tr class='org matched'>",
                        "<td></td>",
                        "<td><b>Issues this organization supports</b><p>", issues_list, "</p></td>",
                        "<td colspan='2'><b>Politicians this organization supports</b><br />",
                            "<div class='party-breakdown' id='", partyBreakdownId, "'></div>",
                            "<p>", recipient_links, "</p>",
                        "</td>",
                    "</tr>"].join("");
        } else {
            // Unmatched organization
            out = ["<tr class='tx unmatched ", tooltipTriggerClass, "'>",
                        "<td></td>",
                        "<td class='name'>", 
                            tx_name, 
                            " (", tx_list.length, " transaction", tx_list.length > 1 ? "s" : "", ")",
                        "</td>",
                        "<td class='corp-name'>",
                            "No Matching Organization ",
                            "<span class='edit' onclick='chutney.edit(\"", escape(tx_name), "\");'>",
                                "edit",
                            "</span>",
                        "</td>",
                        "<td class='amount'>", total_amount, "</td>",
                   "</tr>"].join("");
        }
        return out;
    },
//    addAutocompletes: function(parentSelector) {
//        var doAddMatch = function(input, val) {
//            input = $(input);
//            input
//                .attr("disabled", "disabled")
//                .removeClass("bad-name")
//                .addClass("ui-autocomplete-loading")
//                .autocomplete("option", "disabled", true);
//            var orig = input.parents("tr").find("td.orig").text();
//            chutney.addUserMatch(orig, val ? val : input.val());
//        };
//        $(parentSelector).find("input.add-name").autocomplete({
//            minLength: 2,
//            source: function(request, responseCallback) {
//                if (request.term.length > 1) {
//                    var input = $(this.element);
//                    $.getJSON(NAME_SEARCH_URL + "?callback=?", request, function(data) {
//                        responseCallback(data);
//                        var cleaned = clean(request.term);
//                        for (var i = 0; i < data.length; i++) {
//                            if (cleaned == clean(data[i])) {
//                                input.removeClass("bad-name");
//                                break;
//                            }
//                        }
//                    });
//                }
//            }, 
//            search: function(event, ui) {
//                $(event.target).addClass("bad-name");
//            },
//            change: function(event, ui) {
//                if (!$(this).hasClass("bad-name") 
//                        && !$(this).attr("disabled") 
//                        && $(this).val().length > 0) {
//                    doAddMatch(this);
//                }
//            },
//            select: function(event, ui) {
//                doAddMatch(this, ui.item.value);
//            }
//        }).bind({
//            focus: function(event) {
//                if ($(this).hasClass("bad-name")) {
//                    $(this).autocomplete('search', $(this).val());
//                    focusedInput = $(this);
//                }
//            }, 
//            keyup: function(event) {
//                if ($(this).val().length == 0) {
//                    $(this).removeClass("bad-name");
//                }
//            }
//        });
//    },
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
    },
    /*
    *  Do that UI magic.
    */
    show: function() {
        $("#chutney .loading").hide();
        $("#chutney .content").show();
        chutney.drawTxs();
        for (var i = 0; i < chutney.postLoadQueue.length; i++) {
            chutney.postLoadQueue[i]();
        }
        chutney.postLoadQueue = [];
        chutney.setViewMode();
        chutney._fixOffset(); // one more time...
    }
}

window.chutney = chutney;

})();
